'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeftRight, Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatDate, humanise } from '@/lib/utils';
import { transfersService } from '@/services';
import { queryKeys, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { MemberTransfer } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { PageHeader, StatusBadge } from '@/components/common/page';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { FilterBar, FilterSelect, OrgFilters } from '@/components/common/filters';

export default function TransfersPage() {
  const router = useRouter();
  const { can } = useAuth();
  const list = useListQuery();

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.transfers, list.query],
    () => transfersService.list(list.query),
    { placeholderData: (previous) => previous },
  );

  const columns: Column<MemberTransfer>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (transfer) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {transfer.member?.firstName} {transfer.member?.lastName}
          </p>
          <p className="truncate text-xs text-muted-foreground">{transfer.reference}</p>
        </div>
      ),
    },
    {
      key: 'route',
      header: 'From → To',
      render: (transfer) => (
        <div className="min-w-0 text-sm">
          <p className="truncate">{transfer.previousHomecell?.name ?? '—'}</p>
          <p className="truncate text-xs text-muted-foreground">
            → {transfer.newHomecell?.name ?? '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'scope',
      header: 'Scope',
      hideOnMobile: true,
      render: (transfer) => <Badge variant="secondary">{humanise(transfer.scope)}</Badge>,
    },
    {
      key: 'stage',
      header: 'Approval stage',
      hideOnMobile: true,
      render: (transfer) => {
        if (transfer.status !== 'PENDING') return <span className="text-sm">—</span>;
        const stage = transfer.approvalChain[transfer.currentStageIndex];
        return (
          <span className="text-sm">
            {stage ? humanise(stage.stage) : 'Awaiting'}{' '}
            <span className="text-xs text-muted-foreground">
              ({transfer.currentStageIndex + 1}/{transfer.approvalChain.length})
            </span>
          </span>
        );
      },
    },
    {
      key: 'requestedAt',
      header: 'Requested',
      sortable: true,
      render: (transfer) => <span className="text-sm">{formatDate(transfer.requestedAt)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (transfer) => <StatusBadge status={transfer.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Member transfers"
        description="Movement of members between Homecells, Areas and Zones, with a permanent history."
        actions={
          can('members.transfer') && (
            <Button asChild>
              <Link href="/transfers/new">
                <Plus className="h-4 w-4" />
                New transfer
              </Link>
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
          <div className="grid gap-3 sm:grid-cols-2">
            <FilterSelect
              label="Status"
              placeholder="All statuses"
              value={list.filters.status as string | undefined}
              onChange={(value) => list.setFilter('status', value)}
              options={['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((s) => ({
                value: s,
                label: humanise(s),
              }))}
            />
            <FilterSelect
              label="Scope"
              placeholder="All scopes"
              value={list.filters.scope as string | undefined}
              onChange={(value) => list.setFilter('scope', value)}
              options={['SAME_AREA', 'CROSS_AREA', 'CROSS_ZONE'].map((s) => ({
                value: s,
                label: humanise(s),
              }))}
            />
          </div>
        </div>
      </FilterBar>

      {isLoading ? (
        <TableSkeleton rows={6} columns={6} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(transfer) => transfer._id}
          onRowClick={(transfer) => router.push(`/transfers/${transfer._id}`)}
          pagination={data?.pagination}
          onPageChange={list.setPage}
          onLimitChange={list.setLimit}
          sort={list.sort}
          onSortChange={list.setSort}
          emptyState={
            <EmptyState
              icon={ArrowLeftRight}
              title="No transfers recorded"
              description="Transfer requests appear here as members move between Homecells."
            />
          }
        />
      )}
    </>
  );
}
