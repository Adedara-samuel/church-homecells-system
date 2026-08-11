'use client';

import Link from 'next/link';
import { AlertTriangle, Banknote, Receipt, Send, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn, formatMinor, formatMoney, formatPercent } from '@/lib/utils';
import { financeService } from '@/services';
import { queryKeys, useApiQuery } from '@/hooks/use-api';
import type { Purse } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { PageHeader, StatCard } from '@/components/common/page';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/common/states';

export default function PursesPage() {
  const { can } = useAuth();
  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.finance, 'purses'],
    () => financeService.purses(),
    { refetchInterval: 120_000 },
  );

  const purses = data ?? [];
  const currency = purses[0]?.currency ?? 'NGN';

  const totals = purses.reduce(
    (acc, purse) => ({
      available: acc.available + purse.balance.availableMinor,
      pending: acc.pending + purse.balance.pendingMinor,
      aboveThreshold: acc.aboveThreshold + (purse.requiresRemittance ? 1 : 0),
    }),
    { available: 0, pending: 0, aboveThreshold: 0 },
  );

  return (
    <>
      <PageHeader
        title="Homecell purses"
        description="Every balance below is the sum of posted ledger transactions — it is never edited directly."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Homecell purses' }]}
      />

      {isLoading ? (
        <CardSkeleton count={3} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Total available"
              value={formatMinor(totals.available, currency)}
              hint={`Across ${purses.length} homecell${purses.length === 1 ? '' : 's'}`}
              icon={Wallet}
            />
            <StatCard
              label="Pending"
              value={formatMinor(totals.pending, currency)}
              hint="Awaiting settlement or approval"
              icon={Receipt}
            />
            <StatCard
              label="Above threshold"
              value={String(totals.aboveThreshold)}
              hint={
                totals.aboveThreshold > 0
                  ? 'Remittance required'
                  : 'All purses within their limit'
              }
              icon={AlertTriangle}
              tone={totals.aboveThreshold > 0 ? 'warning' : 'success'}
            />
          </div>

          {purses.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No homecell purses yet"
              description="A purse appears here as soon as a Homecell records its first financial transaction."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {purses.map((purse) => (
                <PurseCard key={purse.homecellId} purse={purse} canRemit={can('remittances.create')} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function PurseCard({ purse, canRemit }: { purse: Purse; canRemit: boolean }) {
  const utilisation = Math.min(purse.utilisationPercent, 100);

  return (
    <Card className={cn(purse.requiresRemittance && 'border-warning/50')}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{purse.homecellName}</CardTitle>
            <p className="text-xs text-muted-foreground">{purse.homecellCode}</p>
          </div>
          {purse.requiresRemittance && (
            <Badge variant="warning">
              <AlertTriangle className="h-3 w-3" />
              Remit
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Available balance</p>
          <p
            className={cn(
              'text-2xl font-semibold tabular',
              purse.requiresRemittance && 'text-warning',
            )}
          >
            {formatMoney(purse.available, purse.currency)}
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Maximum {formatMoney(purse.threshold, purse.currency)}
              {purse.thresholdSource === 'HOMECELL_OVERRIDE' && ' (override)'}
            </span>
            <span className="tabular font-medium">{formatPercent(purse.utilisationPercent)}</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={utilisation}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${purse.homecellName} purse utilisation`}
          >
            <div
              className={cn(
                'h-full rounded-full transition-all',
                purse.requiresRemittance ? 'bg-warning' : 'bg-primary',
              )}
              style={{ width: `${utilisation}%` }}
            />
          </div>
        </div>

        {purse.requiresRemittance && purse.suggestedRemittanceMinor > 0 && (
          <p className="rounded-md bg-warning/10 p-2.5 text-xs">
            Remit at least{' '}
            <span className="font-semibold">
              {formatMinor(purse.suggestedRemittanceMinor, purse.currency)}
            </span>{' '}
            to return below the threshold.
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild className="flex-1">
            <Link href={`/finance/ledger?homecellId=${purse.homecellId}`}>
              <Banknote className="h-4 w-4" />
              Ledger
            </Link>
          </Button>
          {canRemit && (
            <Button size="sm" asChild className="flex-1">
              <Link href={`/finance/remittances/new?homecellId=${purse.homecellId}`}>
                <Send className="h-4 w-4" />
                Remit
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
