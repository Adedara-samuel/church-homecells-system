import type { Request } from 'express';
import type { ClientSession, FilterQuery, Types } from 'mongoose';
import { logger } from '../../config/logger';
import {
  assertHomecellInScope,
  assertZoneInScope,
  resolveScopedFilter,
  zoneScopeFilter,
} from '../../middleware/scope';
import { buildSort } from '../../middleware/validate';
import {
  AuditAction,
  AuditModule,
  DuesFrequency,
  DuesInvoiceStatus,
  NotificationSeverity,
  NotificationType,
  OrgStatus,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { dayjs } from '../../utils/dates';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { idString, references, toObjectId } from '../../utils/ids';
import { formatMoney, toMinor } from '../../utils/money';
import { paginate } from '../../utils/query';
import { recordAudit } from '../audit/audit.service';
import { Area } from '../areas/area.model';
import { assertSufficientBalance } from '../finance/ledger.service';
import { Homecell } from '../homecells/homecell.model';
import { notify, resolveEscalationRecipients } from '../notifications/notification.service';
import { getSettings } from '../settings/settings.service';
import { User } from '../users/user.model';
import { Zone } from '../zones/zone.model';
import {
  DuesDefinition,
  DuesInvoice,
  type DuesDefinitionDoc,
  type DuesInvoiceDoc,
} from './dues.model';

const INVOICE_SORTABLE = ['dueDate', 'createdAt', 'amountMinor', 'status'];
const INVOICE_POPULATE = [
  { path: 'homecell', select: 'name code' },
  { path: 'definition', select: 'name frequency' },
];

// ---------------------------------------------------------------------------
// Definitions — what a Zone charges
// ---------------------------------------------------------------------------

export interface DuesDefinitionInput {
  zoneId: string;
  name: string;
  description?: string;
  frequency: DuesFrequency;
  amount: number;
  startDate: string;
  endDate?: string;
  dueDate?: string;
  dueDayOfMonth?: number;
  isPrimaryMonthlyDue?: boolean;
}

/**
 * A one-off levy is only chargeable up to its due date. Rather than trusting a
 * scheduled job to have run, every read path calls this first, so a levy whose date
 * has passed is never offered for payment even if the sweep is late.
 */
export async function closeExpiredDefinitions(): Promise<number> {
  const now = new Date();
  const result = await DuesDefinition.updateMany(
    {
      frequency: DuesFrequency.ONE_OFF,
      status: OrgStatus.ACTIVE,
      dueDate: { $ne: null, $lt: now },
    },
    { $set: { status: OrgStatus.INACTIVE, autoClosedAt: now } },
  );
  if (result.modifiedCount > 0) {
    logger.info({ closed: result.modifiedCount }, 'Closed one-off levies past their due date');
  }
  return result.modifiedCount;
}

function assertDefinitionShape(input: {
  frequency: DuesFrequency;
  dueDate?: string | null;
  startDate: string;
  endDate?: string | null;
}): void {
  if (input.frequency === DuesFrequency.ONE_OFF && !input.dueDate) {
    throw new ValidationError('A one-off levy needs a due date.', [
      { field: 'dueDate', message: 'Select the date this levy is due.' },
    ]);
  }
  if (input.endDate && dayjs(input.endDate).isBefore(dayjs(input.startDate), 'day')) {
    throw new ValidationError('The end date cannot fall before the start date.', [
      { field: 'endDate', message: 'Choose a date on or after the start date.' },
    ]);
  }
  if (
    input.frequency === DuesFrequency.ONE_OFF &&
    input.dueDate &&
    dayjs(input.dueDate).isBefore(dayjs(input.startDate), 'day')
  ) {
    throw new ValidationError('The due date cannot fall before the start date.', [
      { field: 'dueDate', message: 'Choose a date on or after the start date.' },
    ]);
  }
}

/** Announces a new or re-opened charge to every Homecell and Area in the Zone. */
async function announceDefinition(
  definition: DuesDefinitionDoc,
  zoneName: string,
  currency: string,
  reopened: boolean,
): Promise<void> {
  const [homecells, areas] = await Promise.all([
    Homecell.find({ zone: definition.zone, status: OrgStatus.ACTIVE })
      .select('coordinator')
      .lean(),
    Area.find({ zone: definition.zone, status: OrgStatus.ACTIVE }).select('coordinator').lean(),
  ]);

  const zonalCoordinator = await Zone.findById(definition.zone).select('coordinator').lean();

  const recipients = [
    ...homecells.map((h) => h.coordinator),
    ...areas.map((a) => a.coordinator),
    zonalCoordinator?.coordinator,
  ].filter(Boolean) as Types.ObjectId[];

  const due =
    definition.frequency === DuesFrequency.ONE_OFF && definition.dueDate
      ? `Due ${dayjs(definition.dueDate).format('D MMMM YYYY')}.`
      : `Due on day ${definition.dueDayOfMonth} of each month.`;

  await notify({
    recipients,
    type: NotificationType.DUES_ISSUED,
    severity: NotificationSeverity.INFO,
    title: reopened ? `${definition.name} has been re-opened` : `New charge: ${definition.name}`,
    message:
      `${zoneName} has ${reopened ? 're-opened' : 'introduced'} ${definition.name} at ` +
      `${formatMoney(definition.amountMinor, currency)}${
        definition.frequency === DuesFrequency.MONTHLY ? ' per month' : ''
      }. ${due}`,
    entityModel: 'DuesDefinition',
    entityId: definition._id,
    actionUrl: '/finance/dues',
    zone: definition.zone,
  });
}

export async function createDefinition(
  actor: AuthenticatedUser,
  input: DuesDefinitionInput,
  req: Request,
) {
  assertZoneInScope(actor, input.zoneId);
  const zone = await Zone.findById(input.zoneId).select('name').lean();
  if (!zone) throw new NotFoundError('Zone');

  assertDefinitionShape(input);
  const settings = await getSettings();

  if (input.isPrimaryMonthlyDue && input.frequency !== DuesFrequency.MONTHLY) {
    throw new ValidationError('The standing monthly due must use the monthly frequency.');
  }

  let definition;
  try {
    definition = await DuesDefinition.create({
      zone: toObjectId(input.zoneId),
      name: input.name,
      description: input.description ?? null,
      frequency: input.frequency,
      amountMinor: toMinor(input.amount),
      currency: settings.currency,
      startDate: dayjs(input.startDate).startOf('day').toDate(),
      endDate: input.endDate ? dayjs(input.endDate).endOf('day').toDate() : null,
      dueDate: input.dueDate ? dayjs(input.dueDate).endOf('day').toDate() : null,
      dueDayOfMonth: input.dueDayOfMonth ?? 10,
      isPrimaryMonthlyDue: input.isPrimaryMonthlyDue ?? false,
      status: OrgStatus.ACTIVE,
      createdBy: toObjectId(actor.id),
    });
  } catch (err) {
    // The partial unique index on `isPrimaryMonthlyDue` is what enforces "one
    // standing monthly due per Zone" under concurrency.
    if ((err as { code?: number }).code === 11000) {
      throw new ConflictError(
        'This Zone already has a standing monthly due. Edit the existing one instead.',
      );
    }
    throw err;
  }

  await recordAudit(
    {
      action: AuditAction.CREATE,
      module: AuditModule.FINANCE,
      description: `Created ${input.frequency.toLowerCase()} charge "${definition.name}" of ${formatMoney(
        definition.amountMinor,
        settings.currency,
      )} for ${zone.name}`,
      entityModel: 'DuesDefinition',
      entityId: definition._id,
      entityLabel: definition.name,
      newValues: { amount: input.amount, frequency: input.frequency },
      zone: definition.zone,
    },
    req,
  );

  await announceDefinition(definition, zone.name, settings.currency, false);
  return definition.toObject();
}

export async function updateDefinition(
  actor: AuthenticatedUser,
  id: string,
  input: Partial<DuesDefinitionInput>,
  req: Request,
) {
  const definition = await DuesDefinition.findById(id);
  if (!definition) throw new NotFoundError('Dues definition');
  assertZoneInScope(actor, definition.zone);

  const before = {
    name: definition.name,
    amountMinor: definition.amountMinor,
    dueDayOfMonth: definition.dueDayOfMonth,
  };

  if (input.name !== undefined) definition.name = input.name;
  if (input.description !== undefined) definition.description = input.description;
  if (input.amount !== undefined) definition.amountMinor = toMinor(input.amount);
  if (input.dueDayOfMonth !== undefined) definition.dueDayOfMonth = input.dueDayOfMonth;
  if (input.startDate) definition.startDate = dayjs(input.startDate).startOf('day').toDate();
  if (input.endDate !== undefined) {
    definition.endDate = input.endDate ? dayjs(input.endDate).endOf('day').toDate() : null;
  }
  if (input.dueDate !== undefined) {
    definition.dueDate = input.dueDate ? dayjs(input.dueDate).endOf('day').toDate() : null;
    // Giving an expired levy a future due date brings it back to life.
    if (definition.dueDate && definition.dueDate > new Date()) {
      definition.status = OrgStatus.ACTIVE;
      definition.autoClosedAt = null;
    }
  }
  definition.updatedBy = toObjectId(actor.id);
  await definition.save();

  await recordAudit(
    {
      action: AuditAction.UPDATE,
      module: AuditModule.FINANCE,
      description: `Updated charge "${definition.name}"`,
      entityModel: 'DuesDefinition',
      entityId: definition._id,
      entityLabel: definition.name,
      previousValues: before,
      newValues: {
        name: definition.name,
        amountMinor: definition.amountMinor,
        dueDayOfMonth: definition.dueDayOfMonth,
      },
      zone: definition.zone,
    },
    req,
  );

  // Amounts already invoiced are deliberately left alone: an invoice is a record of
  // what was owed at the time it was raised, not a live view of the current rate.
  return definition.toObject();
}

/**
 * Switches a charge on or off.
 *
 * Re-opening a one-off levy — the anniversary levy next year — requires a new due
 * date, because the old one is in the past and would close it again immediately.
 * Outstanding invoices already raised are untouched either way: switching a levy off
 * stops future billing, it does not forgive an existing debt.
 */
export async function setDefinitionStatus(
  actor: AuthenticatedUser,
  id: string,
  status: OrgStatus,
  dueDate: string | undefined,
  req: Request,
) {
  const definition = await DuesDefinition.findById(id);
  if (!definition) throw new NotFoundError('Dues definition');
  assertZoneInScope(actor, definition.zone);

  const reopening = status === OrgStatus.ACTIVE && definition.status !== OrgStatus.ACTIVE;

  if (reopening && definition.frequency === DuesFrequency.ONE_OFF) {
    const next = dueDate ? dayjs(dueDate).endOf('day') : null;
    if (!next || !next.isAfter(dayjs())) {
      throw new ValidationError(
        'Re-opening a levy needs a new due date in the future — usually the same date next year.',
        [{ field: 'dueDate', message: 'Choose a future due date.' }],
      );
    }
    definition.dueDate = next.toDate();
    definition.autoClosedAt = null;
  }

  definition.status = status;
  definition.updatedBy = toObjectId(actor.id);
  await definition.save();

  await recordAudit(
    {
      action: AuditAction.UPDATE,
      module: AuditModule.FINANCE,
      description: `${status === OrgStatus.ACTIVE ? 'Re-opened' : 'Closed'} charge "${definition.name}"`,
      entityModel: 'DuesDefinition',
      entityId: definition._id,
      entityLabel: definition.name,
      newValues: { status, dueDate: definition.dueDate },
      zone: definition.zone,
    },
    req,
  );

  if (reopening) {
    const zone = await Zone.findById(definition.zone).select('name').lean();
    const settings = await getSettings();
    await announceDefinition(definition, zone?.name ?? 'Your zone', settings.currency, true);
  }

  return definition.toObject();
}

export async function listDefinitions(actor: AuthenticatedUser, query: { zoneId?: string }) {
  await closeExpiredDefinitions();

  const filter: FilterQuery<DuesDefinitionDoc> = { ...zoneScopeFilter(actor) };
  if (query.zoneId) {
    assertZoneInScope(actor, query.zoneId);
    filter.zone = toObjectId(query.zoneId);
  }
  return DuesDefinition.find(filter).populate('zone', 'name code').sort({ createdAt: -1 }).lean();
}

// ---------------------------------------------------------------------------
// Invoice generation
// ---------------------------------------------------------------------------

function monthLabel(month: dayjs.Dayjs): string {
  return month.format('MMMM YYYY');
}

/**
 * Raises every invoice a Homecell should have and does not yet.
 *
 * Monthly charges accrue from the later of the Homecell's creation month and the
 * charge's start month, through the current month — so a Homecell created in March
 * owes March onward, and never anything from before it existed.
 *
 * Safe to call from anywhere, at any frequency: the unique index on
 * `(homecell, definition, periodKey)` makes a duplicate insert a no-op rather than a
 * second debt. Returns how many invoices were newly created.
 */
export async function ensureInvoicesForHomecell(homecellId: string | Types.ObjectId): Promise<number> {
  const homecell = await Homecell.findById(homecellId)
    .select('_id area zone status createdAt')
    .lean();
  if (!homecell || homecell.status !== OrgStatus.ACTIVE) return 0;

  await closeExpiredDefinitions();

  const definitions = await DuesDefinition.find({
    zone: homecell.zone,
    status: OrgStatus.ACTIVE,
  }).lean();
  if (definitions.length === 0) return 0;

  const now = dayjs();
  const documents: Partial<DuesInvoiceDoc>[] = [];

  for (const definition of definitions) {
    if (definition.frequency === DuesFrequency.ONE_OFF) {
      if (!definition.dueDate || dayjs(definition.dueDate).isBefore(now)) continue;
      // A Homecell created after the levy was announced is still liable for it.
      const period = dayjs(definition.dueDate);
      documents.push({
        reference: references.duesInvoice(),
        definition: definition._id,
        homecell: homecell._id,
        area: homecell.area,
        zone: homecell.zone,
        name: definition.name,
        frequency: definition.frequency,
        periodKey: `ONEOFF-${period.format('YYYY-MM-DD')}`,
        periodLabel: `${definition.name} ${period.format('YYYY')}`,
        periodStart: dayjs(definition.startDate).startOf('day').toDate(),
        periodEnd: period.endOf('day').toDate(),
        dueDate: period.endOf('day').toDate(),
        amountMinor: definition.amountMinor,
        currency: definition.currency,
        status: DuesInvoiceStatus.OUTSTANDING,
      });
      continue;
    }

    // Monthly: walk from the first chargeable month to the current one.
    const homecellStart = dayjs(homecell.createdAt).startOf('month');
    const definitionStart = dayjs(definition.startDate).startOf('month');
    let cursor = homecellStart.isAfter(definitionStart) ? homecellStart : definitionStart;
    const last = definition.endDate
      ? dayjs(definition.endDate).startOf('month')
      : now.startOf('month');

    // A guard rail rather than a business rule: a misconfigured start date decades in
    // the past must not create thousands of invoices in one request.
    let guard = 0;
    while (!cursor.isAfter(last) && guard < 240) {
      guard += 1;
      documents.push({
        reference: references.duesInvoice(),
        definition: definition._id,
        homecell: homecell._id,
        area: homecell.area,
        zone: homecell.zone,
        name: definition.name,
        frequency: definition.frequency,
        periodKey: cursor.format('YYYY-MM'),
        periodLabel: monthLabel(cursor),
        periodStart: cursor.startOf('month').toDate(),
        periodEnd: cursor.endOf('month').toDate(),
        dueDate: cursor.date(definition.dueDayOfMonth).endOf('day').toDate(),
        amountMinor: definition.amountMinor,
        currency: definition.currency,
        status: DuesInvoiceStatus.OUTSTANDING,
      });
      cursor = cursor.add(1, 'month');
    }
  }

  if (documents.length === 0) return 0;

  // `ordered: false` lets the insert continue past the duplicates that every run
  // after the first will produce — those are the invoices that already exist.
  try {
    const inserted = await DuesInvoice.insertMany(documents, { ordered: false });
    return inserted.length;
  } catch (err) {
    const bulk = err as { code?: number; insertedDocs?: unknown[]; writeErrors?: unknown[] };
    if (bulk.code === 11000 || Array.isArray(bulk.writeErrors)) {
      return bulk.insertedDocs?.length ?? 0;
    }
    throw err;
  }
}

/** Scheduled sweep: keeps every active Homecell's invoices current. */
export async function generateAllInvoices(): Promise<{ homecells: number; created: number }> {
  const homecells = await Homecell.find({ status: OrgStatus.ACTIVE }).select('_id').lean();
  let created = 0;
  for (const homecell of homecells) {
    created += await ensureInvoicesForHomecell(homecell._id);
  }
  return { homecells: homecells.length, created };
}

// ---------------------------------------------------------------------------
// Reading what is owed
// ---------------------------------------------------------------------------

export interface DuesStatement {
  homecellId: string;
  homecellName: string;
  homecellCode: string;
  currency: string;
  outstanding: {
    id: string;
    reference: string;
    name: string;
    frequency: DuesFrequency;
    periodKey: string;
    periodLabel: string;
    dueDate: string;
    amountMinor: number;
    amount: number;
    status: DuesInvoiceStatus;
    overdue: boolean;
  }[];
  totalOutstandingMinor: number;
  overdueCount: number;
  /** Invoices with a checkout already open — shown but not selectable. */
  processingCount: number;
  paidThisYearMinor: number;
}

export async function getDuesStatement(
  actor: AuthenticatedUser,
  homecellId: string,
): Promise<DuesStatement> {
  await assertHomecellInScope(actor, homecellId);
  const homecell = await Homecell.findById(homecellId).select('name code').lean();
  if (!homecell) throw new NotFoundError('Homecell');

  // Generated on read so a coordinator opening the page always sees an up-to-date
  // position, even if the nightly sweep has not run since the month turned over.
  await ensureInvoicesForHomecell(homecellId);

  const settings = await getSettings();
  const invoices = await DuesInvoice.find({
    homecell: toObjectId(homecellId),
    status: { $in: [DuesInvoiceStatus.OUTSTANDING, DuesInvoiceStatus.PROCESSING] },
  })
    .sort({ dueDate: 1 })
    .lean();

  const now = new Date();
  const yearStart = dayjs().startOf('year').toDate();
  const paidThisYear = await DuesInvoice.aggregate<{ total: number }>([
    {
      $match: {
        homecell: toObjectId(homecellId),
        status: DuesInvoiceStatus.PAID,
        paidAt: { $gte: yearStart },
      },
    },
    { $group: { _id: null, total: { $sum: '$amountMinor' } } },
  ]);

  const outstanding = invoices.map((invoice) => ({
    id: idString(invoice._id),
    reference: invoice.reference,
    name: invoice.name,
    frequency: invoice.frequency,
    periodKey: invoice.periodKey,
    periodLabel: invoice.periodLabel,
    dueDate: invoice.dueDate.toISOString(),
    amountMinor: invoice.amountMinor,
    amount: invoice.amountMinor / 100,
    status: invoice.status,
    overdue: invoice.status === DuesInvoiceStatus.OUTSTANDING && invoice.dueDate < now,
  }));

  return {
    homecellId: idString(homecell._id),
    homecellName: homecell.name,
    homecellCode: homecell.code,
    currency: settings.currency,
    outstanding,
    totalOutstandingMinor: outstanding
      .filter((i) => i.status === DuesInvoiceStatus.OUTSTANDING)
      .reduce((sum, i) => sum + i.amountMinor, 0),
    overdueCount: outstanding.filter((i) => i.overdue).length,
    processingCount: outstanding.filter((i) => i.status === DuesInvoiceStatus.PROCESSING).length,
    paidThisYearMinor: paidThisYear[0]?.total ?? 0,
  };
}

export interface ListInvoicesQuery {
  page: number;
  limit: number;
  sort?: string;
  order: 'asc' | 'desc';
  zoneId?: string;
  areaId?: string;
  homecellId?: string;
  status?: DuesInvoiceStatus;
}

export async function listInvoices(actor: AuthenticatedUser, query: ListInvoicesQuery) {
  const scoped = await resolveScopedFilter<DuesInvoiceDoc>(actor, query);
  const filter: FilterQuery<DuesInvoiceDoc> = { ...scoped };
  if (query.status) filter.status = query.status;

  return paginate(DuesInvoice, {
    filter,
    page: query.page,
    limit: query.limit,
    sort: buildSort(query.sort, query.order, INVOICE_SORTABLE, 'dueDate'),
    populate: INVOICE_POPULATE,
  });
}

export async function waiveInvoice(
  actor: AuthenticatedUser,
  id: string,
  reason: string,
  req: Request,
) {
  const invoice = await DuesInvoice.findById(id);
  if (!invoice) throw new NotFoundError('Dues invoice');
  assertZoneInScope(actor, invoice.zone);

  if (invoice.status !== DuesInvoiceStatus.OUTSTANDING) {
    throw new ConflictError(
      `This invoice is ${invoice.status.toLowerCase()} and can no longer be waived.`,
    );
  }

  invoice.status = DuesInvoiceStatus.WAIVED;
  invoice.waivedBy = toObjectId(actor.id);
  invoice.waivedAt = new Date();
  invoice.waiverReason = reason;
  await invoice.save();

  await recordAudit(
    {
      action: AuditAction.UPDATE,
      module: AuditModule.FINANCE,
      description: `Waived ${invoice.name} for ${invoice.periodLabel} — ${reason}`,
      entityModel: 'DuesInvoice',
      entityId: invoice._id,
      entityLabel: invoice.reference,
      newValues: { status: DuesInvoiceStatus.WAIVED, reason },
      zone: invoice.zone,
      area: invoice.area,
      homecell: invoice.homecell,
    },
    req,
  );

  return invoice.toObject();
}

// ---------------------------------------------------------------------------
// Payment — claim, settle, release
// ---------------------------------------------------------------------------

export interface SelectedInvoices {
  homecellId: string;
  invoices: DuesInvoiceDoc[];
  totalMinor: number;
  currency: string;
}

/**
 * Validates a selection of invoices and prices it.
 *
 * Everything that could make the total wrong is checked here, before any money is
 * asked for: the invoices must exist, belong to this Homecell, still be outstanding,
 * and share one currency.
 */
export async function priceSelection(
  actor: AuthenticatedUser,
  homecellId: string,
  invoiceIds: string[] | undefined,
): Promise<SelectedInvoices> {
  await assertHomecellInScope(actor, homecellId);
  await ensureInvoicesForHomecell(homecellId);

  const filter: FilterQuery<DuesInvoiceDoc> = {
    homecell: toObjectId(homecellId),
    status: DuesInvoiceStatus.OUTSTANDING,
  };
  // No explicit selection means "pay everything outstanding".
  if (invoiceIds?.length) filter._id = { $in: invoiceIds.map(toObjectId) };

  const invoices = await DuesInvoice.find(filter).sort({ dueDate: 1 }).lean();

  // An explicit selection that no longer matches is a state conflict, not bad input:
  // the caller sent something that was valid when the page was rendered, and the right
  // answer is "refresh and look again".
  if (invoiceIds?.length && invoices.length !== invoiceIds.length) {
    throw new ConflictError(
      'Some of the selected charges are no longer outstanding — they may already be paid or have a payment in progress. Refresh and try again.',
    );
  }
  if (invoices.length === 0) {
    throw new ValidationError('This Homecell has nothing outstanding.');
  }

  const currencies = new Set(invoices.map((i) => i.currency));
  if (currencies.size > 1) {
    throw new ValidationError('Charges in different currencies must be paid separately.');
  }

  return {
    homecellId,
    invoices,
    totalMinor: invoices.reduce((sum, invoice) => sum + invoice.amountMinor, 0),
    currency: invoices[0].currency,
  };
}

/**
 * Reserves invoices against a payment.
 *
 * The update is conditional on each invoice still being OUTSTANDING with no payment
 * attached, so two coordinators pressing "Pay" at the same moment cannot both claim
 * the same month — the second finds nothing to claim and is told to refresh.
 */
export async function claimInvoices(
  invoiceIds: (string | Types.ObjectId)[],
  paymentId: Types.ObjectId,
  provider: DuesInvoiceDoc['paymentProvider'],
): Promise<void> {
  const ids = invoiceIds.map(toObjectId);
  const result = await DuesInvoice.updateMany(
    { _id: { $in: ids }, status: DuesInvoiceStatus.OUTSTANDING, payment: null },
    {
      $set: {
        status: DuesInvoiceStatus.PROCESSING,
        payment: paymentId,
        paymentProvider: provider ?? null,
      },
    },
  );

  if (result.modifiedCount !== ids.length) {
    // Put back whatever this attempt did manage to take, so a partial claim never
    // leaves invoices stranded in PROCESSING against an abandoned payment.
    await releaseInvoicesForPayment(paymentId);
    throw new ConflictError(
      'Some of these charges were just paid or are already being paid. Refresh and try again.',
    );
  }
}

/** Returns claimed invoices to OUTSTANDING when a payment fails or is abandoned. */
export async function releaseInvoicesForPayment(
  paymentId: Types.ObjectId | string,
): Promise<number> {
  const result = await DuesInvoice.updateMany(
    { payment: toObjectId(paymentId), status: DuesInvoiceStatus.PROCESSING },
    { $set: { status: DuesInvoiceStatus.OUTSTANDING, payment: null, paymentProvider: null } },
  );
  return result.modifiedCount;
}

/**
 * Marks the invoices behind a settled payment as paid.
 *
 * Called from inside the settlement transaction, after the single ledger debit for the
 * whole payment has been posted, and given that transaction's session so the invoices
 * and the ledger entry commit together or not at all.
 */
export async function settleInvoicesForPayment(
  paymentId: Types.ObjectId,
  ledgerTransactionId: Types.ObjectId,
  providerReference: string | null | undefined,
  paidBy: Types.ObjectId | null | undefined,
  session: ClientSession | undefined,
): Promise<DuesInvoiceDoc[]> {
  const invoices = await DuesInvoice.find({ payment: paymentId })
    .session(session ?? null)
    .lean();

  await DuesInvoice.updateMany(
    { payment: paymentId, status: { $ne: DuesInvoiceStatus.PAID } },
    {
      $set: {
        status: DuesInvoiceStatus.PAID,
        ledgerTransaction: ledgerTransactionId,
        providerReference: providerReference ?? null,
        paidAt: new Date(),
        paidBy: paidBy ?? null,
      },
    },
    { session: session ?? undefined },
  );

  return invoices;
}

/**
 * Confirms the purse can cover a dues payment.
 *
 * Dues are settled out of Homecell funds, so the same balance rule that governs a
 * remittance applies: money that is not in the purse cannot be sent to the Zone.
 */
export async function assertCanAffordDues(
  homecellId: string,
  totalMinor: number,
  currency: string,
): Promise<void> {
  await assertSufficientBalance(toObjectId(homecellId), totalMinor, currency);
}

// ---------------------------------------------------------------------------
// Due-date reminders
// ---------------------------------------------------------------------------

/**
 * Notifies Homecell and Area coordinators about charges falling due today and about
 * anything already overdue. The `dedupeKey` keeps a long-overdue invoice to one live
 * prompt rather than one per day.
 */
export async function notifyDueAndOverdue(): Promise<{ due: number; overdue: number }> {
  const settings = await getSettings();
  const todayStart = dayjs().startOf('day').toDate();
  const todayEnd = dayjs().endOf('day').toDate();

  const dueToday = await DuesInvoice.find({
    status: DuesInvoiceStatus.OUTSTANDING,
    dueDate: { $gte: todayStart, $lte: todayEnd },
  }).lean();

  const overdue = await DuesInvoice.find({
    status: DuesInvoiceStatus.OUTSTANDING,
    dueDate: { $lt: todayStart },
  }).lean();

  for (const invoice of dueToday) {
    const recipients = await resolveEscalationRecipients({
      homecellId: invoice.homecell,
      areaId: invoice.area,
      includeHomecell: true,
      includeArea: true,
    });
    await notify({
      recipients,
      type: NotificationType.DUES_DUE,
      severity: NotificationSeverity.WARNING,
      title: `${invoice.name} is due today`,
      message: `${invoice.name} for ${invoice.periodLabel} — ${formatMoney(
        invoice.amountMinor,
        settings.currency,
      )} — is due today.`,
      entityModel: 'DuesInvoice',
      entityId: invoice._id,
      actionUrl: `/finance/remittances?tab=dues&homecellId=${idString(invoice.homecell)}`,
      homecell: invoice.homecell,
      area: invoice.area,
      zone: invoice.zone,
      dedupeKey: `dues-due:${idString(invoice._id)}`,
    });
  }

  for (const invoice of overdue) {
    const recipients = await resolveEscalationRecipients({
      homecellId: invoice.homecell,
      areaId: invoice.area,
      zoneId: invoice.zone,
      includeHomecell: true,
      includeArea: true,
      includeZone: true,
    });
    await notify({
      recipients,
      type: NotificationType.DUES_OVERDUE,
      severity: NotificationSeverity.CRITICAL,
      title: `${invoice.name} is overdue`,
      message: `${invoice.name} for ${invoice.periodLabel} — ${formatMoney(
        invoice.amountMinor,
        settings.currency,
      )} — was due on ${dayjs(invoice.dueDate).format('D MMMM YYYY')} and is still unpaid.`,
      entityModel: 'DuesInvoice',
      entityId: invoice._id,
      actionUrl: `/finance/remittances?tab=dues&homecellId=${idString(invoice.homecell)}`,
      homecell: invoice.homecell,
      area: invoice.area,
      zone: invoice.zone,
      dedupeKey: `dues-overdue:${idString(invoice._id)}`,
    });
  }

  return { due: dueToday.length, overdue: overdue.length };
}

/** Notifies a Homecell that its dues payment cleared. */
export async function notifyDuesPaid(
  homecell: Types.ObjectId,
  area: Types.ObjectId,
  zone: Types.ObjectId,
  invoices: DuesInvoiceDoc[],
  totalMinor: number,
  currency: string,
  paymentReference: string,
): Promise<void> {
  const recipients = await resolveEscalationRecipients({
    homecellId: homecell,
    areaId: area,
    includeHomecell: true,
    includeArea: true,
  });
  const periods = invoices.map((i) => i.periodLabel).join(', ');
  await notify({
    recipients,
    type: NotificationType.DUES_PAID,
    severity: NotificationSeverity.SUCCESS,
    title: 'Dues payment received',
    message: `${formatMoney(totalMinor, currency)} covering ${periods} has been received. Receipt ${paymentReference}.`,
    entityModel: 'Payment',
    entityId: null,
    actionUrl: `/finance/payments/receipt/${encodeURIComponent(paymentReference)}`,
    homecell,
    area,
    zone,
  });
}

/** Coordinator display name for a receipt. */
export async function coordinatorName(userId: Types.ObjectId | string | null | undefined) {
  if (!userId) return null;
  const user = await User.findById(userId).select('firstName lastName').lean();
  return user ? `${user.firstName} ${user.lastName}` : null;
}
