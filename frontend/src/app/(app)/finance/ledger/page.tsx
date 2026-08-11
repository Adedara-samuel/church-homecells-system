'use client';

import { useSearchParams } from 'next/navigation';
import { ArrowDownLeft, ArrowUpRight, Download, FileText } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatMinor, humanise } from '@/lib/utils';
import { financeService, reportsService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { LedgerTransaction } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { PageHeader, StatusBadge } from '@/components/common/page';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import {
  ConfirmButton,
  DateFilter,
  FilterBar,
  FilterSelect,
  OrgFilters,
} from '@/components/common/filters';

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

export default function LedgerPage() {
  const { can } = useAuth();
  const searchParams = useSearchParams();
  const list = useListQuery(
    searchParams.get('homecellId') ? { homecellId: searchParams.get('homecellId')! } : {},
  );

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.finance, 'ledger', list.query],
    () => financeService.ledger(list.query),
    { placeholderData: (previous) => previous },
  );

  const reverse = useApiMutation(
    ({ id, reason }: { id: string; reason: string }) =>
      financeService.reverseTransaction(id, reason),
    {
      successMessage: 'Transaction reversed',
      invalidates: [queryKeys.finance, queryKeys.dashboard],
    },
  );

  const columns: Column<LedgerTransaction>[] = [
    {
      key: 'transactionRef',
      header: 'Transaction',
      render: (txn) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{txn.description}</p>
          <p className="truncate text-xs text-muted-foreground">
            {txn.transactionRef} · {txn.homecell?.name}
          </p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (txn) => <Badge variant="secondary">{humanise(txn.type)}</Badge>,
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
    {
      key: 'createdBy',
      header: 'Recorded by',
      hideOnMobile: true,
      render: (txn) =>
        txn.createdBy ? (
          <span className="text-sm">
            {txn.createdBy.firstName} {txn.createdBy.lastName}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">System</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      hideOnMobile: true,
      render: (txn) =>
        can('finance.reverse') && txn.status === 'POSTED' ? (
          <ConfirmButton
            variant="ghost"
            size="sm"
            title="Reverse this transaction?"
            description="An equal and opposite entry is posted. The original record is preserved and marked as reversed."
            confirmLabel="Reverse transaction"
            requireReason
            reasonLabel="Reason for reversal"
            onConfirm={(reason) => reverse.mutateAsync({ id: txn._id, reason })}
          >
            Reverse
          </ConfirmButton>
        ) : txn.reversedAt ? (
          <span className="text-xs text-muted-foreground">Reversed</span>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Financial ledger"
        description="Every posting that makes up a Homecell purse balance. Entries are immutable — corrections are made through reversals and adjustments."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Ledger' }]}
        actions={
          can('reports.export') && (
            <Button
              variant="outline"
              onClick={() => void reportsService.export('transactions', 'xlsx', list.filters as never)}
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          )
        }
      />

      <FilterBar activeFilterCount={list.activeFilterCount} onReset={list.resetFilters}>
        <div className="space-y-4">
          <OrgFilters
            zoneId={list.filters.zoneId as string | undefined}
            areaId={list.filters.areaId as string | undefined}
            homecellId={list.filters.homecellId as string | undefined}
            onChange={(key, value) => list.setFilter(key, value)}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect
              label="Transaction type"
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
        </div>
      </FilterBar>

      {isLoading ? (
        <TableSkeleton rows={9} columns={6} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(txn) => txn._id}
          pagination={data?.pagination}
          onPageChange={list.setPage}
          onLimitChange={list.setLimit}
          sort={list.sort}
          onSortChange={list.setSort}
          emptyState={
            <EmptyState
              icon={FileText}
              title="No transactions yet"
              description="Ledger entries appear as offerings, expenses and remittances are recorded."
            />
          }
        />
      )}
    </>
  );
}
