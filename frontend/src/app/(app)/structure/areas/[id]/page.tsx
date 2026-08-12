'use client';

import { useParams, useRouter } from 'next/navigation';
import { Home, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatDate, formatNumber } from '@/lib/utils';
import { areasService, homecellsService } from '@/services';
import { queryKeys, useApiQuery } from '@/hooks/use-api';
import type { Homecell } from '@/types';
import { StatusBadge } from '@/components/common/page';
import { DataTable, type Column } from '@/components/common/data-table';
import { DetailSkeleton, EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import {
  Info,
  InfoCard,
  InfoGrid,
  MiniStat,
  RecordAuditTrail,
  RecordHeader,
  RecordLink,
} from '@/components/common/detail';

export default function AreaDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const id = params.id;

  const { data: area, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.areas, id],
    () => areasService.get(id),
  );

  const homecells = useApiQuery(
    [...queryKeys.homecells, 'by-area', id],
    () => homecellsService.list({ areaId: id, limit: 100 }),
    { enabled: Boolean(area) },
  );

  if (isLoading) return <DetailSkeleton />;
  if (isError || !area) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const columns: Column<Homecell>[] = [
    {
      key: 'name',
      header: 'Homecell',
      render: (homecell) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{homecell.name}</p>
          <p className="truncate text-xs text-muted-foreground">{homecell.code}</p>
        </div>
      ),
    },
    {
      key: 'coordinator',
      header: 'Coordinator',
      render: (homecell) =>
        homecell.coordinator ? (
          <span className="text-sm">
            {homecell.coordinator.firstName} {homecell.coordinator.lastName}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Not assigned</span>
        ),
    },
    {
      key: 'meetingLocation',
      header: 'Location',
      hideOnMobile: true,
      render: (homecell) => <span className="text-sm">{homecell.meetingLocation ?? '—'}</span>,
    },
    {
      key: 'memberCount',
      header: 'Members',
      align: 'right',
      render: (homecell) => formatNumber(homecell.memberCount ?? 0),
    },
    {
      key: 'status',
      header: 'Status',
      render: (homecell) => <StatusBadge status={homecell.status} />,
    },
  ];

  return (
    <>
      <RecordHeader
        backHref="/structure/areas"
        backLabel="Areas"
        title={area.name}
        reference={area.code}
        subtitle={
          <>
            Part of{' '}
            {area.zone?._id ? (
              <RecordLink href={`/structure/zones/${area.zone._id}`}>{area.zone.name}</RecordLink>
            ) : (
              area.zone?.name
            )}
            {area.description ? ` · ${area.description}` : ''}
          </>
        }
        status={<StatusBadge status={area.status} />}
        highlight={{ label: 'Members', value: formatNumber(area.memberCount ?? 0) }}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <MiniStat label="Homecells" value={formatNumber(area.homecellCount ?? 0)} icon={Home} />
        <MiniStat label="Active members" value={formatNumber(area.memberCount ?? 0)} icon={Users} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <InfoCard
            title="Homecells in this area"
            description="Select a Homecell to see its purse and members."
          >
            {homecells.isLoading ? (
              <TableSkeleton rows={4} columns={5} />
            ) : homecells.isError ? (
              <ErrorState error={homecells.error} onRetry={() => void homecells.refetch()} />
            ) : (
              <DataTable
                columns={columns}
                rows={homecells.data?.items ?? []}
                rowKey={(homecell) => homecell._id}
                onRowClick={(homecell) => router.push(`/structure/homecells/${homecell._id}`)}
                emptyState={
                  <EmptyState
                    icon={Home}
                    title="No homecells in this area yet"
                    description="Create a Homecell to start registering members."
                  />
                }
              />
            )}
          </InfoCard>

          <RecordAuditTrail entityModel="Area" entityId={area._id} canView={can('audit.view')} />
        </div>

        <div className="space-y-5">
          <InfoCard title="Area details">
            <InfoGrid columns={1}>
              <Info label="Area code" mono>
                {area.code}
              </Info>
              <Info label="Name">{area.name}</Info>
              <Info label="Zone">
                {area.zone?._id ? (
                  <RecordLink href={`/structure/zones/${area.zone._id}`}>
                    {area.zone.name}
                  </RecordLink>
                ) : (
                  area.zone?.name
                )}
              </Info>
              <Info label="Description">{area.description}</Info>
              <Info label="Status">
                <StatusBadge status={area.status} />
              </Info>
              <Info label="Created">{formatDate(area.createdAt)}</Info>
            </InfoGrid>
          </InfoCard>

          <InfoCard title="Area Coordinator">
            {area.coordinator ? (
              <InfoGrid columns={1}>
                <Info label="Name">
                  {can('users.view') ? (
                    <RecordLink href={`/admin/users/${area.coordinator._id}`}>
                      {area.coordinator.firstName} {area.coordinator.lastName}
                    </RecordLink>
                  ) : (
                    `${area.coordinator.firstName} ${area.coordinator.lastName}`
                  )}
                </Info>
                <Info label="Email">{area.coordinator.email}</Info>
                <Info label="Phone">{area.coordinator.phone}</Info>
              </InfoGrid>
            ) : (
              <p className="text-sm text-muted-foreground">
                No Area Coordinator is assigned to this area.
              </p>
            )}
          </InfoCard>
        </div>
      </div>
    </>
  );
}
