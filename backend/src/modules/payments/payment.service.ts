import type { Request } from 'express';
import type { ClientSession, FilterQuery, Types } from 'mongoose';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { withTransaction } from '../../db/transaction';
import { assertHomecellInScope, resolveScopedFilter } from '../../middleware/scope';
import { buildSort } from '../../middleware/validate';
import {
  AuditAction,
  AuditModule,
  NotificationSeverity,
  NotificationType,
  PaymentDirection,
  PaymentProviderName,
  PaymentPurpose,
  PaymentStatus,
  ReconciliationStatus,
  RemittanceStatus,
  TERMINAL_PAYMENT_STATUSES,
  TransactionStatus,
  TransactionType,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { dateRange } from '../../utils/dates';
import {
  AlreadyProcessedError,
  ConflictError,
  NotFoundError,
  PaymentVerificationError,
  ValidationError,
} from '../../utils/errors';
import { idString, references, toObjectId } from '../../utils/ids';
import { formatMoney, toMinor } from '../../utils/money';
import { paginate } from '../../utils/query';
import { recordAudit } from '../audit/audit.service';
import { DuesInvoice } from '../dues/dues.model';
import {
  claimInvoices,
  notifyDuesPaid,
  priceSelection,
  releaseInvoicesForPayment,
  settleInvoicesForPayment,
} from '../dues/dues.service';
import { Homecell } from '../homecells/homecell.model';
import { LedgerTransaction } from '../finance/ledger.model';
import { assertSufficientBalance, postTransaction } from '../finance/ledger.service';
import { Offering, OfferingChannel } from '../finance/offering.model';
import { checkThresholdAndNotify } from '../finance/purse.service';
import { notify, resolveEscalationRecipients } from '../notifications/notification.service';
import { Remittance } from '../remittances/remittance.model';
import { getSettings } from '../settings/settings.service';
import { getActiveProvider, getProvider } from './providers';
import {
  Payment,
  WebhookEvent,
  type PaymentDoc,
  type PaymentDocument,
  type WebhookEventDoc,
} from './payment.model';

const SORTABLE = ['createdAt', 'amountMinor', 'status'];
const POPULATE = [
  { path: 'homecell', select: 'name code' },
  { path: 'initiatedBy', select: 'firstName lastName' },
];

/** Ledger transaction type produced when a payment settles. */
const PURPOSE_TO_LEDGER_TYPE: Record<PaymentPurpose, TransactionType> = {
  [PaymentPurpose.OFFERING]: TransactionType.OFFERING,
  [PaymentPurpose.OTHER_INCOME]: TransactionType.OTHER_INCOME,
  [PaymentPurpose.REMITTANCE]: TransactionType.REMITTANCE,
  // Dues leave the Homecell purse for the Zone, exactly like a remittance, so they
  // post the same DEBIT type and roll up into the same "remitted" totals.
  [PaymentPurpose.DUES]: TransactionType.REMITTANCE,
};

/** Purposes whose checkout moves money *out* of the purse rather than into it. */
const OUTGOING_PURPOSES: PaymentPurpose[] = [PaymentPurpose.REMITTANCE, PaymentPurpose.DUES];

function pushStatus(
  payment: PaymentDocument,
  status: PaymentStatus,
  source: 'SYSTEM' | 'WEBHOOK' | 'VERIFICATION' | 'MANUAL',
  note?: string,
): void {
  payment.status = status;
  payment.statusHistory.push({ status, at: new Date(), source, note });
}

// ---------------------------------------------------------------------------
// Payment-in
// ---------------------------------------------------------------------------

export interface InitiatePaymentInput {
  homecellId: string;
  purpose: PaymentPurpose;
  amount: number;
  email: string;
  name?: string;
  phone?: string;
  description?: string;
  memberId?: string;
}

/**
 * Starts an inbound payment.
 *
 * Nothing touches the ledger here. The record is created as PENDING and only the
 * provider's own confirmation — via webhook or an explicit verification call — can
 * move it to SUCCESSFUL and post the money. The browser's redirect is never trusted.
 */
export async function initiatePayment(
  actor: AuthenticatedUser,
  input: InitiatePaymentInput,
  req: Request,
) {
  await assertHomecellInScope(actor, input.homecellId);
  const homecell = await Homecell.findById(input.homecellId).select('_id name area zone').lean();
  if (!homecell) throw new NotFoundError('Homecell');

  const settings = await getSettings();
  if (!settings.paymentsEnabled) {
    throw new ConflictError('Online payments are currently disabled.');
  }

  const provider = await getActiveProvider();
  const reference = references.payment();
  const amountMinor = toMinor(input.amount);

  const payment = await Payment.create({
    reference,
    idempotencyKey: `payment-in:${reference}`,
    direction: PaymentDirection.INBOUND,
    purpose: input.purpose,
    provider: provider.name,
    homecell: homecell._id,
    area: homecell.area,
    zone: homecell.zone,
    member: input.memberId ?? null,
    amountMinor,
    currency: settings.currency,
    status: PaymentStatus.PENDING,
    customerEmail: input.email,
    customerName: input.name,
    customerPhone: input.phone,
    description: input.description,
    initiatedBy: actor.id,
    statusHistory: [{ status: PaymentStatus.PENDING, at: new Date(), source: 'SYSTEM' }],
  });

  try {
    const result = await provider.initializePayment({
      reference,
      amountMinor,
      currency: settings.currency,
      email: input.email,
      name: input.name,
      phone: input.phone,
      description: input.description,
      callbackUrl: `${env.FRONTEND_URL}/payments/callback?reference=${encodeURIComponent(reference)}`,
      metadata: {
        homecellId: idString(homecell._id),
        purpose: input.purpose,
        initiatedBy: actor.id,
      },
    });

    payment.providerReference = result.providerReference;
    payment.authorizationUrl = result.authorizationUrl;
    payment.accessCode = result.accessCode;
    payment.providerResponse = result.raw;
    pushStatus(payment, PaymentStatus.PROCESSING, 'SYSTEM', 'Checkout session created');
    await payment.save();
  } catch (err) {
    pushStatus(payment, PaymentStatus.FAILED, 'SYSTEM', (err as Error).message);
    payment.failureReason = (err as Error).message;
    await payment.save();
    throw err;
  }

  await recordAudit(
    {
      action: AuditAction.PAYMENT_INIT,
      module: AuditModule.PAYMENTS,
      description: `Initiated ${provider.name} payment ${reference} of ${formatMoney(
        amountMinor,
        settings.currency,
      )} for ${homecell.name}`,
      entityModel: 'Payment',
      entityId: payment._id,
      entityLabel: reference,
      newValues: { amount: input.amount, purpose: input.purpose, provider: provider.name },
      zone: homecell.zone,
      area: homecell.area,
      homecell: homecell._id,
    },
    req,
  );

  return {
    reference: payment.reference,
    provider: provider.name,
    authorizationUrl: payment.authorizationUrl,
    accessCode: payment.accessCode,
    amount: input.amount,
    currency: settings.currency,
    status: payment.status,
  };
}

export interface CheckoutInput {
  actor: AuthenticatedUser;
  purpose: PaymentPurpose;
  homecell: { _id: Types.ObjectId; area: Types.ObjectId; zone: Types.ObjectId; name: string };
  amountMinor: number;
  currency: string;
  description: string;
  email?: string;
  relatedModel?: 'Remittance' | 'DuesInvoice';
  relatedId?: Types.ObjectId | null;
  /** Where the browser lands after checkout, minus the reference. */
  callbackPath?: string;
}

/**
 * Opens a provider checkout for money leaving a Homecell purse.
 *
 * The payment record exists before the provider is contacted, so a provider call that
 * times out still leaves an auditable record rather than a silent gap, and the caller
 * gets a payment it can safely reconcile later. Nothing here touches the ledger: only
 * the webhook or an explicit verification settles.
 */
export async function createCheckoutPayment(input: CheckoutInput): Promise<PaymentDocument> {
  const settings = await getSettings();
  if (!settings.paymentsEnabled) {
    throw new ConflictError('Online payments are currently disabled.');
  }

  const provider = await getActiveProvider();
  const reference = references.payment();

  const payment = await Payment.create({
    reference,
    idempotencyKey: `payment-in:${reference}`,
    direction: PaymentDirection.INBOUND,
    purpose: input.purpose,
    provider: provider.name,
    homecell: input.homecell._id,
    area: input.homecell.area,
    zone: input.homecell.zone,
    amountMinor: input.amountMinor,
    currency: input.currency,
    status: PaymentStatus.PENDING,
    customerEmail: input.email ?? input.actor.email,
    customerName: input.actor.fullName,
    description: input.description,
    relatedModel: input.relatedModel ?? null,
    relatedId: input.relatedId ?? null,
    initiatedBy: input.actor.id,
    statusHistory: [{ status: PaymentStatus.PENDING, at: new Date(), source: 'SYSTEM' }],
  });

  try {
    const result = await provider.initializePayment({
      reference,
      amountMinor: input.amountMinor,
      currency: input.currency,
      email: input.email ?? input.actor.email,
      name: input.actor.fullName,
      description: input.description,
      callbackUrl: `${env.FRONTEND_URL}${
        input.callbackPath ?? '/payments/callback'
      }?reference=${encodeURIComponent(reference)}`,
      metadata: {
        homecellId: idString(input.homecell._id),
        purpose: input.purpose,
        initiatedBy: input.actor.id,
      },
    });

    payment.providerReference = result.providerReference;
    payment.authorizationUrl = result.authorizationUrl;
    payment.accessCode = result.accessCode;
    payment.providerResponse = result.raw;
    pushStatus(payment, PaymentStatus.PROCESSING, 'SYSTEM', 'Checkout session created');
    await payment.save();
  } catch (err) {
    pushStatus(payment, PaymentStatus.FAILED, 'SYSTEM', (err as Error).message);
    payment.failureReason = (err as Error).message;
    await payment.save();
    throw err;
  }

  return payment;
}

export interface DuesPaymentInput {
  homecellId: string;
  /** Omit to settle everything outstanding. */
  invoiceIds?: string[];
  email?: string;
}

/**
 * Opens a checkout covering one or more dues invoices.
 *
 * Order is chosen so that no state is left dangling if a later step fails:
 *   1. price the selection — every invoice must still be outstanding
 *   2. check the purse can cover it (dues are paid from Homecell funds)
 *   3. create the payment record
 *   4. claim the invoices against it, which is what stops a double payment
 *   5. contact the provider; on failure the claim is released and the payment fails
 */
export async function initiateDuesPayment(
  actor: AuthenticatedUser,
  input: DuesPaymentInput,
  req: Request,
) {
  const homecell = await Homecell.findById(input.homecellId)
    .select('_id name area zone')
    .lean();
  if (!homecell) throw new NotFoundError('Homecell');

  const selection = await priceSelection(actor, input.homecellId, input.invoiceIds);
  await assertSufficientBalance(homecell._id, selection.totalMinor, selection.currency);

  const periods = selection.invoices.map((invoice) => invoice.periodLabel).join(', ');
  const description = `Dues payment for ${homecell.name} — ${periods}`;

  const payment = await createCheckoutPayment({
    actor,
    purpose: PaymentPurpose.DUES,
    homecell,
    amountMinor: selection.totalMinor,
    currency: selection.currency,
    description,
    email: input.email,
    relatedModel: 'DuesInvoice',
    relatedId: selection.invoices[0]._id,
  });

  try {
    await claimInvoices(
      selection.invoices.map((invoice) => invoice._id),
      payment._id,
      payment.provider,
    );
  } catch (err) {
    // The checkout is already open at the provider but nothing can settle against it,
    // so it is failed immediately rather than left to expire.
    pushStatus(payment, PaymentStatus.CANCELLED, 'SYSTEM', (err as Error).message);
    payment.failureReason = (err as Error).message;
    await payment.save();
    throw err;
  }

  await recordAudit(
    {
      action: AuditAction.PAYMENT_INIT,
      module: AuditModule.FINANCE,
      description: `Initiated dues payment ${payment.reference} of ${formatMoney(
        selection.totalMinor,
        selection.currency,
      )} for ${homecell.name} covering ${periods}`,
      entityModel: 'Payment',
      entityId: payment._id,
      entityLabel: payment.reference,
      newValues: {
        amountMinor: selection.totalMinor,
        invoices: selection.invoices.map((invoice) => invoice.reference),
      },
      zone: homecell.zone,
      area: homecell.area,
      homecell: homecell._id,
    },
    req,
  );

  return {
    reference: payment.reference,
    provider: payment.provider,
    authorizationUrl: payment.authorizationUrl,
    accessCode: payment.accessCode,
    amountMinor: selection.totalMinor,
    currency: selection.currency,
    status: payment.status,
    invoices: selection.invoices.map((invoice) => ({
      id: idString(invoice._id),
      reference: invoice.reference,
      name: invoice.name,
      periodLabel: invoice.periodLabel,
      amountMinor: invoice.amountMinor,
    })),
  };
}

/**
 * Asks the provider what actually happened and applies the answer.
 *
 * Used by the callback page and by reconciliation. Safe to call repeatedly: the
 * settlement path is idempotent, and a payment already in a terminal state is returned
 * unchanged.
 */
export async function verifyPayment(reference: string, req?: Request): Promise<PaymentDocument> {
  const payment = await Payment.findOne({ reference });
  if (!payment) throw new NotFoundError('Payment');

  if (TERMINAL_PAYMENT_STATUSES.includes(payment.status)) return payment;

  const provider = getProvider(payment.provider);
  const result = await provider.verifyPayment(reference);

  // A provider reporting a different amount than we asked for is never settled
  // automatically — it is flagged for a human to reconcile.
  if (
    result.status === PaymentStatus.SUCCESSFUL &&
    result.amountMinor !== null &&
    result.amountMinor !== payment.amountMinor
  ) {
    payment.reconciliationStatus = ReconciliationStatus.MISMATCHED;
    payment.providerAmountMinor = result.amountMinor;
    payment.providerStatusRaw = result.providerStatusRaw;
    payment.reconciliationNote = `Amount mismatch: expected ${payment.amountMinor}, provider reported ${result.amountMinor}`;
    await payment.save();
    throw new PaymentVerificationError(
      'Payment verification failed: the amount reported by the provider does not match this transaction.',
      { expectedMinor: payment.amountMinor, providerMinor: result.amountMinor },
    );
  }

  payment.providerReference = result.providerReference ?? payment.providerReference;
  payment.providerTransactionId = result.providerTransactionId;
  payment.providerAmountMinor = result.amountMinor;
  payment.providerStatusRaw = result.providerStatusRaw;
  payment.providerResponse = result.raw;
  payment.failureReason = result.failureReason;

  if (result.status === PaymentStatus.SUCCESSFUL) {
    await settlePayment(payment, 'VERIFICATION', req);
  } else {
    pushStatus(payment, result.status, 'VERIFICATION');
    await payment.save();
  }

  return (await Payment.findOne({ reference }))!;
}

/**
 * The single settlement path — the only place an inbound payment becomes money.
 *
 * Everything it does happens inside one unit of work: mark the payment successful,
 * post the ledger entry, link the source document, notify, audit. The ledger post is
 * keyed on `payment:<reference>`, so a webhook delivered three times still yields
 * exactly one entry (SRS Â§42).
 */
async function settlePayment(
  payment: PaymentDocument,
  source: 'WEBHOOK' | 'VERIFICATION' | 'MANUAL',
  req?: Request,
): Promise<void> {
  if (payment.status === PaymentStatus.SUCCESSFUL && payment.ledgerTransaction) {
    logger.info({ reference: payment.reference }, 'Payment already settled — ignoring duplicate');
    return;
  }

  const settings = await getSettings();

  await withTransaction(async ({ session, onRollback }) => {
    const fresh = await Payment.findById(payment._id).session(session ?? null);
    if (!fresh) throw new NotFoundError('Payment');
    if (fresh.ledgerTransaction) return; // won the race elsewhere

    if (fresh.direction === PaymentDirection.OUTBOUND) {
      await settleOutboundPayment(fresh, settings.currency, session, onRollback);
    } else {
      await settleInboundPayment(fresh, settings.currency, session, onRollback);
    }

    pushStatus(fresh, PaymentStatus.SUCCESSFUL, source);
    fresh.completedAt = new Date();
    fresh.reconciliationStatus = ReconciliationStatus.MATCHED;
    fresh.reconciledAt = new Date();
    await fresh.save({ session: session ?? undefined });
  });

  const reloaded = await Payment.findById(payment._id).lean();

  await recordAudit(
    {
      action: AuditAction.PAYMENT_WEBHOOK,
      module: AuditModule.PAYMENTS,
      description: `Payment ${payment.reference} settled successfully via ${source.toLowerCase()}`,
      entityModel: 'Payment',
      entityId: payment._id,
      entityLabel: payment.reference,
      newValues: {
        status: PaymentStatus.SUCCESSFUL,
        ledgerTransaction: idString(reloaded?.ledgerTransaction),
      },
      zone: payment.zone,
      area: payment.area,
      homecell: payment.homecell,
      actor: { name: 'Payment provider', role: 'SYSTEM' },
    },
    req,
  );

  if (payment.purpose === PaymentPurpose.DUES) {
    // Names the months that were just cleared, which is the only detail the
    // coordinator actually wants to see.
    const invoices = await DuesInvoice.find({ payment: payment._id }).lean();
    await notifyDuesPaid(
      payment.homecell,
      payment.area,
      payment.zone,
      invoices,
      payment.amountMinor,
      payment.currency,
      payment.reference,
    );
  } else {
    const recipients = await resolveEscalationRecipients({
      homecellId: payment.homecell,
      includeHomecell: true,
    });
    const outgoing = OUTGOING_PURPOSES.includes(payment.purpose);
    await notify({
      recipients,
      type: NotificationType.PAYMENT_SUCCESSFUL,
      severity: NotificationSeverity.SUCCESS,
      title: outgoing ? 'Remittance completed' : 'Payment received',
      message: `Payment ${payment.reference} of ${formatMoney(
        payment.amountMinor,
        payment.currency,
      )} was successful and has been ${
        outgoing ? 'deducted from the Homecell purse' : 'applied to the Homecell purse'
      }.`,
      entityModel: 'Payment',
      entityId: payment._id,
      actionUrl: `/finance/payments/${idString(payment._id)}`,
      homecell: payment.homecell,
      area: payment.area,
      zone: payment.zone,
    });
  }

  await checkThresholdAndNotify(idString(payment.homecell));
}

/** Credits the purse and creates/links the Offering record when that is the purpose. */
async function settleInboundPayment(
  payment: PaymentDocument,
  currency: string,
  session: ClientSession | undefined,
  onRollback: (fn: () => Promise<void>) => void,
): Promise<void> {
  // A remittance or dues checkout is money leaving the purse, so it settles through
  // its own path — the shared code below credits, and these must debit.
  if (OUTGOING_PURPOSES.includes(payment.purpose)) {
    await settleOutgoingCheckout(payment, currency, session, onRollback);
    return;
  }

  let sourceModel: 'Offering' | null = null;
  let sourceId = payment.relatedId ?? null;

  if (payment.purpose === PaymentPurpose.OFFERING && !payment.relatedId) {
    const [offering] = await Offering.create(
      [
        {
          reference: references.offering(),
          homecell: payment.homecell,
          area: payment.area,
          zone: payment.zone,
          date: payment.createdAt ?? new Date(),
          amountMinor: payment.amountMinor,
          currency,
          channel: OfferingChannel.ONLINE_PAYMENT,
          description: payment.description ?? 'Online Homecell offering',
          status: TransactionStatus.POSTED,
          payment: payment._id,
          paymentProvider: payment.provider,
          recordedBy: payment.initiatedBy,
        },
      ],
      { session: session ?? undefined },
    );
    onRollback(async () => {
      await Offering.deleteOne({ _id: offering._id });
    });
    sourceModel = 'Offering';
    sourceId = offering._id;
    payment.relatedModel = 'Offering';
    payment.relatedId = offering._id;
  }

  const { transaction } = await postTransaction(
    {
      idempotencyKey: `payment:${payment.reference}`,
      homecell: payment.homecell,
      area: payment.area,
      zone: payment.zone,
      member: payment.member,
      type: PURPOSE_TO_LEDGER_TYPE[payment.purpose],
      amountMinor: payment.amountMinor,
      currency,
      valueDate: new Date(),
      description: payment.description ?? `Online payment ${payment.reference}`,
      reference: payment.reference,
      sourceModel: sourceModel ?? 'Payment',
      sourceId: sourceId ?? payment._id,
      paymentProvider: payment.provider,
      providerReference: payment.providerReference,
      createdBy: payment.initiatedBy,
    },
    session,
  );
  onRollback(async () => {
    await LedgerTransaction.deleteOne({ _id: transaction._id });
  });

  payment.ledgerTransaction = transaction._id;

  if (sourceModel === 'Offering' && sourceId) {
    await Offering.updateOne(
      { _id: sourceId },
      { $set: { ledgerTransaction: transaction._id } },
      { session: session ?? undefined },
    );
  }
}

/**
 * Settles a checkout that moves money *out* of the purse — a remittance paid online,
 * or monthly dues and levies.
 *
 * One payment produces exactly one DEBIT, whatever it covers: paying eight months of
 * dues in a single checkout posts one entry for the total, not eight. The posting is
 * keyed on the payment reference, so a webhook delivered repeatedly still debits once,
 * and the source documents are marked inside the same transaction as the posting.
 */
async function settleOutgoingCheckout(
  payment: PaymentDocument,
  currency: string,
  session: ClientSession | undefined,
  onRollback: (fn: () => Promise<void>) => void,
): Promise<void> {
  const isDues = payment.purpose === PaymentPurpose.DUES;

  // The coordinator's stated remittance date and time is the value date of the
  // posting; dues are valued when they actually settle.
  const remittance =
    !isDues && payment.relatedId
      ? await Remittance.findById(payment.relatedId).session(session ?? null)
      : null;

  const { transaction } = await postTransaction(
    {
      idempotencyKey: `payment:${payment.reference}`,
      homecell: payment.homecell,
      area: payment.area,
      zone: payment.zone,
      type: TransactionType.REMITTANCE,
      amountMinor: payment.amountMinor,
      currency,
      valueDate: remittance?.remittedAt ?? remittance?.date ?? new Date(),
      description: payment.description ?? `Online payment ${payment.reference}`,
      reference: remittance?.reference ?? payment.reference,
      sourceModel: isDues ? 'DuesInvoice' : 'Remittance',
      sourceId: payment.relatedId ?? payment._id,
      paymentProvider: payment.provider,
      providerReference: payment.providerReference,
      createdBy: payment.initiatedBy,
      approvedBy: payment.approvedBy,
      approvedAt: payment.approvedAt,
    },
    session,
  );
  onRollback(async () => {
    await LedgerTransaction.deleteOne({ _id: transaction._id });
  });

  payment.ledgerTransaction = transaction._id;

  if (isDues) {
    await settleInvoicesForPayment(
      payment._id,
      transaction._id,
      payment.providerReference,
      payment.initiatedBy ?? null,
      session,
    );
    return;
  }

  if (remittance) {
    remittance.status = RemittanceStatus.SUCCESSFUL;
    remittance.ledgerTransaction = transaction._id;
    remittance.providerReference = payment.providerReference ?? null;
    remittance.paymentProvider = payment.provider;
    remittance.verifiedAt = new Date();
    await remittance.save({ session: session ?? undefined });
  }
}

/** Debits the purse when an outbound remittance transfer completes. */
async function settleOutboundPayment(
  payment: PaymentDocument,
  currency: string,
  session: ClientSession | undefined,
  onRollback: (fn: () => Promise<void>) => void,
): Promise<void> {
  const { transaction } = await postTransaction(
    {
      idempotencyKey: `payment:${payment.reference}`,
      homecell: payment.homecell,
      area: payment.area,
      zone: payment.zone,
      type: TransactionType.REMITTANCE,
      amountMinor: payment.amountMinor,
      currency,
      valueDate: new Date(),
      description: payment.description ?? `Remittance payout ${payment.reference}`,
      reference: payment.reference,
      sourceModel: 'Remittance',
      sourceId: payment.relatedId ?? payment._id,
      paymentProvider: payment.provider,
      providerReference: payment.providerReference,
      createdBy: payment.initiatedBy,
      approvedBy: payment.approvedBy,
      approvedAt: payment.approvedAt,
    },
    session,
  );
  onRollback(async () => {
    await LedgerTransaction.deleteOne({ _id: transaction._id });
  });

  payment.ledgerTransaction = transaction._id;

  if (payment.relatedModel === 'Remittance' && payment.relatedId) {
    await Remittance.updateOne(
      { _id: payment.relatedId },
      {
        $set: {
          status: RemittanceStatus.SUCCESSFUL,
          ledgerTransaction: transaction._id,
          providerReference: payment.providerReference,
          verifiedAt: new Date(),
        },
      },
      { session: session ?? undefined },
    );
  }
}

/** Applies a terminal failure to a payment and its linked remittance. */
async function failPayment(
  payment: PaymentDocument,
  status: PaymentStatus,
  reason: string | null,
  source: 'WEBHOOK' | 'VERIFICATION' | 'MANUAL',
): Promise<void> {
  pushStatus(payment, status, source, reason ?? undefined);
  payment.failureReason = reason;
  payment.completedAt = new Date();
  await payment.save();

  if (payment.relatedModel === 'Remittance' && payment.relatedId) {
    await Remittance.updateOne(
      { _id: payment.relatedId },
      { $set: { status: RemittanceStatus.FAILED, failureReason: reason } },
    );
  }

  // A failed or abandoned dues checkout must not leave months stuck in PROCESSING:
  // they go back on the outstanding list so they can be paid again.
  if (payment.purpose === PaymentPurpose.DUES) {
    const released = await releaseInvoicesForPayment(payment._id);
    if (released > 0) {
      logger.info(
        { reference: payment.reference, released },
        'Released dues invoices after a failed payment',
      );
    }
  }

  const recipients = await resolveEscalationRecipients({
    homecellId: payment.homecell,
    areaId: payment.area,
    includeHomecell: true,
    includeArea: true,
  });
  await notify({
    recipients,
    type: NotificationType.PAYMENT_FAILED,
    severity: NotificationSeverity.CRITICAL,
    title: 'Payment failed',
    message: `Payment ${payment.reference} of ${formatMoney(
      payment.amountMinor,
      payment.currency,
    )} did not complete.${reason ? ` Reason: ${reason}` : ''}`,
    entityModel: 'Payment',
    entityId: payment._id,
    actionUrl: `/finance/payments/${idString(payment._id)}`,
    homecell: payment.homecell,
    area: payment.area,
    zone: payment.zone,
  });
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface WebhookResult {
  received: true;
  processed: boolean;
  duplicate: boolean;
  reason?: string;
}

/**
 * Handles an inbound provider webhook.
 *
 * Order matters and is deliberate:
 *   1. verify the signature against the *raw* body
 *   2. record the delivery under a unique `(provider, eventKey)` — a replay stops here
 *   3. look the payment up by our own reference
 *   4. ignore events for payments already in a terminal state
 *   5. settle or fail inside a transaction
 *
 * The endpoint answers 200 for anything it has understood — including duplicates and
 * unrelated event types — because a non-2xx makes providers retry forever. Genuinely
 * bad signatures return 401.
 */
export async function handleWebhook(
  providerName: PaymentProviderName,
  rawBody: Buffer,
  headers: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<WebhookResult> {
  const provider = getProvider(providerName);
  const signatureValid = provider.verifySignature(rawBody, headers);
  const parsed = provider.parseWebhook(payload, signatureValid);

  if (!signatureValid) {
    await WebhookEvent.create({
      provider: providerName,
      eventKey: `invalid:${parsed.eventKey}:${Date.now()}`,
      eventType: parsed.eventType,
      signatureValid: false,
      payload,
      processed: false,
      error: 'Invalid signature',
    }).catch(() => undefined);

    logger.warn({ provider: providerName, eventType: parsed.eventType }, 'Rejected webhook with invalid signature');
    throw new ValidationError('Invalid webhook signature.');
  }

  // Duplicate protection: the unique index is the guard, not a prior read.
  let event;
  try {
    event = await WebhookEvent.create({
      provider: providerName,
      eventKey: parsed.eventKey,
      eventType: parsed.eventType,
      signatureValid: true,
      payload,
      paymentReference: parsed.reference,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      await WebhookEvent.updateOne(
        { provider: providerName, eventKey: parsed.eventKey },
        { $inc: { deliveryCount: 1 } },
      );
      logger.info(
        { provider: providerName, eventKey: parsed.eventKey },
        'Duplicate webhook delivery ignored',
      );
      return { received: true, processed: false, duplicate: true, reason: 'Duplicate delivery' };
    }
    throw err;
  }

  try {
    if (!parsed.reference) {
      event.error = 'No transaction reference in payload';
      event.processed = true;
      event.processedAt = new Date();
      await event.save();
      return { received: true, processed: false, duplicate: false, reason: 'No reference' };
    }

    const payment = await Payment.findOne({ reference: parsed.reference });
    if (!payment) {
      event.error = 'No matching payment';
      event.processed = true;
      event.processedAt = new Date();
      await event.save();
      logger.warn({ reference: parsed.reference }, 'Webhook received for an unknown payment reference');
      return { received: true, processed: false, duplicate: false, reason: 'Unknown reference' };
    }

    event.payment = payment._id;

    if (TERMINAL_PAYMENT_STATUSES.includes(payment.status)) {
      event.processed = true;
      event.processedAt = new Date();
      event.error = `Payment already ${payment.status}`;
      await event.save();
      return { received: true, processed: false, duplicate: true, reason: 'Already processed' };
    }

    payment.providerReference = parsed.providerReference ?? payment.providerReference;
    payment.providerStatusRaw = parsed.providerStatusRaw;
    payment.providerAmountMinor = parsed.amountMinor;

    if (parsed.status === PaymentStatus.SUCCESSFUL) {
      // Re-verify against the provider API before crediting: a webhook body alone is
      // not sufficient authority to move money.
      const verification = await provider.verifyPayment(payment.reference).catch((err) => {
        logger.warn({ err, reference: payment.reference }, 'Provider re-verification failed; using webhook payload');
        return null;
      });

      const confirmedAmount = verification?.amountMinor ?? parsed.amountMinor;
      const confirmedStatus = verification?.status ?? parsed.status;

      if (confirmedStatus !== PaymentStatus.SUCCESSFUL) {
        await failPayment(payment, confirmedStatus, verification?.failureReason ?? null, 'WEBHOOK');
      } else if (confirmedAmount !== null && confirmedAmount !== payment.amountMinor) {
        payment.reconciliationStatus = ReconciliationStatus.MISMATCHED;
        payment.reconciliationNote = `Amount mismatch: expected ${payment.amountMinor}, provider reported ${confirmedAmount}`;
        await payment.save();
        event.error = payment.reconciliationNote;
        logger.error(
          { reference: payment.reference, expected: payment.amountMinor, actual: confirmedAmount },
          'Webhook amount mismatch — flagged for manual reconciliation',
        );
      } else {
        await settlePayment(payment, 'WEBHOOK');
      }
    } else if (
      parsed.status &&
      (
        [
          PaymentStatus.FAILED,
          PaymentStatus.CANCELLED,
          PaymentStatus.REVERSED,
        ] as PaymentStatus[]
      ).includes(parsed.status)
    ) {
      await failPayment(payment, parsed.status, parsed.failureReason, 'WEBHOOK');
    } else {
      pushStatus(payment, PaymentStatus.PROCESSING, 'WEBHOOK', parsed.eventType);
      await payment.save();
    }

    event.processed = true;
    event.processedAt = new Date();
    await event.save();

    return { received: true, processed: true, duplicate: false };
  } catch (err) {
    event.error = (err as Error).message;
    event.processed = false;
    await event.save().catch(() => undefined);
    logger.error({ err, provider: providerName }, 'Webhook processing failed');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface ListPaymentsQuery {
  page: number;
  limit: number;
  sort?: string;
  order: 'asc' | 'desc';
  zoneId?: string;
  areaId?: string;
  homecellId?: string;
  status?: PaymentStatus;
  direction?: PaymentDirection;
  provider?: PaymentProviderName;
  reconciliationStatus?: ReconciliationStatus;
  from?: string;
  to?: string;
}

export async function listPayments(actor: AuthenticatedUser, query: ListPaymentsQuery) {
  const scoped = await resolveScopedFilter<PaymentDoc>(actor, query);
  const filter: FilterQuery<PaymentDoc> = { ...scoped };
  if (query.status) filter.status = query.status;
  if (query.direction) filter.direction = query.direction;
  if (query.provider) filter.provider = query.provider;
  if (query.reconciliationStatus) filter.reconciliationStatus = query.reconciliationStatus;
  if (query.from || query.to) filter.createdAt = dateRange(query.from, query.to) as never;

  return paginate(Payment, {
    filter,
    page: query.page,
    limit: query.limit,
    sort: buildSort(query.sort, query.order, SORTABLE, 'createdAt'),
    populate: POPULATE,
    select: '-providerResponse',
  });
}

export async function getPayment(actor: AuthenticatedUser, id: string) {
  const payment = await Payment.findById(id).populate(POPULATE).lean();
  if (!payment) throw new NotFoundError('Payment');
  await assertHomecellInScope(actor, payment.homecell);
  return payment;
}

export async function getPaymentByReference(reference: string) {
  const payment = await Payment.findOne({ reference })
    .select('reference status amountMinor currency purpose direction provider createdAt completedAt failureReason')
    .lean();
  if (!payment) throw new NotFoundError('Payment');
  return payment;
}

/** Recent webhook deliveries, for the finance/admin troubleshooting screen. */
export async function listWebhookEvents(query: {
  page: number;
  limit: number;
  provider?: PaymentProviderName;
  processed?: boolean;
}) {
  const filter: FilterQuery<WebhookEventDoc> = {};
  if (query.provider) filter.provider = query.provider;
  if (query.processed !== undefined) filter.processed = query.processed;

  return paginate(WebhookEvent, {
    filter,
    page: query.page,
    limit: query.limit,
    sort: { receivedAt: -1 },
  });
}

/**
 * Outbound disbursement, used by the remittance module.
 * Never marks the payout successful on submission — the webhook decides.
 */
export async function createOutboundPayment(input: {
  homecell: unknown;
  area: unknown;
  zone: unknown;
  amountMinor: number;
  currency: string;
  description: string;
  relatedModel: 'Remittance';
  relatedId: unknown;
  initiatedBy: string;
  approvedBy: string;
  recipient: { accountNumber: string; bankCode: string; accountName: string };
}): Promise<PaymentDocument> {
  const provider = await getActiveProvider();
  if (!provider.supportsPayouts) {
    throw new ConflictError(
      `${provider.name} does not support outgoing transfers. Record this remittance manually instead.`,
    );
  }

  const reference = references.payment();
  const payment = await Payment.create({
    reference,
    idempotencyKey: `payment-out:${reference}`,
    direction: PaymentDirection.OUTBOUND,
    purpose: PaymentPurpose.REMITTANCE,
    provider: provider.name,
    homecell: input.homecell,
    area: input.area,
    zone: input.zone,
    amountMinor: input.amountMinor,
    currency: input.currency,
    status: PaymentStatus.PENDING,
    description: input.description,
    relatedModel: input.relatedModel,
    relatedId: input.relatedId,
    initiatedBy: input.initiatedBy,
    approvedBy: input.approvedBy,
    approvedAt: new Date(),
    statusHistory: [{ status: PaymentStatus.PENDING, at: new Date(), source: 'SYSTEM' }],
  });

  try {
    const result = await provider.initiateTransfer({
      reference,
      amountMinor: input.amountMinor,
      currency: input.currency,
      narration: input.description,
      recipient: input.recipient,
      metadata: { remittanceId: idString(input.relatedId) },
    });

    payment.providerReference = result.providerReference;
    payment.providerTransactionId = result.providerTransactionId;
    payment.providerStatusRaw = result.providerStatusRaw;
    payment.providerResponse = result.raw;
    pushStatus(payment, result.status, 'SYSTEM', 'Transfer submitted to provider');
    await payment.save();
  } catch (err) {
    pushStatus(payment, PaymentStatus.FAILED, 'SYSTEM', (err as Error).message);
    payment.failureReason = (err as Error).message;
    await payment.save();
    throw err;
  }

  return payment;
}

/** Manual settlement used by an administrator resolving a reconciliation exception. */
export async function manuallySettlePayment(
  actor: AuthenticatedUser,
  id: string,
  note: string,
  req: Request,
): Promise<PaymentDocument> {
  const payment = await Payment.findById(id);
  if (!payment) throw new NotFoundError('Payment');
  await assertHomecellInScope(actor, payment.homecell);

  if (payment.ledgerTransaction) {
    throw new AlreadyProcessedError('This payment has already been applied to the ledger.');
  }

  payment.reconciliationNote = note;
  payment.reconciledBy = toObjectId(actor.id);
  await payment.save();

  await settlePayment(payment, 'MANUAL', req);
  return (await Payment.findById(id))!;
}

