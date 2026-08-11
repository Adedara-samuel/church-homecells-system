'use client';

import Link from 'next/link';
import { CalendarCheck, Download, Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatDate, formatNumber, formatPercent, humanise } from '@/lib/utils';
import { attendanceService, reportsService } from '@/services';
import { queryKeys, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { AttendanceRecord } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/primitives';
import { PageHeader, StatCard, StatusBadge } from '@/components/common/page';
import { DataTable, type Column } from '@/components/common/data-table';
import { CardSkeleton, EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { DateFilter, FilterBar, FilterSelect, OrgFilters } from '@/components/common/filters';
import { AttendanceAreaChart } from '@/components/common/charts';

const SERVICES = [
  { value: 'SUNDAY_HOMECELL', label: 'Sunday Homecell' },
  { value: 'TUESDAY_MIRACLE_SERVICE', label: 'Tuesday Miracle Service' },
  { value: 'THURSDAY_HOUR_OF_EMPHASIS', label: 'Thursday Hour of Emphasis' },
];

export default function AttendancePage() {
  const { can } = useAuth();
  const list = useListQuery();

  const orgFilters = {
    zoneId: list.filters.zoneId,
    areaId: list.filters.areaId,
    homecellId: list.filters.homecellId,
    from: list.filters.from,
    to: list.filters.to,
  };

  const records = useApiQuery(
    [...queryKeys.attendance, 'list', list.query],
    () => attendanceService.list(list.query),
    { placeholderData: (previous) => previous },
  );

  const summary = useApiQuery([...queryKeys.attendance, 'summary', orgFilters], () =>
    attendanceService.summary(orgFilters),
  );

  const trend = useApiQuery([...queryKeys.attendance, 'trend', orgFilters], () =>
    attendanceService.trend(orgFilters),
  );

  const columns: Column<AttendanceRecord>[] = [
    {
      key: 'member',
      header: 'Member',
      render: (record) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {record.member?.firstName} {record.member?.lastName}
          </p>
          <p className="truncate text-xs text-muted-foreground">{record.member?.memberId}</p>
        </div>
      ),
    },
    {
      key: 'homecell',
      header: 'Homecell',
      render: (record) => <span className="text-sm">{record.homecell?.name ?? '—'}</span>,
    },
    {
      key: 'type',
      header: 'Service',
      render: (record) => <span className="text-sm">{humanise(record.type)}</span>,
    },
    {
      key: 'date',
      header: 'Date',
      sortable: true,
      render: (record) => <span className="text-sm">{formatDate(record.date)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (record) => <StatusBadge status={record.status} />,
    },
    {
      key: 'recordedBy',
      header: 'Recorded by',
      hideOnMobile: true,
      render: (record) =>
        record.recordedBy ? (
          <span className="text-sm">
            {record.recordedBy.firstName} {record.recordedBy.lastName}
          </span>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Attendance"
        description="Sunday Homecell, Tuesday Miracle Service and Thursday Hour of Emphasis registers."
        actions={
          <>
            {can('reports.export') && (
              <Button
                variant="outline"
                onClick={() => void reportsService.export('attendance', 'xlsx', orgFilters as never)}
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Export</span>
              </Button>
            )}
            {can('attendance.create') && (
              <Button asChild>
                <Link href="/attendance/record">
                  <Plus className="h-4 w-4" />
                  Record attendance
                </Link>
              </Button>
            )}
          </>
        }
      />

      {summary.isLoading ? (
        <CardSkeleton count={4} />
      ) : summary.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Overall attendance"
            value={formatPercent(summary.data.overall.percentage)}
            hint={`${formatNumber(summary.data.overall.present)} present of ${formatNumber(
              summary.data.overall.total,
            )} expected`}
            icon={CalendarCheck}
            tone={summary.data.overall.percentage >= 60 ? 'success' : 'warning'}
          />
          {summary.data.byType.map((service) => (
            <StatCard
              key={service.type}
              label={service.label}
              value={formatPercent(service.percentage)}
              hint={`${formatNumber(service.present)} present · ${formatNumber(service.meetings)} meetings`}
            />
          ))}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attendance trend</CardTitle>
          <CardDescription>Members present at each service over the selected period</CardDescription>
        </CardHeader>
        <CardContent>
          <AttendanceAreaChart
            data={trend.data ?? []}
            xKey="date"
            series={SERVICES.map((s) => ({ key: s.value, label: s.label }))}
          />
        </CardContent>
      </Card>

      <FilterBar
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
              label="Service"
              placeholder="All services"
              value={list.filters.type as string | undefined}
              onChange={(value) => list.setFilter('type', value)}
              options={SERVICES}
            />
            <FilterSelect
              label="Status"
              placeholder="All"
              value={list.filters.status as string | undefined}
              onChange={(value) => list.setFilter('status', value)}
              options={[
                { value: 'PRESENT', label: 'Present' },
                { value: 'ABSENT', label: 'Absent' },
              ]}
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

      {records.isLoading ? (
        <TableSkeleton rows={8} columns={6} />
      ) : records.isError ? (
        <ErrorState error={records.error} onRetry={() => void records.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={records.data?.items ?? []}
          rowKey={(record) => record._id}
          pagination={records.data?.pagination}
          onPageChange={list.setPage}
          onLimitChange={list.setLimit}
          sort={list.sort}
          onSortChange={list.setSort}
          emptyState={
            <EmptyState
              icon={CalendarCheck}
              title="No attendance records yet"
              description="Record a register for a Homecell to see attendance here."
              action={
                can('attendance.create') && (
                  <Button asChild>
                    <Link href="/attendance/record">
                      <Plus className="h-4 w-4" />
                      Record attendance
                    </Link>
                  </Button>
                )
              }
            />
          }
        />
      )}
    </>
  );
}
