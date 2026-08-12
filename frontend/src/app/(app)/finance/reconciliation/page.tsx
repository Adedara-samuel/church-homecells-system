'use client';

import { useRouter } from 'next/navigation';
import { Activity, CheckCircle2, PlayCircle, ShieldQuestion, TriangleAlert } from 'lucide-react';
import { formatDate, humanise } from '@/lib/utils';
import { paymentsService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery } from '@/hooks/use-api';
import type { ReconciliationRun } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { PageHeader, StatCard } from '@/components/common/page';
import { CardSkeleton, EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { DataTable, type Column } from '@/components/common/data-table';

export default function ReconciliationPage() {
  const router = useRouter();

  const summary = useApiQuery([...queryKeys.payments, 'reconciliation', 'summary'], () =>
    paymentsService.reconciliationSummary(),
  );

  const runs = useApiQuery([...queryKeys.payments, 'reconciliation', 'runs'], () =>
    paymentsService.reconciliationRuns({ page: 1, limit: 20 }),
  );

  const runNow = useApiMutation(() => paymentsService.runReconciliation({}), {
    successMessage: 'Reconciliation complete',
    invalidates: [queryKeys.payments],
    // Drop the user straight into the run they just triggered.
    onSuccess: (run) => router.push(`/finance/reconciliation/${run._id}`),
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
        <span className={run.unresolved > 0 ? 'font-medium text-warning' : ''}>
          {run.unresolved}
        </span>
      ),
    },
  ];

  const counts = summary.data?.counts ?? {};
  const latestRun = summary.data?.latestRun;

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

      {latestRun && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium">Most recent run</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {formatDate(latestRun.startedAt, true)} · {latestRun.matched} matched of{' '}
                {latestRun.totalChecked} checked
                {latestRun.unresolved > 0 ? ` · ${latestRun.unresolved} unresolved` : ''}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/finance/reconciliation/${latestRun._id}`)}
            >
              Review
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reconciliation runs</CardTitle>
          <CardDescription>
            A run happens automatically each night and can be triggered on demand. Select a run to
            review its exceptions.
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
              onRowClick={(run) => router.push(`/finance/reconciliation/${run._id}`)}
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
    </>
  );
}
