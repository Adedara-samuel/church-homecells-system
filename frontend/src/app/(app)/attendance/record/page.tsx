'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Save, Users, XCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn, formatNumber, humanise, initials, mostRecentWeekday } from '@/lib/utils';
import { attendanceService, homecellsService } from '@/services';
import { queryKeys, useApiMutation } from '@/hooks/use-api';
import type { AttendanceStatus, AttendanceType } from '@/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, Input, Label } from '@/components/ui/primitives';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/overlays';
import { PageHeader } from '@/components/common/page';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { SelectField } from '@/components/common/form';

/** SRS 6.8 — each service is locked to one weekday (0 = Sunday). */
const SERVICES: { value: AttendanceType; label: string; weekday: number }[] = [
  { value: 'SUNDAY_HOMECELL', label: 'Sunday Homecell', weekday: 0 },
  { value: 'TUESDAY_MIRACLE_SERVICE', label: 'Tuesday Miracle Service', weekday: 2 },
  { value: 'THURSDAY_HOUR_OF_EMPHASIS', label: 'Thursday Hour of Emphasis', weekday: 4 },
];

export default function RecordAttendancePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const [homecellId, setHomecellId] = React.useState(
    searchParams.get('homecellId') ?? user?.homecell ?? '',
  );
  const [type, setType] = React.useState<AttendanceType>(
    (searchParams.get('type') as AttendanceType) ?? 'SUNDAY_HOMECELL',
  );
  const service = SERVICES.find((s) => s.value === type)!;
  const [date, setDate] = React.useState(() => mostRecentWeekday(service.weekday));

  // Changing the service snaps the date to the most recent valid day for it,
  // so the form is never left in an invalid state by a dropdown change alone.
  const handleTypeChange = (next: string) => {
    const nextService = SERVICES.find((s) => s.value === next)!;
    setType(nextService.value);
    setDate(mostRecentWeekday(nextService.weekday));
  };

  const homecells = useQuery({
    queryKey: [...queryKeys.homecells, 'options', 'all'],
    queryFn: () => homecellsService.options({}),
  });

  const register = useQuery({
    queryKey: [...queryKeys.attendance, 'register', homecellId, type, date],
    queryFn: () => attendanceService.register(homecellId, type, date),
    enabled: Boolean(homecellId && date),
  });

  const [marks, setMarks] = React.useState<Record<string, AttendanceStatus>>({});

  // Reset the local marks whenever the register itself changes.
  React.useEffect(() => {
    if (!register.data) return;
    setMarks(
      Object.fromEntries(
        register.data.entries.map((entry) => [entry.member._id, entry.status]),
      ),
    );
  }, [register.data]);

  const mutation = useApiMutation(
    () =>
      attendanceService.record({
        homecellId,
        type,
        date,
        entries: Object.entries(marks).map(([memberId, status]) => ({ memberId, status })),
      }),
    {
      successMessage: 'Attendance saved',
      invalidates: [queryKeys.attendance, queryKeys.dashboard],
      onSuccess: () => router.push('/attendance'),
    },
  );

  const entries = register.data?.entries ?? [];
  const presentCount = Object.values(marks).filter((status) => status === 'PRESENT').length;
  const isValidDate = register.data?.isValidDate ?? true;

  const setAll = (status: AttendanceStatus) => {
    setMarks(Object.fromEntries(entries.map((entry) => [entry.member._id, status])));
  };

  return (
    <>
      <PageHeader
        title="Record attendance"
        description="Mark who attended, then save. The date must match the day the service is held."
        breadcrumbs={[{ label: 'Attendance', href: '/attendance' }, { label: 'Record' }]}
      />

      <Card>
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Homecell</Label>
            <SelectField
              value={homecellId}
              onChange={setHomecellId}
              placeholder="Select a Homecell"
              options={(homecells.data ?? []).map((homecell) => ({
                value: homecell._id,
                label: `${homecell.name} (${homecell.code})`,
              }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Service</Label>
            <SelectField
              value={type}
              onChange={handleTypeChange}
              options={SERVICES.map((s) => ({ value: s.value, label: s.label }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="attendance-date">Date</Label>
            <Input
              id="attendance-date"
              type="date"
              value={date}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setDate(event.target.value)}
              aria-invalid={!isValidDate}
            />
          </div>
        </CardContent>
      </Card>

      {/* The server rejects a mismatched day; this mirrors that rule immediately. */}
      {register.data && !isValidDate && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium text-destructive">This date is not valid for this service</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {service.label} attendance can only be recorded on a {register.data.requiredDayName}.
              The date you selected falls on a {register.data.dayName}.
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => setDate(mostRecentWeekday(service.weekday))}
            >
              Use the most recent {register.data.requiredDayName}
            </Button>
          </div>
        </div>
      )}

      {register.data?.alreadyRecorded && isValidDate && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          Attendance has already been recorded for this date. Saving will update the existing
          register rather than creating a duplicate.
        </div>
      )}

      {!homecellId ? (
        <EmptyState
          icon={Users}
          title="Select a Homecell"
          description="Choose the Homecell whose register you want to record."
        />
      ) : register.isLoading ? (
        <TableSkeleton rows={8} columns={3} />
      ) : register.isError ? (
        <ErrorState error={register.error} onRetry={() => void register.refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No active members in this Homecell"
          description="Register members before recording attendance."
        />
      ) : (
        <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{formatNumber(presentCount)}</span> of{' '}
              {formatNumber(entries.length)} marked present
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAll('PRESENT')}>
                <CheckCircle2 className="h-4 w-4" />
                Mark all present
              </Button>
              <Button variant="outline" size="sm" onClick={() => setAll('ABSENT')}>
                <XCircle className="h-4 w-4" />
                Clear all
              </Button>
            </div>
          </div>

          {/* Large tap targets: this list is used on a phone during a meeting. */}
          <ul className="space-y-2">
            {entries.map((entry) => {
              const status = marks[entry.member._id] ?? 'ABSENT';
              const present = status === 'PRESENT';
              const name = [entry.member.firstName, entry.member.lastName].filter(Boolean).join(' ');

              return (
                <li key={entry.member._id}>
                  <button
                    type="button"
                    onClick={() =>
                      setMarks((current) => ({
                        ...current,
                        [entry.member._id]: present ? 'ABSENT' : 'PRESENT',
                      }))
                    }
                    aria-pressed={present}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                      present
                        ? 'border-success/50 bg-success/10'
                        : 'hover:bg-accent',
                    )}
                  >
                    <Avatar className="h-10 w-10">
                      {entry.member.photoUrl && (
                        <AvatarImage src={entry.member.photoUrl} alt={name} />
                      )}
                      <AvatarFallback>{initials(name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {entry.member.preferredName || name}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {entry.member.memberId} · {humanise(entry.member.sex)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'flex h-7 w-7 items-center justify-center rounded-full border-2 transition-colors',
                        present
                          ? 'border-success bg-success text-success-foreground'
                          : 'border-muted-foreground/30',
                      )}
                      aria-hidden
                    >
                      {present && <CheckCircle2 className="h-4 w-4" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {service.label} · {date}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => router.push('/attendance')}>
                  Cancel
                </Button>
                <Button
                  onClick={() => mutation.mutate()}
                  loading={mutation.isPending}
                  disabled={!isValidDate}
                >
                  <Save className="h-4 w-4" />
                  Save attendance
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
