import type { ClientSession, FilterQuery, Types } from 'mongoose';
import { logger } from '../../config/logger';
import {
  PaymentProviderName,
  TRANSACTION_TYPE_DIRECTION,
  TransactionDirection,
  TransactionStatus,
  TransactionType,
} from '../../types/enums';
import {
  AlreadyProcessedError,
  ConflictError,
  InsufficientBalanceError,
  NotFoundError,
} from '../../utils/errors';
import { idString, references, toObjectId } from '../../utils/ids';
import { assertPositiveMinor } from '../../utils/money';
import {
  LedgerTransaction,
  type LedgerTransactionDoc,
  type LedgerTransactionDocument,
} from './ledger.model';

export interface PostTransactionInput {
  /**
   * Globally unique key derived from the business event, e.g.
   * `offering:<offeringId>` or `webhook:PAYSTACK:<paymentRef>`.
   * A retry carrying the same key returns the original entry rather than posting twice.
   */
  idempotencyKey: string;

  homecell: Types.ObjectId | string;
  area: Types.ObjectId | string;
  zone: Types.ObjectId | string;
  member?: Types.ObjectId | string | null;

  type: TransactionType;
  /** Required only for ADJUSTMENT, whose sign is not implied by its type. */
  direction?: TransactionDirection;
  amountMinor: number;
  currency: string;

  valueDate: Date;
  description: string;
  reference?: string;
  metadata?: Record<string, unknown>;

  status?: TransactionStatus;
  sourceModel?: 'Offering' | 'Expense' | 'Remittance' | 'Payment' | 'DuesInvoice' | null;
  sourceId?: Types.ObjectId | string | null;

  paymentProvider?: PaymentProviderName | null;
  providerReference?: string | null;
  supportingDocumentUrl?: string | null;

  createdBy?: string | Types.ObjectId | null;
  approvedBy?: string | Types.ObjectId | null;
  approvedAt?: Date | null;

  /** Set on a REVERSAL entry to point back at the entry it cancels. */
  reversalOf?: Types.ObjectId | string | null;
}

function resolveDirection(input: PostTransactionInput): TransactionDirection {
  if (input.direction) return input.direction;
  const implied = TRANSACTION_TYPE_DIRECTION[input.type];
  if (!implied) {
    throw new Error(`A direction must be supplied explicitly for ${input.type} transactions`);
  }
  return implied;
}

/**
 * Appends an entry to the ledger.
 *
 * This is the *only* way money enters or leaves a Homecell purse. There is no code
 * path anywhere that assigns a balance directly (BR-012).
 *
 * Idempotency is enforced by a unique index rather than a read-then-write check, so it
 * holds under concurrency: if two webhook deliveries race, one insert wins and the
 * other is recognised as a duplicate and returns the winner's entry.
 */
export async function postTransaction(
  input: PostTransactionInput,
  session?: ClientSession,
): Promise<{ transaction: LedgerTransactionDocument; duplicate: boolean }> {
  assertPositiveMinor(input.amountMinor, 'Transaction amount');

  const direction = resolveDirection(input);

  try {
    const [transaction] = await LedgerTransaction.create(
      [
        {
          transactionRef: references.transaction(),
          idempotencyKey: input.idempotencyKey,
          homecell: input.homecell,
          area: input.area,
          zone: input.zone,
          member: input.member ?? null,
          type: input.type,
          direction,
          amountMinor: input.amountMinor,
          currency: input.currency,
          status: input.status ?? TransactionStatus.POSTED,
          valueDate: input.valueDate,
          description: input.description,
          reference: input.reference,
          metadata: input.metadata ?? {},
          sourceModel: input.sourceModel ?? null,
          sourceId: input.sourceId ?? null,
          paymentProvider: input.paymentProvider ?? null,
          providerReference: input.providerReference ?? null,
          supportingDocumentUrl: input.supportingDocumentUrl ?? null,
          createdBy: input.createdBy ?? null,
          approvedBy: input.approvedBy ?? null,
          approvedAt: input.approvedAt ?? null,
          reversalOf: input.reversalOf ?? null,
          postedAt:
            (input.status ?? TransactionStatus.POSTED) === TransactionStatus.POSTED
              ? new Date()
              : null,
        },
      ],
      { session: session ?? undefined, ordered: true },
    );
    return { transaction, duplicate: false };
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      const existing = await LedgerTransaction.findOne({
        idempotencyKey: input.idempotencyKey,
      }).session(session ?? null);
      if (existing) {
        logger.info(
          { idempotencyKey: input.idempotencyKey, transactionRef: existing.transactionRef },
          'Duplicate ledger post ignored (idempotency key already used)',
        );
        return { transaction: existing, duplicate: true };
      }
    }
    throw err;
  }
}

