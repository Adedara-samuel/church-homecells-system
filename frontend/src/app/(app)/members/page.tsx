'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Download, Plus, UserPlus, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { age, formatDate, humanise } from '@/lib/utils';
import { membersService, reportsService } from '@/services';
import { queryKeys, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { Member } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { PageHeader, StatusBadge } from '@/components/common/page';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { FilterBar, FilterSelect, OrgFilters } from '@/components/common/filters';

const MEMBERSHIP_STATUSES = ['ACTIVE', 'INACTIVE', 'TRANSFERRED_OUT', 'RELOCATED', 'DECEASED'];
const CATEGORIES = ['NEW_CONVERT', 'MEMBER', 'WORKER', 'LEADER', 'MINISTER'];
const SEXES = ['MALE', 'FEMALE', 'UNSPECIFIED'];

export default function MembersPage() {
  const router = useRouter();
  const { can } = useAuth();
  const list = useListQuery({ membershipStatus: 'ACTIVE' });

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.members, list.query],
    () => membersService.list(list.query),
    { placeholderData: (previous) => previous },
  );

  const columns: Column<Member>[] = [
    {
      key: 'name',
      header: 'Member',
      render: (member) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {[member.firstName, member.middleName, member.lastName].filter(Boolean).join(' ')}
          </p>
          <p className="truncate text-xs text-muted-foreground">{member.memberId}</p>
        </div>
      ),
    },
    {
      key: 'homecell',
      header: 'Homecell',
      render: (member) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{member.homecell?.name ?? '—'}</p>
          <p className="truncate text-xs text-muted-foreground">{member.area?.name ?? ''}</p>
        </div>
      ),
    },
    {
      key: 'sex',
      header: 'Sex',
      hideOnMobile: true,
      render: (member) => <span className="text-sm">{humanise(member.sex)}</span>,
    },
    {
      key: 'age',
      header: 'Age',
      align: 'right',
      hideOnMobile: true,
      render: (member) => <span className="text-sm">{age(member.dateOfBirth) ?? '—'}</span>,
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (member) =>
        member.sensitiveRedacted ? (
          <Badge variant="muted">Restricted</Badge>
        ) : (
          <span className="text-sm">{member.phone ?? '—'}</span>
        ),
    },
    {
      key: 'dateJoinedChurch',
      header: 'Joined',
      sortable: true,
      hideOnMobile: true,
      render: (member) => <span className="text-sm">{formatDate(member.dateJoinedChurch)}</span>,
    },
    {
      key: 'membershipStatus',
      header: 'Status',
      render: (member) => <StatusBadge status={member.membershipStatus} />,
    },
  ];

  return (
    <>
      <PageHeader
        title="Members"
        description="The central register of church members across your organisational scope."
        actions={
          <>
            {can('reports.export') && (
              <Button
                variant="outline"
                onClick={() =>
                  void reportsService.export('members', 'xlsx', {
                    ...list.filters,
                    membershipStatus: list.filters.membershipStatus as string,
                  })
                }
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Export</span>
              </Button>
            )}
            {can('members.create') && (
              <Button asChild>
                <Link href="/members/new">
                  <Plus className="h-4 w-4" />
                  Register member
                </Link>
              </Button>
            )}
          </>
        }
      />

      <FilterBar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by name, member ID, phone or email…"
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
              label="Membership status"
              placeholder="All statuses"
              value={list.filters.membershipStatus as string | undefined}
              onChange={(value) => list.setFilter('membershipStatus', value)}
              options={MEMBERSHIP_STATUSES.map((s) => ({ value: s, label: humanise(s) }))}
            />
            <FilterSelect
              label="Category"
              placeholder="All categories"
              value={list.filters.membershipCategory as string | undefined}
              onChange={(value) => list.setFilter('membershipCategory', value)}
              options={CATEGORIES.map((c) => ({ value: c, label: humanise(c) }))}
            />
            <FilterSelect
              label="Sex"
              placeholder="All"
              value={list.filters.sex as string | undefined}
              onChange={(value) => list.setFilter('sex', value)}
              options={SEXES.map((s) => ({ value: s, label: humanise(s) }))}
            />
            <FilterSelect
              label="Age range"
              placeholder="All ages"
              value={
                list.filters.minAge !== undefined
                  ? `${list.filters.minAge}-${list.filters.maxAge ?? ''}`
                  : undefined
              }
              onChange={(value) => {
                if (!value) {
                  list.setFilter('minAge', undefined);
                  list.setFilter('maxAge', undefined);
                  return;
                }
                const [min, max] = value.split('-');
                list.setFilter('minAge', Number(min));
                list.setFilter('maxAge', max ? Number(max) : undefined);
              }}
              options={[
                { value: '0-12', label: '0–12' },
                { value: '13-17', label: '13–17' },
                { value: '18-25', label: '18–25' },
                { value: '26-35', label: '26–35' },
                { value: '36-45', label: '36–45' },
                { value: '46-55', label: '46–55' },
                { value: '56-65', label: '56–65' },
                { value: '66-', label: '66+' },
              ]}
            />
          </div>
        </div>
      </FilterBar>

      {isLoading ? (
        <TableSkeleton rows={8} columns={7} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(member) => member._id}
          onRowClick={(member) => router.push(`/members/${member._id}`)}
          pagination={data?.pagination}
          onPageChange={list.setPage}
          onLimitChange={list.setLimit}
          sort={list.sort}
          onSortChange={list.setSort}
          emptyState={
            <EmptyState
              icon={list.activeFilterCount > 0 || list.search ? Users : UserPlus}
              title={
                list.search || list.activeFilterCount > 0
                  ? 'No members match your search'
                  : 'No members registered yet'
              }
              description={
                list.search || list.activeFilterCount > 0
                  ? 'Try a different search term or clear the filters.'
                  : 'Register the first member of this Homecell to begin recording attendance and offerings.'
              }
              action={
                list.search || list.activeFilterCount > 0 ? (
                  <Button variant="outline" onClick={list.resetFilters}>
                    Clear filters
                  </Button>
                ) : can('members.create') ? (
                  <Button asChild>
                    <Link href="/members/new">
                      <Plus className="h-4 w-4" />
                      Register member
                    </Link>
                  </Button>
                ) : null
              }
            />
          }
        />
      )}
    </>
  );
}
