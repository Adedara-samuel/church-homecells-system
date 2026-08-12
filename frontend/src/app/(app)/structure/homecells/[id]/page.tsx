'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { CalendarCheck, MapPin, Users, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { age, formatDate, formatMinor, formatNumber, formatPercent, humanise } from '@/lib/utils';
import { attendanceService, financeService, homecellsService, membersService } from '@/services';
import { queryKeys, useApiQuery } from '@/hooks/use-api';
import type { Member } from '@/types';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
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

export default function HomecellDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const id = params.id;

  const { data: homecell, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.homecells, id],
    () => homecellsService.get(id),
  );

  const members = useApiQuery(
    [...queryKeys.members, 'by-homecell', id],
    () => membersService.list({ homecellId: id, limit: 100, membershipStatus: 'ACTIVE' }),
    { enabled: Boolean(homecell) && can('members.view') },
  );

  const purse = useApiQuery(
    [...queryKeys.finance, 'purse', id],
    () => financeService.purse(id),
    { enabled: Boolean(homecell) && can('finance.view') },
  );

  const attendance = useApiQuery(
    [...queryKeys.attendance, 'summary', id],
    () => attendanceService.summary({ homecellId: id }),
    { enabled: Boolean(homecell) && can('attendance.view') },
  );

  if (isLoading) return <DetailSkeleton />;
  if (isError || !homecell) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const memberColumns: Column<Member>[] = [
    {
      key: 'name',
      header: 'Member',
      render: (member) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {member.firstName} {member.lastName}
          </p>
          <p className="truncate text-xs text-muted-foreground">{member.memberId}</p>
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
      render: (member) => <span className="text-sm">{member.phone ?? '—'}</span>,
    },
    {
      key: 'membershipStatus',
      header: 'Status',
      render: (member) => <StatusBadge status={member.membershipStatus} />,
    },
  ];

  return (
    <>
      <RecordHeader
        backHref="/structure/homecells"
        backLabel="Homecells"
        title={homecell.name}
        reference={homecell.code}
        subtitle={
          <>
            {homecell.area?._id ? (
              <RecordLink href={`/structure/areas/${homecell.area._id}`}>
                {homecell.area.name}
              </RecordLink>
            ) : (
              homecell.area?.name
            )}
            {' · '}
            {homecell.zone?._id ? (
              <RecordLink href={`/structure/zones/${homecell.zone._id}`}>
                {homecell.zone.name}
              </RecordLink>
            ) : (
              homecell.zone?.name
            )}
          </>
        }
        status={<StatusBadge status={homecell.status} />}
        highlight={{ label: 'Active members', value: formatNumber(homecell.memberCount ?? 0) }}
        actions={
          <>
            {can('attendance.create') && (
              <Button variant="outline" asChild>
                <Link href={`/attendance/record?homecellId=${homecell._id}`}>
                  <CalendarCheck className="h-4 w-4" />
                  Record attendance
                </Link>
              </Button>
            )}
            {can('finance.view') && (
              <Button asChild>
                <Link href={`/finance/purses/${homecell._id}`}>
                  <Wallet className="h-4 w-4" />
                  Open purse
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat
          label="Active members"
          value={formatNumber(homecell.memberCount ?? 0)}
          icon={Users}
        />
        {purse.data && (
          <>
            <MiniStat
              label="Purse balance"
              value={formatMinor(purse.data.balance.availableMinor, purse.data.currency)}
              icon={Wallet}
              tone={purse.data.requiresRemittance ? 'warning' : 'default'}
            />
            <MiniStat
              label="Maximum threshold"
              value={formatMinor(purse.data.thresholdMinor, purse.data.currency)}
              tone="muted"
            />
          </>
        )}
        {attendance.data && (
          <MiniStat
            label="Attendance rate"
            value={formatPercent(attendance.data.overall.percentage)}
            icon={CalendarCheck}
            tone={attendance.data.overall.percentage >= 60 ? 'success' : 'warning'}
          />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Tabs defaultValue="members">
            <TabsList>
              {can('members.view') && <TabsTrigger value="members">Members</TabsTrigger>}
              {can('attendance.view') && <TabsTrigger value="attendance">Attendance</TabsTrigger>}
            </TabsList>

            {can('members.view') && (
              <TabsContent value="members">
                <InfoCard title="Members" description="Active members on this Homecell's register.">
                  {members.isLoading ? (
                    <TableSkeleton rows={5} columns={5} />
                  ) : members.isError ? (
                    <ErrorState error={members.error} onRetry={() => void members.refetch()} />
                  ) : (
                    <DataTable
                      columns={memberColumns}
                      rows={members.data?.items ?? []}
                      rowKey={(member) => member._id}
                      onRowClick={(member) => router.push(`/members/${member._id}`)}
                      emptyState={
                        <EmptyState
                          icon={Users}
                          title="No members registered yet"
                          description="Register the first member of this Homecell."
                        />
                      }
                    />
                  )}
                </InfoCard>
              </TabsContent>
            )}

            {can('attendance.view') && (
              <TabsContent value="attendance">
                <InfoCard
                  title="Attendance by service"
                  description="Across all recorded registers for this Homecell."
                >
                  {attendance.isLoading ? (
                    <TableSkeleton rows={3} columns={3} />
                  ) : attendance.data && attendance.data.byType.length > 0 ? (
                    <div className="space-y-4">
                      {attendance.data.byType.map((service) => (
                        <div key={service.type} className="space-y-1.5">
                          <div className="flex items-center justify-between text-sm">
                            <span>{service.label}</span>
                            <span className="tabular font-medium">
                              {formatPercent(service.percentage)}
                            </span>
                          </div>
                          <div
                            className="h-2 overflow-hidden rounded-full bg-muted"
                            role="progressbar"
                            aria-valuenow={service.percentage}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`${service.label} attendance`}
                          >
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${Math.min(service.percentage, 100)}%` }}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatNumber(service.present)} present of{' '}
                            {formatNumber(service.total)} expected · {service.meetings} meetings
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState
                      icon={CalendarCheck}
                      title="No attendance recorded yet"
                      description="Record a register to see attendance rates here."
                    />
                  )}
                </InfoCard>
              </TabsContent>
            )}
          </Tabs>

          <RecordAuditTrail
            entityModel="Homecell"
            entityId={homecell._id}
            canView={can('audit.view')}
          />
        </div>

        <div className="space-y-5">
          <InfoCard title="Homecell details">
            <InfoGrid columns={1}>
              <Info label="Homecell code" mono>
                {homecell.code}
              </Info>
              <Info label="Area">{homecell.area?.name}</Info>
              <Info label="Zone">{homecell.zone?.name}</Info>
              <Info label="Meeting location">
                {homecell.meetingLocation && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                    {homecell.meetingLocation}
                  </span>
                )}
              </Info>
              <Info label="Meeting address">{homecell.meetingAddress}</Info>
              <Info label="Purse threshold">
                {homecell.maxPurseThresholdOverride != null
                  ? `${formatMinor(homecell.maxPurseThresholdOverride)} (override)`
                  : 'Church-wide default'}
              </Info>
              <Info label="Status">
                <StatusBadge status={homecell.status} />
              </Info>
              <Info label="Created">{formatDate(homecell.createdAt)}</Info>
            </InfoGrid>
          </InfoCard>

          <InfoCard title="Leadership">
            <InfoGrid columns={1}>
              <Info label="Coordinator">
                {homecell.coordinator
                  ? can('users.view')
                    ? (
                        <RecordLink href={`/admin/users/${homecell.coordinator._id}`}>
                          {homecell.coordinator.firstName} {homecell.coordinator.lastName}
                        </RecordLink>
                      )
                    : `${homecell.coordinator.firstName} ${homecell.coordinator.lastName}`
                  : null}
              </Info>
              <Info label="Coordinator contact">{homecell.coordinator?.email}</Info>
              <Info label="Assistant coordinator">
                {homecell.assistantCoordinator
                  ? `${homecell.assistantCoordinator.firstName} ${homecell.assistantCoordinator.lastName}`
                  : null}
              </Info>
            </InfoGrid>
          </InfoCard>
        </div>
      </div>
    </>
  );
}