/**
 * Reverses a posted entry with an equal-and-opposite one.
 *
 * The original is never edited beyond being marked REVERSED and linked to its
 * reversal, preserving the full history required by SRS §8.8 and BR-016.
 */
export async function reverseTransaction(
  transactionId: string,
  reason: string,
  actorId: string,
  session?: ClientSession,
): Promise<LedgerTransactionDocument> {
  const original = await LedgerTransaction.findById(transactionId).session(session ?? null);
  if (!original) throw new NotFoundError('Transaction');

  if (original.status === TransactionStatus.REVERSED) {
    throw new AlreadyProcessedError('This transaction has already been reversed.');
  }
  if (original.status !== TransactionStatus.POSTED) {
    throw new ConflictError('Only a posted transaction can be reversed.');
  }

  const { transaction: reversal, duplicate } = await postTransaction(
    {
      idempotencyKey: `reversal:${idString(original._id)}`,
      homecell: original.homecell,
      area: original.area,
      zone: original.zone,
      member: original.member,
      type: TransactionType.REVERSAL,
      direction:
        original.direction === TransactionDirection.CREDIT
          ? TransactionDirection.DEBIT
          : TransactionDirection.CREDIT,
      amountMinor: original.amountMinor,
      currency: original.currency,
      valueDate: new Date(),
      description: `Reversal of ${original.transactionRef}: ${reason}`,
      reference: original.transactionRef,
      metadata: { reversalOf: idString(original._id), reason },
      sourceModel: original.sourceModel,
      sourceId: original.sourceId,
      createdBy: actorId,
      // Set at creation: a posted entry is immutable, so the link cannot be
      // added afterwards.
      reversalOf: original._id,
    },
    session,
  );

  if (duplicate) {
    throw new AlreadyProcessedError('This transaction has already been reversed.');
  }

  original.status = TransactionStatus.REVERSED;
  original.reversedBy = reversal._id;
  original.reversedAt = new Date();
  original.reversalReason = reason;
  await original.save({ session: session ?? undefined });

  return reversal;
}

export interface BalanceSummary {
  currency: string;
  availableMinor: number;
  pendingMinor: number;
  openingBalanceMinor: number;
  totalIncomingMinor: number;
  totalOfferingsMinor: number;
  totalOtherIncomeMinor: number;
  totalExpensesMinor: number;
  totalRemittedMinor: number;
  totalAdjustmentsMinor: number;
  transactionCount: number;
}

/**
 * Statuses that contribute to the available balance.
 *
 * A REVERSED entry is deliberately included: reversing does not erase the original,
 * it posts an equal and opposite REVERSAL alongside it. Dropping the original as well
 * would subtract the amount twice. `REVERSED` is a marker on the history, not an
 * exclusion from the arithmetic.
 */
const BALANCE_STATUSES = [
  TransactionStatus.POSTED,
  TransactionStatus.REVERSED,
  TransactionStatus.PENDING,
];

const EMPTY_SUMMARY = (currency: string): BalanceSummary => ({
  currency,
  availableMinor: 0,
  pendingMinor: 0,
  openingBalanceMinor: 0,
  totalIncomingMinor: 0,
  totalOfferingsMinor: 0,
  totalOtherIncomeMinor: 0,
  totalExpensesMinor: 0,
  totalRemittedMinor: 0,
  totalAdjustmentsMinor: 0,
  transactionCount: 0,
});

