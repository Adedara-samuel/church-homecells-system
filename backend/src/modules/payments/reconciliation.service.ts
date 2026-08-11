import type { Request } from 'express';
import { logger } from '../../config/logger';
import {
  AuditAction,
  AuditModule,
  NotificationSeverity,
  NotificationType,
  PaymentProviderName,
  PaymentStatus,
  ReconciliationStatus,
  Role,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { NotFoundError } from '../../utils/errors';
import { idString, toObjectId } from '../../utils/ids';
import { recordAudit } from '../audit/audit.service';
import { notify, usersWithRole } from '../notifications/notification.service';
import { getSettings } from '../settings/settings.service';
import { Payment } from './payment.model';
import { getProvider } from './providers';
import { ReconciliationRun, type ReconciliationExceptionDoc } from './reconciliation.model';

export interface ReconcileOptions {
  provider?: PaymentProviderName;
  from: Date;
  to: Date;
  trigger: 'SCHEDULED' | 'MANUAL';
  runBy?: string;
}

/**
 * Compares our payment records against the provider's own transaction list for a
 * window, and classifies every difference.
 *
 * Four outcomes are possible for a payment:
 *   MATCHED     — same status, same amount on both sides
 *   MISMATCHED  — the provider disagrees about the amount or the outcome
 *   ORPHANED    — the provider knows about a transaction we have no record of
 *   (unchanged) — still pending on both sides, nothing to say yet
 *
 * Anything that is not MATCHED becomes an exception on the run and is surfaced to
 * finance administrators; nothing is auto-corrected, because silently rewriting a
 * financial record to agree with an external system is exactly the behaviour a ledger
 * exists to prevent.
 */
export async function runReconciliation(options: ReconcileOptions) {
  const settings = await getSettings();
  const providerName = options.provider ?? settings.activePaymentProvider;
  const provider = getProvider(providerName);

  const run = await ReconciliationRun.create({
    provider: providerName,
    from: options.from,
    to: options.to,
    trigger: options.trigger,
    runBy: options.runBy ?? null,
    startedAt: new Date(),
  });

  try {
    const [internal, external] = await Promise.all([
      Payment.find({
        provider: providerName,
        createdAt: { $gte: options.from, $lte: options.to },
      }).lean(),
      provider.listTransactions(options.from, options.to).catch((err) => {
        logger.warn({ err, provider: providerName }, 'Could not fetch provider transactions');
        return [];
      }),
    ]);

    const byReference = new Map(external.map((t) => [t.reference ?? '', t]));
    const seen = new Set<string>();
    const exceptions: ReconciliationExceptionDoc[] = [];
    let matched = 0;

    for (const payment of internal) {
      const remote = byReference.get(payment.reference);
      seen.add(payment.reference);

      if (!remote) {
        // Absent upstream is only a problem once we believe it succeeded.
        if (payment.status === PaymentStatus.SUCCESSFUL) {
          exceptions.push({
            payment: payment._id,
            reference: payment.reference,
            providerReference: payment.providerReference ?? null,
            status: ReconciliationStatus.MISMATCHED,
            reason: 'Recorded as successful internally but not found at the provider',
            internalAmountMinor: payment.amountMinor,
            providerAmountMinor: null,
            internalStatus: payment.status,
            providerStatus: null,
            resolved: false,
          });
        }
        continue;
      }

      const amountMatches = remote.amountMinor === payment.amountMinor;
      const statusMatches = remote.status === payment.status;

      if (amountMatches && statusMatches) {
        matched += 1;
        await Payment.updateOne(
          { _id: payment._id },
          {
            $set: {
              reconciliationStatus: ReconciliationStatus.MATCHED,
              reconciledAt: new Date(),
              providerAmountMinor: remote.amountMinor,
              providerStatusRaw: remote.providerStatusRaw,
            },
          },
        );
        continue;
      }

      exceptions.push({
        payment: payment._id,
        reference: payment.reference,
        providerReference: remote.providerReference,
        status: ReconciliationStatus.MISMATCHED,
        reason: !amountMatches
          ? `Amount mismatch: internal ${payment.amountMinor}, provider ${remote.amountMinor}`
          : `Status mismatch: internal ${payment.status}, provider ${remote.status}`,
        internalAmountMinor: payment.amountMinor,
        providerAmountMinor: remote.amountMinor,
        internalStatus: payment.status,
        providerStatus: remote.status,
        resolved: false,
      });

      await Payment.updateOne(
        { _id: payment._id },
        {
          $set: {
            reconciliationStatus: ReconciliationStatus.MISMATCHED,
            providerAmountMinor: remote.amountMinor,
            providerStatusRaw: remote.providerStatusRaw,
            reconciliationNote: exceptions[exceptions.length - 1].reason,
          },
        },
      );
    }

    // Transactions the provider has that we have never recorded.
    for (const remote of external) {
      if (!remote.reference || seen.has(remote.reference)) continue;
      exceptions.push({
        reference: remote.reference,
        providerReference: remote.providerReference,
        status: ReconciliationStatus.ORPHANED,
        reason: 'Provider transaction has no matching internal record',
        internalAmountMinor: null,
        providerAmountMinor: remote.amountMinor,
        internalStatus: null,
        providerStatus: remote.status,
        resolved: false,
      });
    }

    run.totalChecked = internal.length;
    run.matched = matched;
    run.mismatched = exceptions.filter((e) => e.status === ReconciliationStatus.MISMATCHED).length;
    run.orphaned = exceptions.filter((e) => e.status === ReconciliationStatus.ORPHANED).length;
    run.unresolved = exceptions.length;
    run.exceptions = exceptions;
    run.completedAt = new Date();
    await run.save();

    if (exceptions.length > 0) {
      const recipients = [
        ...(await usersWithRole(Role.SYSTEM_ADMIN)),
        ...(await usersWithRole(Role.CHURCH_ADMIN)),
      ];
      await notify({
        recipients,
        type: NotificationType.RECONCILIATION_EXCEPTION,
        severity: NotificationSeverity.CRITICAL,
        title: 'Payment reconciliation exceptions detected',
        message: `${exceptions.length} exception${
          exceptions.length === 1 ? '' : 's'
        } found while reconciling ${providerName} payments. Review them in the finance console.`,
        entityModel: 'ReconciliationRun',
        entityId: run._id,
        actionUrl: `/finance/reconciliation/${idString(run._id)}`,
        dedupeKey: `reconciliation:${idString(run._id)}`,
      });
    }

    logger.info(
      {
        provider: providerName,
        checked: run.totalChecked,
        matched: run.matched,
        exceptions: exceptions.length,
      },
      'Reconciliation run complete',
    );

    return run;
  } catch (err) {
    run.error = (err as Error).message;
    run.completedAt = new Date();
    await run.save();
    throw err;
  }
}

export async function listRuns(query: { page: number; limit: number }) {
  const skip = (query.page - 1) * query.limit;
  const [items, total] = await Promise.all([
    ReconciliationRun.find()
      .select('-exceptions')
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(query.limit)
      .lean(),
    ReconciliationRun.countDocuments(),
  ]);
  return { items, total };
}

export async function getRun(id: string) {
  const run = await ReconciliationRun.findById(id)
    .populate({ path: 'exceptions.payment', select: 'reference amountMinor status homecell' })
    .lean();
  if (!run) throw new NotFoundError('Reconciliation run');
  return run;
}

/** Records a human decision on an exception. The ledger is never edited here. */
export async function resolveException(
  actor: AuthenticatedUser,
  runId: string,
  exceptionId: string,
  note: string,
  req: Request,
) {
  const run = await ReconciliationRun.findById(runId);
  if (!run) throw new NotFoundError('Reconciliation run');

  const exception = (run.exceptions as unknown as { _id: unknown; resolved: boolean }[]).find(
    (e) => idString(e._id) === exceptionId,
  ) as ReconciliationExceptionDoc | undefined;
  if (!exception) throw new NotFoundError('Reconciliation exception');

  exception.resolved = true;
  exception.resolvedBy = toObjectId(actor.id);
  exception.resolvedAt = new Date();
  exception.resolutionNote = note;
  run.unresolved = (run.exceptions as ReconciliationExceptionDoc[]).filter((e) => !e.resolved).length;
  run.markModified('exceptions');
  await run.save();

  if (exception.payment) {
    await Payment.updateOne(
      { _id: exception.payment },
      {
        $set: {
          reconciliationStatus: ReconciliationStatus.MANUALLY_RESOLVED,
          reconciledAt: new Date(),
          reconciledBy: toObjectId(actor.id),
          reconciliationNote: note,
        },
      },
    );
  }

  await recordAudit(
    {
      action: AuditAction.RECONCILE,
      module: AuditModule.PAYMENTS,
      description: `Resolved reconciliation exception for ${exception.reference ?? 'unknown reference'} — ${note}`,
      entityModel: 'ReconciliationRun',
      entityId: run._id,
      entityLabel: exception.reference ?? undefined,
      newValues: { resolved: true, note },
    },
    req,
  );

  return getRun(runId);
}

/** Summary counters for the reconciliation dashboard. */
export async function reconciliationSummary() {
  const [byStatus, latestRun] = await Promise.all([
    Payment.aggregate([
      { $group: { _id: '$reconciliationStatus', count: { $sum: 1 } } },
    ]),
    ReconciliationRun.findOne().sort({ startedAt: -1 }).select('-exceptions').lean(),
  ]);

  const counts = Object.fromEntries(
    Object.values(ReconciliationStatus).map((status) => [
      status,
      byStatus.find((r) => r._id === status)?.count ?? 0,
    ]),
  );

  return { counts, latestRun };
}
