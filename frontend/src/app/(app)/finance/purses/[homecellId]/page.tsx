'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Banknote,
  Download,
  Receipt,
  Send,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatMinor, humanise } from '@/lib/utils';
import { financeService, reportsService } from '@/services';
import { queryKeys, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { LedgerTransaction } from '@/types';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/common/page';
import { DataTable, type Column } from '@/components/common/data-table';
import { DetailSkeleton, EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { DateFilter, FilterBar, FilterSelect } from '@/components/common/filters';
import { Info, InfoCard, InfoGrid, MiniStat, RecordHeader } from '@/components/common/detail';

const TYPES = [
  'OPENING_BALANCE',
  'OFFERING',
  'OTHER_INCOME',
  'EXPENSE',
  'REMITTANCE',
  'PAYMENT_IN',
  'PAYMENT_OUT',
  'ADJUSTMENT',
  'REFUND',
  'REVERSAL',
];

/**
 * A single Homecell purse, with the ledger that produces its balance.
 *
 * SRS §11.11 asks that a user be able to drill from a summary figure into the
 * underlying transactions; this page is that drill-down.
 */
export default function PurseDetailPage() {
  const params = useParams<{ homecellId: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const homecellId = params.homecellId;

  const list = useListQuery({ homecellId });

  const { data: purse, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.finance, 'purse', homecellId],
    () => financeService.purse(homecellId),
  );

  const ledger = useApiQuery(
    [...queryKeys.finance, 'ledger', list.query],
    () => financeService.ledger({ ...list.query, homecellId }),
    { placeholderData: (previous) => previous },
  );

  if (isLoading) return <DetailSkeleton />;
  if (isError || !purse) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const balance = purse.balance;
  const utilisation = Math.min(purse.utilisationPercent, 100);

  const columns: Column<LedgerTransaction>[] = [
    {
      key: 'description',
      header: 'Transaction',
      render: (txn) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{txn.description}</p>
          <p className="truncate text-xs text-muted-foreground">{txn.transactionRef}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (txn) => <span className="text-sm">{humanise(txn.type)}</span>,
    },
    {
      key: 'valueDate',
      header: 'Value date',
      sortable: true,
      render: (txn) => <span className="text-sm">{formatDate(txn.valueDate)}</span>,
    },
    {
      key: 'amountMinor',
      header: 'Amount',
      align: 'right',
      render: (txn) => (
        <span
          className={cn(
            'inline-flex items-center gap-1 font-medium',
            txn.direction === 'CREDIT' ? 'text-success' : 'text-destructive',
          )}
        >
          {txn.direction === 'CREDIT' ? (
            <ArrowDownLeft className="h-3.5 w-3.5" />
          ) : (
            <ArrowUpRight className="h-3.5 w-3.5" />
          )}
          {formatMinor(txn.amountMinor, txn.currency)}
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (txn) => <StatusBadge status={txn.status} /> },
  ];

  return (
    <>
      <RecordHeader
        backHref="/finance/purses"
        backLabel="Homecell purses"
        title={`${purse.homecellName} purse`}
        reference={purse.homecellCode}
        subtitle="The balance below is the sum of posted ledger entries — it is never edited directly."
        status={
          purse.requiresRemittance ? (
            <StatusBadge status="PENDING_APPROVAL" />
          ) : (
            <StatusBadge status="ACTIVE" />
          )
        }
        highlight={{
          label: 'Available balance',
          value: formatMinor(balance.availableMinor, purse.currency),
          tone: purse.requiresRemittance ? 'warning' : 'default',
        }}
        actions={
          <>
            {can('reports.export') && (
              <Button
                variant="outline"
                onClick={() =>
                  void reportsService.export('transactions', 'xlsx', { homecellId })
                }
              >
                <Download className="h-4 w-4" />
                Export
              </Button>
            )}
            {can('remittances.create') && (
              <Button asChild>
                <Link href={`/finance/remittances/new?homecellId=${homecellId}`}>
                  <Send className="h-4 w-4" />
                  Remit
                </Link>
              </Button>
            )}
          </>
        }
      />

      {purse.requiresRemittance && (
        <div className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <p className="font-medium">This purse has reached its maximum threshold</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Remit at least{' '}
              <span className="font-semibold">
                {formatMinor(purse.suggestedRemittanceMinor, purse.currency)}
              </span>{' '}
              to the General Homecell Purse to bring it back within the configured limit of{' '}
              {formatMinor(purse.thresholdMinor, purse.currency)}.
            </p>
          </div>
        </div>
      )}

      {/* Threshold usage */}
      <div className="rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-medium">Threshold usage</p>
          <p className="text-sm text-muted-foreground">
            {formatMinor(balance.availableMinor, purse.currency)} of{' '}
            {formatMinor(purse.thresholdMinor, purse.currency)}
            {purse.thresholdSource === 'HOMECELL_OVERRIDE' && ' (Homecell override)'}
          </p>
        </div>
        <div
          className="mt-3 h-2.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={utilisation}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Purse threshold usage"
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

      {/* Composition of the balance */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat
          label="Opening balance"
          value={formatMinor(balance.openingBalanceMinor, purse.currency)}
          icon={Wallet}
        />
        <MiniStat
          label="Total offerings"
          value={formatMinor(balance.totalOfferingsMinor, purse.currency)}
          icon={Banknote}
          tone="success"
        />
        <MiniStat
          label="Total expenses"
          value={formatMinor(balance.totalExpensesMinor, purse.currency)}
          icon={Receipt}
          tone="destructive"
        />
        <MiniStat
          label="Total remitted"
          value={formatMinor(balance.totalRemittedMinor, purse.currency)}
          icon={Send}
          tone="muted"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <InfoCard title="Balance breakdown" className="lg:col-span-2">
          <InfoGrid columns={3}>
            <Info label="Available">{formatMinor(balance.availableMinor, purse.currency)}</Info>
            <Info label="Pending">{formatMinor(balance.pendingMinor, purse.currency)}</Info>
            <Info label="Total incoming">
              {formatMinor(balance.totalIncomingMinor, purse.currency)}
            </Info>
            <Info label="Other income">
              {formatMinor(balance.totalOtherIncomeMinor, purse.currency)}
            </Info>
            <Info label="Adjustments">
              {formatMinor(balance.totalAdjustmentsMinor, purse.currency)}
            </Info>
            <Info label="Ledger entries">{balance.transactionCount}</Info>
          </InfoGrid>
        </InfoCard>

        <InfoCard title="How this is calculated">
          <p className="text-sm text-muted-foreground">
            Opening balance, plus offerings and other approved income, minus approved expenses and
            completed remittances, plus or minus any adjustments and reversals.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            No user — at any role — can set this number directly.
          </p>
        </InfoCard>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Transactions</h2>

        <FilterBar activeFilterCount={list.activeFilterCount} onReset={list.resetFilters}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect
              label="Type"
              placeholder="All types"
              value={list.filters.type as string | undefined}
              onChange={(value) => list.setFilter('type', value)}
              options={TYPES.map((t) => ({ value: t, label: humanise(t) }))}
            />
            <FilterSelect
              label="Status"
              placeholder="All statuses"
              value={list.filters.status as string | undefined}
              onChange={(value) => list.setFilter('status', value)}
              options={['POSTED', 'PENDING', 'REVERSED', 'FAILED'].map((s) => ({
                value: s,
                label: humanise(s),
              }))}
            />
            <DateFilter
              label="From"
              value={list.filters.from as string | undefined}
              onChange={(value) => list.setFilter('from', value)}
            />
            <DateFilter
              label="To"
              value={list.filters.to as string | undefined}
              onChange={(value) => list.setFilter('to', value)}
            />
          </div>
        </FilterBar>

        {ledger.isLoading ? (
          <TableSkeleton rows={8} columns={5} />
        ) : ledger.isError ? (
          <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} />
        ) : (
          <DataTable
            columns={columns}
            rows={ledger.data?.items ?? []}
            rowKey={(txn) => txn._id}
            onRowClick={(txn) => router.push(`/finance/ledger/${txn._id}`)}
            pagination={ledger.data?.pagination}
            onPageChange={list.setPage}
            onLimitChange={list.setLimit}
            sort={list.sort}
            onSortChange={list.setSort}
            emptyState={
              <EmptyState
                icon={Wallet}
                title="No transactions yet"
                description="Entries appear here as offerings, expenses and remittances are recorded for this Homecell."
              />
            }
          />
        )}
      </div>
    </>
  );
}