/**
 * Folds the ledger into a balance.
 *
 * Runs as a single aggregation over the `{homecell, status, valueDate}` index, so a
 * Homecell with years of history still resolves in one indexed pass. This is the only
 * definition of "balance" in the system — the number is never cached in a document.
 */
export async function computeBalance(
  filter: FilterQuery<LedgerTransactionDoc>,
  currency = 'NGN',
): Promise<BalanceSummary> {
  const rows = await LedgerTransaction.aggregate([
    { $match: { ...filter, status: { $in: BALANCE_STATUSES } } },
    {
      $group: {
        _id: { status: '$status', type: '$type', direction: '$direction' },
        amount: { $sum: '$amountMinor' },
        count: { $sum: 1 },
      },
    },
  ]);

  const summary = EMPTY_SUMMARY(currency);

  for (const row of rows) {
    const { status, type, direction } = row._id as {
      status: TransactionStatus;
      type: TransactionType;
      direction: TransactionDirection;
    };
    const amount = row.amount as number;
    const signed = direction === TransactionDirection.CREDIT ? amount : -amount;
    summary.transactionCount += row.count as number;

    if (status === TransactionStatus.PENDING) {
      summary.pendingMinor += signed;
      continue;
    }

    summary.availableMinor += signed;

    switch (type) {
      case TransactionType.OPENING_BALANCE:
        summary.openingBalanceMinor += signed;
        break;
      case TransactionType.OFFERING:
        summary.totalOfferingsMinor += amount;
        summary.totalIncomingMinor += amount;
        break;
      case TransactionType.OTHER_INCOME:
      case TransactionType.PAYMENT_IN:
        summary.totalOtherIncomeMinor += amount;
        summary.totalIncomingMinor += amount;
        break;
      case TransactionType.EXPENSE:
        summary.totalExpensesMinor += amount;
        break;
      case TransactionType.REMITTANCE:
      case TransactionType.PAYMENT_OUT:
        summary.totalRemittedMinor += amount;
        break;
      case TransactionType.ADJUSTMENT:
      case TransactionType.REVERSAL:
      case TransactionType.REFUND:
        summary.totalAdjustmentsMinor += signed;
        break;
      default:
        break;
    }
  }

  return summary;
}

export async function homecellBalance(
  homecellId: string | Types.ObjectId,
  currency = 'NGN',
): Promise<BalanceSummary> {
  return computeBalance({ homecell: toObjectId(idString(homecellId)) }, currency);
}

/** Balances for many Homecells at once — used by dashboards and threshold sweeps. */
export async function balancesByHomecell(
  filter: FilterQuery<LedgerTransactionDoc> = {},
): Promise<Map<string, number>> {
  const rows = await LedgerTransaction.aggregate([
    {
      $match: {
        ...filter,
        status: { $in: [TransactionStatus.POSTED, TransactionStatus.REVERSED] },
      },
    },
    {
      $group: {
        _id: '$homecell',
        balance: {
          $sum: {
            $cond: [
              { $eq: ['$direction', TransactionDirection.CREDIT] },
              '$amountMinor',
              { $multiply: ['$amountMinor', -1] },
            ],
          },
        },
      },
    },
  ]);
  return new Map(rows.map((r) => [idString(r._id), r.balance as number]));
}

/**
 * Guards a debit against the available balance.
 *
 * Called inside the same transaction as the posting it protects, so the balance it
 * reads cannot be spent by a concurrent request before the debit lands.
 */
export async function assertSufficientBalance(
  homecellId: string | Types.ObjectId,
  amountMinor: number,
  currency: string,
): Promise<number> {
  const { availableMinor } = await homecellBalance(homecellId, currency);
  if (availableMinor < amountMinor) {
    throw new InsufficientBalanceError(availableMinor, amountMinor, currency);
  }
  return availableMinor;
}
