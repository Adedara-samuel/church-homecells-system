import type { Request } from 'express';
import type { FilterQuery } from 'mongoose';
import { withTransaction } from '../../db/transaction';
import { buildSort } from '../../middleware/validate';
import { assertHomecellInScope, resolveScopedFilter } from '../../middleware/scope';
import {
  AuditAction,
  AuditModule,
  OrgStatus,
  TransactionStatus,
  TransactionType,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { calendarDateString, dateRange, isSunday, toCalendarDate, weekdayName } from '../../utils/dates';
import { BusinessRuleError, ConflictError, NotFoundError } from '../../utils/errors';
import { idString, references, toObjectId } from '../../utils/ids';
import { formatMoney, toMinor } from '../../utils/money';
import { paginate } from '../../utils/query';
import { recordAudit } from '../audit/audit.service';
import { Homecell } from '../homecells/homecell.model';
import { getSettings } from '../settings/settings.service';
import { LedgerTransaction } from './ledger.model';
import { postTransaction, reverseTransaction } from './ledger.service';
import { Offering, OfferingChannel, type OfferingDoc } from './offering.model';
import { checkThresholdAndNotify } from './purse.service';

const SORTABLE = ['date', 'createdAt', 'amountMinor'];
const POPULATE = [
  { path: 'homecell', select: 'name code' },
  { path: 'recordedBy', select: 'firstName lastName' },
];

/** SRS 7.2 / BR-008. */
export function assertOfferingDateValid(date: string | Date): void {
  if (isSunday(date)) return;
  throw new BusinessRuleError(
    `Homecell offerings can only be recorded against a Sunday meeting. ${calendarDateString(
      date,
    )} is a ${weekdayName(date)}.`,
    'BR-008',
  );
}

export interface RecordOfferingInput {
  homecellId: string;
  /** Major units. */
  amount: number;
  date: string;
  channel?: OfferingChannel;
  description?: string;
  receiptUrl?: string;
  receiptPublicId?: string;
}

/**
 * Records a Sunday offering and posts the matching credit.
 *
 * The offering document and its ledger entry are written in one unit of work: an
 * offering can never exist without its posting, and a posting can never exist
 * without its source document.
 */
export async function recordOffering(
  actor: AuthenticatedUser,
  input: RecordOfferingInput,
  req: Request,
) {
  assertOfferingDateValid(input.date);
  await assertHomecellInScope(actor, input.homecellId);

  const homecell = await Homecell.findById(input.homecellId)
    .select('_id name area zone status')
    .lean();
  if (!homecell) throw new NotFoundError('Homecell');
  if (homecell.status === OrgStatus.INACTIVE) {
    throw new ConflictError('Offerings cannot be recorded for an inactive Homecell.');
  }

  const settings = await getSettings();
  const date = toCalendarDate(input.date);
  const amountMinor = toMinor(input.amount);
  const reference = references.offering();

  const channel = input.channel ?? OfferingChannel.CASH;

  // Guards against the same collection being keyed in twice. Online payments are
  // excluded: a provider-settled contribution on the same Sunday is a separate fact,
  // not a re-entry of this one.
  const duplicate = await Offering.findOne({
    homecell: homecell._id,
    date,
    channel: { $in: [OfferingChannel.CASH, OfferingChannel.BANK_TRANSFER] },
    status: TransactionStatus.POSTED,
  }).lean();
  if (duplicate) {
    throw new ConflictError(
      `An offering of ${formatMoney(duplicate.amountMinor, duplicate.currency)} has already been ` +
        `recorded for ${homecell.name} on ${calendarDateString(date)}. ` +
        'Reverse it first if it needs correcting.',
    );
  }

  const offeringId = await withTransaction(async ({ session, onRollback }) => {
    const [offering] = await Offering.create(
      [
        {
          reference,
          homecell: homecell._id,
          area: homecell.area,
          zone: homecell.zone,
          date,
          amountMinor,
          currency: settings.currency,
          channel,
          description: input.description,
          status: TransactionStatus.POSTED,
          receiptUrl: input.receiptUrl ?? null,
          receiptPublicId: input.receiptPublicId ?? null,
          recordedBy: actor.id,
        },
      ],
      { session: session ?? undefined },
    );
    onRollback(async () => {
      await Offering.deleteOne({ _id: offering._id });
    });

    const { transaction } = await postTransaction(
      {
        idempotencyKey: `offering:${idString(offering._id)}`,
        homecell: homecell._id,
        area: homecell.area,
        zone: homecell.zone,
        type: TransactionType.OFFERING,
        amountMinor,
        currency: settings.currency,
        valueDate: date,
        description:
          input.description ?? `Sunday Homecell offering — ${calendarDateString(date)}`,
        reference,
        sourceModel: 'Offering',
        sourceId: offering._id,
        supportingDocumentUrl: input.receiptUrl ?? null,
        createdBy: actor.id,
      },
      session,
    );
    onRollback(async () => {
      await LedgerTransaction.deleteOne({ _id: transaction._id });
    });

    offering.ledgerTransaction = transaction._id;
    await offering.save({ session: session ?? undefined });

    return idString(offering._id);
  });

  await recordAudit(
    {
      action: AuditAction.CREATE,
      module: AuditModule.FINANCE,
      description: `Recorded offering ${reference} of ${input.amount} for ${
        homecell.name
      } on ${calendarDateString(date)}`,
      entityModel: 'Offering',
      entityId: offeringId,
      entityLabel: reference,
      newValues: { amount: input.amount, date: calendarDateString(date), channel: input.channel },
      zone: homecell.zone,
      area: homecell.area,
      homecell: homecell._id,
    },
    req,
  );

  // A credit can push the purse over its limit (SRS 8.3).
  await checkThresholdAndNotify(idString(homecell._id));

  return getOffering(actor, offeringId);
}

export async function getOffering(actor: AuthenticatedUser, id: string) {
  const offering = await Offering.findById(id).populate(POPULATE).lean();
  if (!offering) throw new NotFoundError('Offering');
  await assertHomecellInScope(actor, offering.homecell);
  return offering;
}

export interface ListOfferingsQuery {
  page: number;
  limit: number;
  sort?: string;
  order: 'asc' | 'desc';
  zoneId?: string;
  areaId?: string;
  homecellId?: string;
  from?: string;
  to?: string;
  status?: TransactionStatus;
}

export async function listOfferings(actor: AuthenticatedUser, query: ListOfferingsQuery) {
  const scoped = await resolveScopedFilter<OfferingDoc>(actor, query);
  const filter: FilterQuery<OfferingDoc> = { ...scoped };
  if (query.status) filter.status = query.status;
  if (query.from || query.to) filter.date = dateRange(query.from, query.to) as never;

  return paginate(Offering, {
    filter,
    page: query.page,
    limit: query.limit,
    sort: buildSort(query.sort, query.order, SORTABLE, 'date'),
    populate: POPULATE,
  });
}

/**
 * Corrects a mistaken offering.
 *
 * The original record and its posting stay in place; a REVERSAL entry cancels the
 * credit and the offering is marked REVERSED (BR-016, SRS §8.8).
 */
export async function reverseOffering(
  actor: AuthenticatedUser,
  id: string,
  reason: string,
  req: Request,
) {
  const offering = await Offering.findById(id);
  if (!offering) throw new NotFoundError('Offering');
  await assertHomecellInScope(actor, offering.homecell);

  if (offering.status !== TransactionStatus.POSTED) {
    throw new ConflictError(`This offering is ${offering.status.toLowerCase()} and cannot be reversed.`);
  }
  if (!offering.ledgerTransaction) {
    throw new ConflictError('This offering has no ledger entry to reverse.');
  }

  await withTransaction(async ({ session }) => {
    await reverseTransaction(idString(offering.ledgerTransaction), reason, actor.id, session);
    offering.status = TransactionStatus.REVERSED;
    await offering.save({ session: session ?? undefined });
  });

  await recordAudit(
    {
      action: AuditAction.REVERSE,
      module: AuditModule.FINANCE,
      description: `Reversed offering ${offering.reference} — ${reason}`,
      entityModel: 'Offering',
      entityId: offering._id,
      entityLabel: offering.reference,
      previousValues: { status: TransactionStatus.POSTED },
      newValues: { status: TransactionStatus.REVERSED, reason },
      zone: offering.zone,
      area: offering.area,
      homecell: offering.homecell,
    },
    req,
  );

  return getOffering(actor, id);
}
