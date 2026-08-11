'use client';

import * as React from 'react';
import { ScrollText } from 'lucide-react';
import { formatDate, humanise } from '@/lib/utils';
import { auditService } from '@/services';
import { queryKeys, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { AuditEntry } from '@/types';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { PageHeader } from '@/components/common/page';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { DateFilter, FilterBar, FilterSelect, OrgFilters } from '@/components/common/filters';

const MODULES = [
  'AUTH', 'USERS', 'ZONES', 'AREAS', 'HOMECELLS', 'MEMBERS', 'TRANSFERS', 'ATTENDANCE',
  'FINANCE', 'PAYMENTS', 'REMITTANCES', 'SMS', 'REPORTS', 'SETTINGS', 'UPLOADS',
];

const ACTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'APPROVE', 'REJECT',
  'REVERSE', 'TRANSFER', 'UPLOAD', 'EXPORT', 'PAYMENT_INIT', 'PAYMENT_WEBHOOK', 'RECONCILE',
  'PERMISSION_CHANGE', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'SMS_DISPATCH',
];

export default function AuditPage() {
  const list = useListQuery();
  const [expanded, setExpanded] = React.useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.audit, list.query],
    () => auditService.list(list.query),
    { placeholderData: (previous) => previous },
  );

  const columns: Column<AuditEntry>[] = [
    {
      key: 'description',
      header: 'Activity',
      render: (entry) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{entry.description}</p>
          <p className="truncate text-xs text-muted-foreground">
            {entry.userName ?? 'System'}
            {entry.userRole ? ` · ${humanise(entry.userRole)}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'module',
      header: 'Module',
      render: (entry) => <Badge variant="secondary">{humanise(entry.module)}</Badge>,
    },
    {
      key: 'action',
      header: 'Action',
      hideOnMobile: true,
      render: (entry) => <span className="text-sm">{humanise(entry.action)}</span>,
    },
    {
      key: 'createdAt',
      header: 'When',
      sortable: true,
      render: (entry) => <span className="text-sm">{formatDate(entry.createdAt, true)}</span>,
    },
    {
      key: 'ipAddress',
      header: 'IP address',
      hideOnMobile: true,
      render: (entry) => (
        <span className="font-mono text-xs text-muted-foreground">{entry.ipAddress ?? '—'}</span>
      ),
    },
    {
      key: 'success',
      header: 'Result',
      render: (entry) => (
        <Badge variant={entry.success ? 'success' : 'destructive'}>
          {entry.success ? 'Success' : 'Failed'}
        </Badge>
      ),
    },
  ];

  const selected = data?.items.find((entry) => entry._id === expanded);

  return (
    <>
      <PageHeader
        title="Audit logs"
        description="An append-only record of every significant action. Entries cannot be edited or deleted by anyone."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Audit logs' }]}
      />

      <FilterBar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by description, user or record…"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <div className="space-y-4">
          <OrgFilters
            zoneId={list.filters.zoneId as string | undefined}
            areaId={list.filters.areaId as string | undefined}
            homecellId={list.filters.homecellId as string | undefined}
            onChange={(key, value) => list.setFilter(key, value)}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect
              label="Module"
              placeholder="All modules"
              value={list.filters.module as string | undefined}
              onChange={(value) => list.setFilter('module', value)}
              options={MODULES.map((m) => ({ value: m, label: humanise(m) }))}
            />
            <FilterSelect
              label="Action"
              placeholder="All actions"
              value={list.filters.action as string | undefined}
              onChange={(value) => list.setFilter('action', value)}
              options={ACTIONS.map((a) => ({ value: a, label: humanise(a) }))}
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
          rowKey={(entry) => entry._id}
          onRowClick={(entry) => setExpanded(entry._id === expanded ? null : entry._id)}
          pagination={data?.pagination}
          onPageChange={list.setPage}
          onLimitChange={list.setLimit}
          sort={list.sort}
          onSortChange={list.setSort}
          emptyState={
            <EmptyState
              icon={ScrollText}
              title="No audit entries match"
              description="Adjust the filters to widen the search."
            />
          }
        />
      )}

      {selected && (selected.previousValues || selected.newValues) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Change detail</CardTitle>
            <p className="text-sm text-muted-foreground">
              {selected.description} · {formatDate(selected.createdAt, true)}
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Previous values
              </p>
              <pre className="table-scroll rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(selected.previousValues ?? {}, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                New values
              </p>
              <pre className="table-scroll rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(selected.newValues ?? {}, null, 2)}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
