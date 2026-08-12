'use client';

import { useParams } from 'next/navigation';
import { CheckCircle2, ShieldQuestion, TriangleAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMinor, humanise } from '@/lib/utils';
import { paymentsService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery } from '@/hooks/use-api';
import { StatusBadge } from '@/components/common/page';
import { DetailSkeleton, EmptyState, ErrorState } from '@/components/common/states';
import { ConfirmButton } from '@/components/common/filters';
import {
  Info,
  InfoCard,
  InfoGrid,
  MiniStat,
  RecordHeader,
  RecordLink,
} from '@/components/common/detail';

export default function ReconciliationRunPage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const id = params.id;

  const { data: run, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.payments, 'reconciliation', 'run', id],
    () => paymentsService.reconciliationRun(id),
  );

  const resolve = useApiMutation(
    ({ exceptionId, note }: { exceptionId: string; note: string }) =>
      paymentsService.resolveException(id, exceptionId, note),
    { successMessage: 'Exception resolved', invalidates: [queryKeys.payments] },
  );

  if (isLoading) return <DetailSkeleton />;
  if (isError || !run) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const exceptions = run.exceptions ?? [];
  const clean = exceptions.length === 0;

  return (
    <>
      <RecordHeader
        backHref="/finance/reconciliation"
        backLabel="Reconciliation"
        title={`${run.provider} reconciliation`}
        subtitle={
          <>
            {humanise(run.trigger)} run · {formatDate(run.from)} to {formatDate(run.to)}
          </>
        }
        status={
          <StatusBadge status={run.unresolved > 0 ? 'MISMATCHED' : clean ? 'MATCHED' : 'PENDING'} />
        }
        highlight={{
          label: 'Unresolved exceptions',
          value: String(run.unresolved),
          tone: run.unresolved > 0 ? 'destructive' : 'success',
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat label="Checked" value={String(run.totalChecked)} icon={ShieldQuestion} />
        <MiniStat
          label="Matched"
          value={String(run.matched)}
          icon={CheckCircle2}
          tone="success"
        />
        <MiniStat
          label="Mismatched"
          value={String(run.mismatched)}
          icon={TriangleAlert}
          tone={run.mismatched > 0 ? 'destructive' : 'muted'}
        />
        <MiniStat
          label="Orphaned"
          value={String(run.orphaned)}
          tone={run.orphaned > 0 ? 'warning' : 'muted'}
        />
      </div>

      {run.error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">The run did not complete</p>
          <p className="mt-1 text-sm text-muted-foreground">{run.error}</p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <InfoCard
            title="Exceptions"
            description="Differences between our records and the provider's. Nothing is corrected automatically — each needs a decision."
          >
            {clean ? (
              <EmptyState
                icon={CheckCircle2}
                title="No exceptions in this run"
                description={`${run.matched} of ${run.totalChecked} payments matched the provider exactly.`}
              />
            ) : (
              <ul className="space-y-3">
                {exceptions.map((exception) => (
                  <li key={exception._id} className="rounded-lg border p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-medium">
                            {exception.reference ?? 'Unknown reference'}
                          </span>
                          <StatusBadge status={exception.status} />
                          {exception.resolved && <StatusBadge status="MANUALLY_RESOLVED" />}
                        </div>
                        <p className="mt-1.5 text-sm text-muted-foreground">{exception.reason}</p>

                        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs sm:grid-cols-2">
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">Internal amount</dt>
                            <dd className="tabular">
                              {exception.internalAmountMinor != null
                                ? formatMinor(exception.internalAmountMinor)
                                : '—'}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">Provider amount</dt>
                            <dd className="tabular">
                              {exception.providerAmountMinor != null
                                ? formatMinor(exception.providerAmountMinor)
                                : '—'}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">Internal status</dt>
                            <dd>{exception.internalStatus ?? '—'}</dd>
                          </div>
                          <div className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">Provider status</dt>
                            <dd>{exception.providerStatus ?? '—'}</dd>
                          </div>
                        </dl>

                        {exception.payment && (
                          <p className="mt-2 text-xs">
                            <RecordLink href={`/finance/payments/${exception.payment}`}>
                              Open the payment record
                            </RecordLink>
                          </p>
                        )}

                        {exception.resolutionNote && (
                          <p className="mt-2 rounded-md bg-muted p-2 text-xs text-muted-foreground">
                            Resolution: {exception.resolutionNote}
                          </p>
                        )}
                      </div>

                      {!exception.resolved && can('finance.reconcile') && (
                        <ConfirmButton
                          variant="outline"
                          size="sm"
                          title="Resolve this exception?"
                          description="Records your decision against the payment and in the audit trail. The ledger is not altered by this action."
                          confirmLabel="Resolve"
                          requireReason
                          reasonLabel="Resolution note"
                          onConfirm={(note) =>
                            resolve.mutateAsync({ exceptionId: exception._id, note })
                          }
                        >
                          Resolve
                        </ConfirmButton>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </InfoCard>
        </div>

        <div className="space-y-5">
          <InfoCard title="Run details">
            <InfoGrid columns={1}>
              <Info label="Provider">{run.provider}</Info>
              <Info label="Trigger">{humanise(run.trigger)}</Info>
              <Info label="Period start">{formatDate(run.from, true)}</Info>
              <Info label="Period end">{formatDate(run.to, true)}</Info>
              <Info label="Started">{formatDate(run.startedAt, true)}</Info>
              <Info label="Completed">
                {run.completedAt ? formatDate(run.completedAt, true) : 'Still running'}
              </Info>
            </InfoGrid>
          </InfoCard>

          <InfoCard title="Why nothing is auto-corrected">
            <p className="text-sm text-muted-foreground">
              Automatically rewriting a ledger entry so that it agrees with an external system
              would defeat the purpose of keeping a ledger. Each difference is surfaced for a
              person to decide, and that decision is itself recorded in the audit trail.
            </p>
          </InfoCard>
        </div>
      </div>
    </>
  );
}
