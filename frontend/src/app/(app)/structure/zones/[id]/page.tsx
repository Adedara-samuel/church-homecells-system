'use client';

import { useParams, useRouter } from 'next/navigation';
import { Building2, Home, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatDate, formatNumber } from '@/lib/utils';
import { areasService, zonesService } from '@/services';
import { queryKeys, useApiQuery } from '@/hooks/use-api';
import type { Area } from '@/types';
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

export default function ZoneDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const id = params.id;

  const { data: zone, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.zones, id],
    () => zonesService.get(id),
  );

  const areas = useApiQuery(
    [...queryKeys.areas, 'by-zone', id],
    () => areasService.list({ zoneId: id, limit: 100 }),
    { enabled: Boolean(zone) },
  );

  if (isLoading) return <DetailSkeleton />;
  if (isError || !zone) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const columns: Column<Area>[] = [
    {
      key: 'name',
      header: 'Area',
      render: (area) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{area.name}</p>
          <p className="truncate text-xs text-muted-foreground">{area.code}</p>
        </div>
      ),
    },
    {
      key: 'coordinator',
      header: 'Coordinator',
      render: (area) =>
        area.coordinator ? (
          <span className="text-sm">
            {area.coordinator.firstName} {area.coordinator.lastName}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Not assigned</span>
        ),
    },
    {
      key: 'homecellCount',
      header: 'Homecells',
      align: 'right',
      render: (area) => formatNumber(area.homecellCount ?? 0),
    },
    {
      key: 'memberCount',
      header: 'Members',
      align: 'right',
      render: (area) => formatNumber(area.memberCount ?? 0),
    },
    { key: 'status', header: 'Status', render: (area) => <StatusBadge status={area.status} /> },
  ];

  return (
    <>
      <RecordHeader
        backHref="/structure/zones"
        backLabel="Zones"
        title={zone.name}
        reference={zone.code}
        subtitle={zone.description}
        status={<StatusBadge status={zone.status} />}
        highlight={{ label: 'Members', value: formatNumber(zone.memberCount ?? 0) }}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MiniStat label="Areas" value={formatNumber(zone.areaCount ?? 0)} icon={Building2} />
        <MiniStat label="Homecells" value={formatNumber(zone.homecellCount ?? 0)} icon={Home} />
        <MiniStat label="Active members" value={formatNumber(zone.memberCount ?? 0)} icon={Users} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <InfoCard
            title="Areas in this zone"
            description="Select an area to see the Homecells beneath it."
          >
            {areas.isLoading ? (
              <TableSkeleton rows={4} columns={5} />
            ) : areas.isError ? (
              <ErrorState error={areas.error} onRetry={() => void areas.refetch()} />
            ) : (
              <DataTable
                columns={columns}
                rows={areas.data?.items ?? []}
                rowKey={(area) => area._id}
                onRowClick={(area) => router.push(`/structure/areas/${area._id}`)}
                emptyState={
                  <EmptyState
                    icon={Building2}
                    title="No areas in this zone yet"
                    description="Create an Area before adding Homecells."
                  />
                }
              />
            )}
          </InfoCard>

          <RecordAuditTrail entityModel="Zone" entityId={zone._id} canView={can('audit.view')} />
        </div>

        <div className="space-y-5">
          <InfoCard title="Zone details">
            <InfoGrid columns={1}>
              <Info label="Zone code" mono>
                {zone.code}
              </Info>
              <Info label="Name">{zone.name}</Info>
              <Info label="Description">{zone.description}</Info>
              <Info label="Status">
                <StatusBadge status={zone.status} />
              </Info>
              <Info label="Created">{formatDate(zone.createdAt)}</Info>
            </InfoGrid>
          </InfoCard>

          <InfoCard title="Zonal Coordinator">
            {zone.coordinator ? (
              <InfoGrid columns={1}>
                <Info label="Name">
                  {can('users.view') ? (
                    <RecordLink href={`/admin/users/${zone.coordinator._id}`}>
                      {zone.coordinator.firstName} {zone.coordinator.lastName}
                    </RecordLink>
                  ) : (
                    `${zone.coordinator.firstName} ${zone.coordinator.lastName}`
                  )}
                </Info>
                <Info label="Email">{zone.coordinator.email}</Info>
                <Info label="Phone">{zone.coordinator.phone}</Info>
              </InfoGrid>
            ) : (
              <p className="text-sm text-muted-foreground">
                No Zonal Coordinator is assigned to this zone.
              </p>
            )}
          </InfoCard>
        </div>
      </div>
    </>
  );
}
