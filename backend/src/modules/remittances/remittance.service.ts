import type { Request } from 'express';
import type { FilterQuery } from 'mongoose';
import { withTransaction } from '../../db/transaction';
import { assertHomecellInScope, resolveScopedFilter } from '../../middleware/scope';
import { buildSort } from '../../middleware/validate';
import {
  AuditAction,
  AuditModule,
  NotificationSeverity,
  NotificationType,
  RemittanceChannel,
  RemittanceStatus,
  TransactionType,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { dateRange, toCalendarDate } from '../../utils/dates';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { idString, references, toObjectId } from '../../utils/ids';
import { formatMoney, toMinor } from '../../utils/money';
import { paginate } from '../../utils/query';
import { recordAudit } from '../audit/audit.service';
import { Homecell } from '../homecells/homecell.model';
import { LedgerTransaction } from '../finance/ledger.model';
import {
  assertSufficientBalance,
  postTransaction,
  reverseTransaction,
} from '../finance/ledger.service';
import { notify, resolveEscalationRecipients } from '../notifications/notification.service';
import { createOutboundPayment } from '../payments/payment.service';
import { getSettings } from '../settings/settings.service';
import { Remittance, type RemittanceDoc } from './remittance.model';

const SORTABLE = ['date', 'createdAt', 'amountMinor', 'status'];
const POPULATE = [
  { path: 'homecell', select: 'name code' },
  { path: 'recordedBy', select: 'firstName lastName' },
  { path: 'approvedBy', select: 'firstName lastName' },
  { path: 'verifiedBy', select: 'firstName lastName' },
];

export interface RecordRemittanceInput {
  homecellId: string;
  amount: number;
  date: string;
  channel?: RemittanceChannel;
  paymentReference?: string;
  receivingAccount?: string;
  description?: string;
  receiptUrl?: string;
  receiptPublicId?: string;
  /** Required when disbursing through the payment provider. */
  bankCode?: string;
  accountNumber?: string;
  accountName?: string;
}

/**
 * Records a remittance.
 *
 * SRS 8.6 / BR-011/BR-012: this never edits a balance. It creates a remittance
 * document whose lifecycle ends in a DEBIT posting once — and only once — the
 * business condition for its channel is satisfied:
 *
 *   MANUAL            → an authorised user verifies the uploaded proof of payment
 *   PROVIDER_TRANSFER → the provider's webhook confirms the payout succeeded
 */
export async function recordRemittance(
  actor: AuthenticatedUser,
  input: RecordRemittanceInput,
  req: Request,
) {
  await assertHomecellInScope(actor, input.homecellId);
  const homecell = await Homecell.findById(input.homecellId).select('_id name area zone').lean();
  if (!homecell) throw new NotFoundError('Homecell');

  const settings = await getSettings();
  const amountMinor = toMinor(input.amount);
  const channel = input.channel ?? RemittanceChannel.MANUAL;

  if (settings.remittanceRequiresReceipt && channel === RemittanceChannel.MANUAL && !input.receiptUrl) {
    throw new ValidationError('Proof of payment is required for a manual remittance.', [
      { field: 'receiptUrl', message: 'Upload the payment receipt.' },
    ]);
  }

  // The purse must be able to cover it before anything is promised.
  await assertSufficientBalance(homecell._id, amountMinor, settings.currency);

  const remittance = await Remittance.create({
    reference: references.remittance(),
    homecell: homecell._id,
    area: homecell.area,
    zone: homecell.zone,
    date: toCalendarDate(input.date),
    amountMinor,
    currency: settings.currency,
    channel,
    status: settings.remittanceRequiresApproval
      ? RemittanceStatus.PENDING_APPROVAL
      : RemittanceStatus.APPROVED,
    paymentReference: input.paymentReference ?? null,
    receivingAccount: input.receivingAccount ?? settings.generalPurseAccountName,
    description: input.description,
    receiptUrl: input.receiptUrl ?? null,
    receiptPublicId: input.receiptPublicId ?? null,
    recordedBy: actor.id,
  });

  await recordAudit(
    {
      action: AuditAction.CREATE,
      module: AuditModule.REMITTANCES,
      description: `Recorded remittance ${remittance.reference} of ${formatMoney(
        amountMinor,
        settings.currency,
      )} from ${homecell.name}`,
      entityModel: 'Remittance',
      entityId: remittance._id,
      entityLabel: remittance.reference,
      newValues: { amount: input.amount, channel, status: remittance.status },
      zone: homecell.zone,
      area: homecell.area,
      homecell: homecell._id,
    },
    req,
  );

  const recipients = await resolveEscalationRecipients({
    homecellId: homecell._id,
    areaId: homecell.area,
    zoneId: homecell.zone,
    includeHomecell: false,
    includeArea: true,
    includeZone: true,
  });
  await notify({
    recipients,
    type: NotificationType.REMITTANCE_SUBMITTED,
    severity: NotificationSeverity.INFO,
    title: 'Remittance submitted',
    message: `${homecell.name} submitted a remittance of ${formatMoney(
      amountMinor,
      settings.currency,
    )} to the General Homecell Purse.`,
    entityModel: 'Remittance',
    entityId: remittance._id,
    actionUrl: `/finance/remittances/${idString(remittance._id)}`,
    homecell: homecell._id,
    area: homecell.area,
    zone: homecell.zone,
  });

  // Without an approval requirement, a manual remittance is verified immediately by
  // the recording user; a provider transfer still waits for its webhook.
  if (
    !settings.remittanceRequiresApproval &&
    channel === RemittanceChannel.MANUAL
  ) {
    await postRemittanceDebit(idString(remittance._id), actor.id);
  }

  return getRemittance(actor, idString(remittance._id));
}

/** Creates the DEBIT posting that actually moves the money out of the purse. */
async function postRemittanceDebit(remittanceId: string, actorId: string): Promise<void> {
  await withTransaction(async ({ session, onRollback }) => {
    const remittance = await Remittance.findById(remittanceId).session(session ?? null);
    if (!remittance) throw new NotFoundError('Remittance');
    if (remittance.ledgerTransaction) return;

    await assertSufficientBalance(
      remittance.homecell,
      remittance.amountMinor,
      remittance.currency,
    );

    const { transaction } = await postTransaction(
      {
        idempotencyKey: `remittance:${idString(remittance._id)}`,
        homecell: remittance.homecell,
        area: remittance.area,
        zone: remittance.zone,
        type: TransactionType.REMITTANCE,
        amountMinor: remittance.amountMinor,
        currency: remittance.currency,
        valueDate: remittance.date,
        description:
          remittance.description ?? `Remittance to ${remittance.receivingAccount}`,
        reference: remittance.reference,
        sourceModel: 'Remittance',
        sourceId: remittance._id,
        supportingDocumentUrl: remittance.receiptUrl,
        providerReference: remittance.providerReference,
        paymentProvider: remittance.paymentProvider,
        createdBy: remittance.recordedBy,
        approvedBy: actorId,
        approvedAt: new Date(),
      },
      session,
    );
    onRollback(async () => {
      await LedgerTransaction.deleteOne({ _id: transaction._id });
    });

    remittance.ledgerTransaction = transaction._id;
    remittance.status = RemittanceStatus.SUCCESSFUL;
    remittance.verifiedBy = toObjectId(actorId);
    remittance.verifiedAt = new Date();
    await remittance.save({ session: session ?? undefined });
  });
}

export async function approveRemittance(actor: AuthenticatedUser, id: string, req: Request) {
  const remittance = await Remittance.findById(id);
  if (!remittance) throw new NotFoundError('Remittance');
  await assertHomecellInScope(actor, remittance.homecell);

  if (remittance.status !== RemittanceStatus.PENDING_APPROVAL) {
    throw new ConflictError(
      `This remittance is ${remittance.status.toLowerCase().replace(/_/g, ' ')} and cannot be approved.`,
    );
  }

  remittance.status = RemittanceStatus.APPROVED;
  remittance.approvedBy = toObjectId(actor.id);
  remittance.approvedAt = new Date();
  await remittance.save();

  await recordAudit(
    {
      action: AuditAction.APPROVE,
      module: AuditModule.REMITTANCES,
      description: `Approved remittance ${remittance.reference}`,
      entityModel: 'Remittance',
      entityId: remittance._id,
      entityLabel: remittance.reference,
      newValues: { status: RemittanceStatus.APPROVED },
      zone: remittance.zone,
      area: remittance.area,
      homecell: remittance.homecell,
    },
    req,
  );

  await notify({
    recipients: [idString(remittance.recordedBy)],
    type: NotificationType.REMITTANCE_APPROVED,
    severity: NotificationSeverity.SUCCESS,
    title: 'Remittance approved',
    message: `Remittance ${remittance.reference} of ${formatMoney(
      remittance.amountMinor,
      remittance.currency,
    )} has been approved.`,
    entityModel: 'Remittance',
    entityId: remittance._id,
    actionUrl: `/finance/remittances/${idString(remittance._id)}`,
    homecell: remittance.homecell,
    area: remittance.area,
    zone: remittance.zone,
  });

  return getRemittance(actor, id);
}

/**
 * Confirms a manual remittance against its uploaded proof and posts the debit.
 * This is the moment a manual remittance affects the balance (BR-011, BR-013).
 */
export async function verifyRemittance(actor: AuthenticatedUser, id: string, req: Request) {
  const remittance = await Remittance.findById(id);
  if (!remittance) throw new NotFoundError('Remittance');
  await assertHomecellInScope(actor, remittance.homecell);

  if (remittance.channel !== RemittanceChannel.MANUAL) {
    throw new ConflictError(
      'A provider-processed remittance is confirmed automatically by the payment webhook.',
    );
  }
  if (remittance.status !== RemittanceStatus.APPROVED) {
    throw new ConflictError('Only an approved remittance can be verified.');
  }

  const settings = await getSettings();
  if (settings.remittanceRequiresReceipt && !remittance.receiptUrl) {
    throw new ValidationError(
      'Proof of payment must be attached before this remittance can be verified.',
    );
  }

  await postRemittanceDebit(id, actor.id);

  await recordAudit(
    {
      action: AuditAction.APPROVE,
      module: AuditModule.REMITTANCES,
      description: `Verified remittance ${remittance.reference} — ${formatMoney(
        remittance.amountMinor,
        remittance.currency,
      )} deducted from the Homecell purse`,
      entityModel: 'Remittance',
      entityId: remittance._id,
      entityLabel: remittance.reference,
      newValues: { status: RemittanceStatus.SUCCESSFUL },
      zone: remittance.zone,
      area: remittance.area,
      homecell: remittance.homecell,
    },
    req,
  );

  return getRemittance(actor, id);
}

/**
 * Disburses an approved remittance through the active payment provider.
 *
 * The remittance goes to PROCESSING, never straight to SUCCESSFUL — the ledger debit
 * happens in the payment webhook handler. Submitting twice is refused, so the same
 * payout can never be sent to the provider more than once.
 */
export async function disburseRemittance(
  actor: AuthenticatedUser,
  id: string,
  recipient: { accountNumber: string; bankCode: string; accountName: string },
  req: Request,
) {
  const remittance = await Remittance.findById(id);
  if (!remittance) throw new NotFoundError('Remittance');
  await assertHomecellInScope(actor, remittance.homecell);

  if (remittance.status !== RemittanceStatus.APPROVED) {
    throw new ConflictError('Only an approved remittance can be disbursed.');
  }
  if (remittance.payment) {
    throw new ConflictError('A payout has already been submitted for this remittance.');
  }

  const settings = await getSettings();
  if (!settings.payoutsEnabled) {
    throw new ConflictError('Outgoing payments are currently disabled.');
  }

  await assertSufficientBalance(remittance.homecell, remittance.amountMinor, remittance.currency);

  // Claim the remittance before contacting the provider so a concurrent request
  // cannot submit the same payout.
  const claimed = await Remittance.findOneAndUpdate(
    { _id: remittance._id, status: RemittanceStatus.APPROVED, payment: null },
    { $set: { status: RemittanceStatus.PROCESSING, channel: RemittanceChannel.PROVIDER_TRANSFER } },
    { new: true },
  );
  if (!claimed) {
    throw new ConflictError('This remittance is already being processed.');
  }

  try {
    const payment = await createOutboundPayment({
      homecell: remittance.homecell,
      area: remittance.area,
      zone: remittance.zone,
      amountMinor: remittance.amountMinor,
      currency: remittance.currency,
      description: `Remittance ${remittance.reference} to ${remittance.receivingAccount}`,
      relatedModel: 'Remittance',
      relatedId: remittance._id,
      initiatedBy: actor.id,
      approvedBy: idString(remittance.approvedBy) || actor.id,
      recipient,
    });

    claimed.payment = payment._id;
    claimed.paymentProvider = payment.provider;
    claimed.providerReference = payment.providerReference ?? null;
    await claimed.save();
  } catch (err) {
    claimed.status = RemittanceStatus.APPROVED;
    claimed.failureReason = (err as Error).message;
    await claimed.save();
    throw err;
  }

  await recordAudit(
    {
      action: AuditAction.CREATE,
      module: AuditModule.REMITTANCES,
      description: `Submitted payout for remittance ${remittance.reference} of ${formatMoney(
        remittance.amountMinor,
        remittance.currency,
      )}`,
      entityModel: 'Remittance',
      entityId: remittance._id,
      entityLabel: remittance.reference,
      newValues: { status: RemittanceStatus.PROCESSING },
      zone: remittance.zone,
      area: remittance.area,
      homecell: remittance.homecell,
    },
    req,
  );

  return getRemittance(actor, id);
}

export async function rejectRemittance(
  actor: AuthenticatedUser,
  id: string,
  reason: string,
  req: Request,
) {
  const remittance = await Remittance.findById(id);
  if (!remittance) throw new NotFoundError('Remittance');
  await assertHomecellInScope(actor, remittance.homecell);

  if (
    remittance.status !== RemittanceStatus.PENDING_APPROVAL &&
    remittance.status !== RemittanceStatus.APPROVED
  ) {
    throw new ConflictError('This remittance can no longer be rejected.');
  }

  remittance.status = RemittanceStatus.CANCELLED;
  remittance.rejectionReason = reason;
  remittance.approvedBy = toObjectId(actor.id);
  remittance.approvedAt = new Date();
  await remittance.save();

  await recordAudit(
    {
      action: AuditAction.REJECT,
      module: AuditModule.REMITTANCES,
      description: `Rejected remittance ${remittance.reference} — ${reason}`,
      entityModel: 'Remittance',
      entityId: remittance._id,
      entityLabel: remittance.reference,
      newValues: { status: RemittanceStatus.CANCELLED, reason },
      zone: remittance.zone,
      area: remittance.area,
      homecell: remittance.homecell,
    },
    req,
  );

  await notify({
    recipients: [idString(remittance.recordedBy)],
    type: NotificationType.REMITTANCE_FAILED,
    severity: NotificationSeverity.WARNING,
    title: 'Remittance rejected',
    message: `Remittance ${remittance.reference} was rejected. Reason: ${reason}`,
    entityModel: 'Remittance',
    entityId: remittance._id,
    actionUrl: `/finance/remittances/${idString(remittance._id)}`,
    homecell: remittance.homecell,
    area: remittance.area,
    zone: remittance.zone,
  });

  return getRemittance(actor, id);
}

export async function reverseRemittance(
  actor: AuthenticatedUser,
  id: string,
  reason: string,
  req: Request,
) {
  const remittance = await Remittance.findById(id);
  if (!remittance) throw new NotFoundError('Remittance');
  await assertHomecellInScope(actor, remittance.homecell);

  if (remittance.status !== RemittanceStatus.SUCCESSFUL || !remittance.ledgerTransaction) {
    throw new ConflictError('Only a completed remittance can be reversed.');
  }

  await withTransaction(async ({ session }) => {
    await reverseTransaction(idString(remittance.ledgerTransaction), reason, actor.id, session);
    remittance.status = RemittanceStatus.REVERSED;
    await remittance.save({ session: session ?? undefined });
  });

  await recordAudit(
    {
      action: AuditAction.REVERSE,
      module: AuditModule.REMITTANCES,
      description: `Reversed remittance ${remittance.reference} — ${reason}`,
      entityModel: 'Remittance',
      entityId: remittance._id,
      entityLabel: remittance.reference,
      newValues: { status: RemittanceStatus.REVERSED, reason },
      zone: remittance.zone,
      area: remittance.area,
      homecell: remittance.homecell,
    },
    req,
  );

  return getRemittance(actor, id);
}

/** Attaches or replaces proof of payment (BR-013). */
export async function attachReceipt(
  actor: AuthenticatedUser,
  id: string,
  receiptUrl: string,
  receiptPublicId: string | undefined,
  req: Request,
) {
  const remittance = await Remittance.findById(id);
  if (!remittance) throw new NotFoundError('Remittance');
  await assertHomecellInScope(actor, remittance.homecell);

  if (
    remittance.status === RemittanceStatus.REVERSED ||
    remittance.status === RemittanceStatus.CANCELLED
  ) {
    throw new ConflictError('A receipt cannot be attached to a closed remittance.');
  }

  remittance.receiptUrl = receiptUrl;
  remittance.receiptPublicId = receiptPublicId ?? null;
  await remittance.save();

  // Keep the ledger's supporting document in step when one already exists.
  if (remittance.ledgerTransaction) {
    await LedgerTransaction.updateOne(
      { _id: remittance.ledgerTransaction },
      { $set: { supportingDocumentUrl: receiptUrl } },
    );
  }

  await recordAudit(
    {
      action: AuditAction.UPLOAD,
      module: AuditModule.REMITTANCES,
      description: `Attached proof of payment to remittance ${remittance.reference}`,
      entityModel: 'Remittance',
      entityId: remittance._id,
      entityLabel: remittance.reference,
      newValues: { receiptUrl },
      zone: remittance.zone,
      area: remittance.area,
      homecell: remittance.homecell,
    },
    req,
  );

  return getRemittance(actor, id);
}

export async function getRemittance(actor: AuthenticatedUser, id: string) {
  const remittance = await Remittance.findById(id).populate(POPULATE).lean();
  if (!remittance) throw new NotFoundError('Remittance');
  await assertHomecellInScope(actor, remittance.homecell);
  return remittance;
}

export interface ListRemittancesQuery {
  page: number;
  limit: number;
  sort?: string;
  order: 'asc' | 'desc';
  zoneId?: string;
  areaId?: string;
  homecellId?: string;
  status?: RemittanceStatus;
  channel?: RemittanceChannel;
  from?: string;
  to?: string;
}

export async function listRemittances(actor: AuthenticatedUser, query: ListRemittancesQuery) {
  const scoped = await resolveScopedFilter<RemittanceDoc>(actor, query);
  const filter: FilterQuery<RemittanceDoc> = { ...scoped };
  if (query.status) filter.status = query.status;
  if (query.channel) filter.channel = query.channel;
  if (query.from || query.to) filter.date = dateRange(query.from, query.to) as never;

  return paginate(Remittance, {
    filter,
    page: query.page,
    limit: query.limit,
    sort: buildSort(query.sort, query.order, SORTABLE, 'date'),
    populate: POPULATE,
  });
}

export async function pendingRemittanceCount(actor: AuthenticatedUser): Promise<number> {
  const scoped = await resolveScopedFilter<RemittanceDoc>(actor, {});
  return Remittance.countDocuments({
    ...scoped,
    status: { $in: [RemittanceStatus.PENDING_APPROVAL, RemittanceStatus.APPROVED] },
  });
}
