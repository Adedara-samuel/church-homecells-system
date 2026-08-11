'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeftRight, CalendarCheck, Pencil, Phone, ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { age, formatDate, humanise, initials } from '@/lib/utils';
import { attendanceService, membersService, transfersService } from '@/services';
import { queryKeys, useApiQuery } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/overlays';
import { DetailRow, PageHeader, StatusBadge } from '@/components/common/page';
import { DetailSkeleton, EmptyState, ErrorState } from '@/components/common/states';

interface AttendanceHistory {
  records: { _id: string; type: string; date: string; status: string }[];
  summary: { type: string; label: string; present: number; total: number; percentage: number }[];
}

export default function MemberDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const memberId = params.id;

  const {
    data: member,
    isLoading,
    isError,
    error,
    refetch,
  } = useApiQuery([...queryKeys.members, memberId], () => membersService.get(memberId));

  const attendance = useApiQuery(
    [...queryKeys.attendance, 'member', memberId],
    () => attendanceService.memberHistory(memberId) as Promise<AttendanceHistory>,
    { enabled: Boolean(member) && can('attendance.view') },
  );

  const transfers = useApiQuery(
    [...queryKeys.transfers, 'member', memberId],
    () => transfersService.history(memberId),
    { enabled: Boolean(member) && can('transfers.view') },
  );

  if (isLoading) return <DetailSkeleton />;
  if (isError || !member) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const fullName = [member.firstName, member.middleName, member.lastName].filter(Boolean).join(' ');

  return (
    <>
      <PageHeader
        title={fullName}
        description={`${member.memberId} · ${member.homecell?.name ?? 'No Homecell'}`}
        breadcrumbs={[{ label: 'Members', href: '/members' }, { label: fullName }]}
        actions={
          <>
            {can('members.transfer') && member.membershipStatus === 'ACTIVE' && (
              <Button variant="outline" asChild>
                <Link href={`/transfers/new?memberId=${member._id}`}>
                  <ArrowLeftRight className="h-4 w-4" />
                  Transfer
                </Link>
              </Button>
            )}
            {can('members.update') && (
              <Button asChild>
                <Link href={`/members/${member._id}/edit`}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="pt-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <Avatar className="h-24 w-24">
                {member.photoUrl && <AvatarImage src={member.photoUrl} alt={fullName} />}
                <AvatarFallback className="text-xl">{initials(fullName)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold">{member.preferredName || member.firstName}</p>
                <p className="text-sm text-muted-foreground">{member.memberId}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                <StatusBadge status={member.membershipStatus} />
                <Badge variant="secondary">{humanise(member.membershipCategory)}</Badge>
              </div>
              {!member.sensitiveRedacted && member.phone && (
                <Button variant="outline" size="sm" asChild className="w-full">
                  <a href={`tel:${member.phone}`}>
                    <Phone className="h-4 w-4" />
                    {member.phone}
                  </a>
                </Button>
              )}
            </div>

            {member.sensitiveRedacted && (
              <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <p>
                  Personal contact details are hidden because your role does not include access to
                  sensitive member information.
                </p>
              </div>
            )}

            <dl className="mt-6 space-y-4">
              <DetailRow label="Zone">{member.zone?.name}</DetailRow>
              <DetailRow label="Area">{member.area?.name}</DetailRow>
              <DetailRow label="Homecell">{member.homecell?.name}</DetailRow>
              {member.previousHomecell && (
                <DetailRow label="Previous Homecell">{member.previousHomecell.name}</DetailRow>
              )}
              <DetailRow label="Date joined">{formatDate(member.dateJoinedChurch)}</DetailRow>
            </dl>
          </CardContent>
        </Card>

        <div className="space-y-5 lg:col-span-2">
          <Tabs defaultValue="profile">
            <TabsList>
              <TabsTrigger value="profile">Profile</TabsTrigger>
              {can('attendance.view') && <TabsTrigger value="attendance">Attendance</TabsTrigger>}
              {can('transfers.view') && <TabsTrigger value="transfers">Transfers</TabsTrigger>}
            </TabsList>

            <TabsContent value="profile">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Member details</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-5 sm:grid-cols-2">
                    <DetailRow label="Full name">{fullName}</DetailRow>
                    <DetailRow label="Sex">{humanise(member.sex)}</DetailRow>
                    <DetailRow label="Date of birth">
                      {member.sensitiveRedacted
                        ? 'Restricted'
                        : member.dateOfBirth
                          ? `${formatDate(member.dateOfBirth)} (${age(member.dateOfBirth)} years)`
                          : null}
                    </DetailRow>
                    <DetailRow label="Marital status">{humanise(member.maritalStatus)}</DetailRow>
                    {member.maritalStatus === 'MARRIED' && (
                      <DetailRow label="Wedding anniversary">
                        {formatDate(member.weddingAnniversary)}
                      </DetailRow>
                    )}
                    <DetailRow label="Phone">
                      {member.sensitiveRedacted ? 'Restricted' : member.phone}
                    </DetailRow>
                    <DetailRow label="Alternate phone">
                      {member.sensitiveRedacted ? 'Restricted' : member.alternatePhone}
                    </DetailRow>
                    <DetailRow label="Email">
                      {member.sensitiveRedacted ? 'Restricted' : member.email}
                    </DetailRow>
                    <DetailRow label="Occupation">{member.occupation}</DetailRow>
                    <DetailRow label="Department">{member.department}</DetailRow>
                    <DetailRow label="Baptism status">{humanise(member.baptismStatus)}</DetailRow>
                    <DetailRow label="Membership class">
                      {member.membershipClassCompleted ? 'Completed' : 'Not completed'}
                    </DetailRow>
                    <DetailRow label="Address" className="sm:col-span-2">
                      {member.sensitiveRedacted ? 'Restricted' : member.residentialAddress}
                    </DetailRow>
                    <DetailRow label="Location" className="sm:col-span-2">
                      {[
                        member.location?.community,
                        member.location?.city,
                        member.location?.lga,
                        member.location?.state,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </DetailRow>
                    {!member.sensitiveRedacted && member.emergencyContact?.name && (
                      <DetailRow label="Emergency contact" className="sm:col-span-2">
                        {member.emergencyContact.name}
                        {member.emergencyContact.relationship
                          ? ` (${member.emergencyContact.relationship})`
                          : ''}
                        {member.emergencyContact.phone ? ` · ${member.emergencyContact.phone}` : ''}
                      </DetailRow>
                    )}
                    {!member.sensitiveRedacted && member.notes && (
                      <DetailRow label="Notes" className="sm:col-span-2">
                        {member.notes}
                      </DetailRow>
                    )}
                  </dl>
                </CardContent>
              </Card>
            </TabsContent>

            {can('attendance.view') && (
              <TabsContent value="attendance">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Attendance history</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {attendance.isLoading ? (
                      <DetailSkeleton />
                    ) : attendance.data && attendance.data.summary.length > 0 ? (
                      <div className="space-y-6">
                        <div className="grid gap-4 sm:grid-cols-3">
                          {attendance.data.summary.map((row) => (
                            <div key={row.type} className="rounded-lg border p-4">
                              <p className="text-xs text-muted-foreground">{row.label}</p>
                              <p className="mt-1 text-xl font-semibold tabular">
                                {row.percentage.toFixed(1)}%
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {row.present} of {row.total} meetings
                              </p>
                            </div>
                          ))}
                        </div>

                        <div className="table-scroll rounded-lg border">
                          <table className="w-full text-sm">
                            <thead className="border-b bg-muted/40">
                              <tr>
                                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">
                                  Date
                                </th>
                                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">
                                  Service
                                </th>
                                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-muted-foreground">
                                  Status
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {attendance.data.records.slice(0, 30).map((record) => (
                                <tr key={record._id} className="border-b last:border-0">
                                  <td className="px-4 py-2.5">{formatDate(record.date)}</td>
                                  <td className="px-4 py-2.5">{humanise(record.type)}</td>
                                  <td className="px-4 py-2.5">
                                    <StatusBadge status={record.status} />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (
                      <EmptyState
                        icon={CalendarCheck}
                        title="No attendance recorded yet"
                        description="Attendance appears here once a register including this member is submitted."
                      />
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}

            {can('transfers.view') && (
              <TabsContent value="transfers">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Transfer history</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {transfers.data && transfers.data.length > 0 ? (
                      <ol className="space-y-4">
                        {transfers.data.map((transfer) => (
                          <li
                            key={transfer._id}
                            className="cursor-pointer rounded-lg border p-4 transition-colors hover:bg-accent"
                            onClick={() => router.push(`/transfers/${transfer._id}`)}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium">{transfer.reference}</span>
                              <StatusBadge status={transfer.status} />
                            </div>
                            <p className="mt-2 text-sm">
                              {transfer.previousHomecell?.name} → {transfer.newHomecell?.name}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {humanise(transfer.scope)} · requested {formatDate(transfer.requestedAt)}
                            </p>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <EmptyState
                        icon={ArrowLeftRight}
                        title="No transfers recorded"
                        description="This member has always belonged to their current Homecell."
                      />
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </div>
    </>
  );
}
