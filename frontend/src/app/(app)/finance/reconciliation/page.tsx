'use client';

import * as React from 'react';
import { Activity, CheckCircle2, PlayCircle, ShieldQuestion, TriangleAlert } from 'lucide-react';
import { formatDate, formatMinor, humanise } from '@/lib/utils';
import { paymentsService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery } from '@/hooks/use-api';
import type { ReconciliationRun } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { PageHeader, StatCard, StatusBadge } from '@/components/common/page';
import { CardSkeleton, EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { DataTable, type Column } from '@/components/common/data-table';
import { ConfirmButton } from '@/components/common/filters';

export default function ReconciliationPage() {
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);

  const summary = useApiQuery([...queryKeys.payments, 'reconciliation', 'summary'], () =>
    paymentsService.reconciliationSummary(),
  );

  const runs = useApiQuery([...queryKeys.payments, 'reconciliation', 'runs'], () =>
    paymentsService.reconciliationRuns({ page: 1, limit: 20 }),
  );

  const runNow = useApiMutation(() => paymentsService.runReconciliation({}), {
    successMessage: 'Reconciliation complete',
    invalidates: [queryKeys.payments],
    onSuccess: (run) => setOpenRunId(run._id),
  });

  const columns: Column<ReconciliationRun>[] = [
    {
      key: 'startedAt',
      header: 'Run',
      render: (run) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{formatDate(run.startedAt, true)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {run.provider} · {humanise(run.trigger)}
          </p>
        </div>
      ),
    },
    {
      key: 'period',
      header: 'Period',
      hideOnMobile: true,
      render: (run) => (
        <span className="text-sm">
          {formatDate(run.from)} – {formatDate(run.to)}
        </span>
      ),
    },
    { key: 'totalChecked', header: 'Checked', align: 'right', render: (run) => run.totalChecked },
    {
      key: 'matched',
      header: 'Matched',
      align: 'right',
      render: (run) => <span className="text-success">{run.matched}</span>,
    },
    {
      key: 'exceptions',
      header: 'Exceptions',
      align: 'right',
      render: (run) => (
        <span className={run.mismatched + run.orphaned > 0 ? 'text-destructive' : ''}>
          {run.mismatched + run.orphaned}
        </span>
      ),
    },
    {
      key: 'unresolved',
      header: 'Unresolved',
      align: 'right',
      render: (run) => (
        <span className={run.unresolved > 0 ? 'font-medium text-warning' : ''}>{run.unresolved}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (run) => (
        <Button variant="ghost" size="sm" onClick={() => setOpenRunId(run._id)}>
          Review
        </Button>
      ),
    },
  ];

  const counts = summary.data?.counts ?? {};

  return (
    <>
      <PageHeader
        title="Payment reconciliation"
        description="Compares our payment records against the provider's own transaction list. Differences are surfaced for a human decision — nothing is corrected automatically."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Reconciliation' }]}
        actions={
          <Button onClick={() => runNow.mutate()} loading={runNow.isPending}>
            <PlayCircle className="h-4 w-4" />
            Run reconciliation
          </Button>
        }
      />

      {summary.isLoading ? (
        <CardSkeleton count={4} />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Matched"
            value={String(counts.MATCHED ?? 0)}
            hint="Agree with the provider"
            icon={CheckCircle2}
            tone="success"
          />
          <StatCard
            label="Unreconciled"
            value={String(counts.UNRECONCILED ?? 0)}
            hint="Not yet compared"
            icon={ShieldQuestion}
          />
          <StatCard
            label="Mismatched"
            value={String(counts.MISMATCHED ?? 0)}
            hint="Amount or status differs"
            icon={TriangleAlert}
            tone={(counts.MISMATCHED ?? 0) > 0 ? 'destructive' : 'default'}
          />
          <StatCard
            label="Manually resolved"
            value={String(counts.MANUALLY_RESOLVED ?? 0)}
            hint="Closed by an administrator"
            icon={Activity}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reconciliation runs</CardTitle>
          <CardDescription>
            A run happens automatically each night and can be triggered on demand.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {runs.isLoading ? (
            <TableSkeleton rows={5} columns={6} />
          ) : runs.isError ? (
            <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
          ) : (
            <DataTable
              columns={columns}
              rows={runs.data?.items ?? []}
              rowKey={(run) => run._id}
              emptyState={
                <EmptyState
                  icon={Activity}
                  title="No reconciliation runs yet"
                  description="Run reconciliation to compare recorded payments against the provider."
                  action={
                    <Button onClick={() => runNow.mutate()} loading={runNow.isPending}>
                      <PlayCircle className="h-4 w-4" />
                      Run reconciliation
                    </Button>
                  }
                />
              }
            />
          )}
        </CardContent>
      </Card>

      {openRunId && <RunDetail runId={openRunId} onClose={() => setOpenRunId(null)} />}
    </>
  );
}

function RunDetail({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { data: run, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.payments, 'reconciliation', 'run', runId],
    () => paymentsService.reconciliationRun(runId),
  );

  const resolve = useApiMutation(
    ({ exceptionId, note }: { exceptionId: string; note: string }) =>
      paymentsService.resolveException(runId, exceptionId, note),
    {
      successMessage: 'Exception resolved',
      invalidates: [queryKeys.payments],
    },
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Reconciliation exceptions</CardTitle>
            <CardDescription>
              {run ? `${formatDate(run.startedAt, true)} · ${run.provider}` : 'Loading…'}
            </CardDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <TableSkeleton rows={4} columns={4} />
        ) : isError || !run ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : !run.exceptions || run.exceptions.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="No exceptions in this run"
            description={`${run.matched} of ${run.totalChecked} payments matched the provider exactly.`}
          />
        ) : (
          <ul className="space-y-3">
            {run.exceptions.map((exception) => (
              <li key={exception._id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{exception.reference ?? 'Unknown reference'}</span>
                      <StatusBadge status={exception.status} />
                      {exception.resolved && <StatusBadge status="MANUALLY_RESOLVED" />}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{exception.reason}</p>
                    <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
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
                    {exception.resolutionNote && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Resolution: {exception.resolutionNote}
                      </p>
                    )}
                  </div>

                  {!exception.resolved && (
                    <ConfirmButton
                      variant="outline"
                      size="sm"
                      title="Resolve this exception?"
                      description="Records your decision against the payment and the audit trail. The ledger is not altered by this action."
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
      </CardContent>
    </Card>
  );
}
