'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CakeSlice, Heart, Phone } from 'lucide-react';
import { formatDate, initials } from '@/lib/utils';
import { membersService, settingsService } from '@/services';
import { queryKeys, useApiQuery } from '@/hooks/use-api';
import type { Member } from '@/types';
import { Badge, Card, CardContent, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/primitives';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/overlays';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { FilterSelect } from '@/components/common/filters';

/**
 * Upcoming birthdays and wedding anniversaries.
 *
 * The dashboard celebration tiles link here. Both lists are already scoped by the API,
 * so a Homecell Coordinator sees only their own members' occasions.
 */
export default function CelebrationsPage() {
  return (
    <React.Suspense fallback={<TableSkeleton rows={6} columns={3} />}>
      <Celebrations />
    </React.Suspense>
  );
}

function Celebrations() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get('celebrations') === 'anniversaries' ? 'anniversaries' : 'birthdays';

  const [days, setDays] = React.useState('30');

  const settings = useApiQuery([...queryKeys.settings], settingsService.get);

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.members, 'celebrations', days],
    () => membersService.celebrations(Number(days)),
  );

  const windowDays = settings.data?.upcomingCelebrationWindowDays ?? 30;

  return (
    <>
      <PageHeader
        title="Celebrations"
        description={`Birthdays and wedding anniversaries coming up in the next ${days} days. Automated SMS greetings are sent on the day itself.`}
        breadcrumbs={[{ label: 'Members', href: '/members' }, { label: 'Celebrations' }]}
        actions={
          <div className="w-44">
            <FilterSelect
              label="Window"
              value={days}
              placeholder={`${windowDays} days`}
              onChange={(value) => setDays(value ?? '30')}
              options={[
                { value: '7', label: 'Next 7 days' },
                { value: '14', label: 'Next 14 days' },
                { value: '30', label: 'Next 30 days' },
                { value: '90', label: 'Next 90 days' },
                { value: '365', label: 'Next 12 months' },
              ]}
            />
          </div>
        }
      />

      {isLoading ? (
        <TableSkeleton rows={6} columns={3} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <Tabs defaultValue={initialTab}>
          <TabsList>
            <TabsTrigger value="birthdays">
              Birthdays
              <Badge variant="secondary" className="ml-2">
                {data?.birthdays.length ?? 0}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="anniversaries">
              Anniversaries
              <Badge variant="secondary" className="ml-2">
                {data?.anniversaries.length ?? 0}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="birthdays">
            <CelebrationList
              members={data?.birthdays ?? []}
              dateField="dateOfBirth"
              icon={CakeSlice}
              emptyTitle="No birthdays coming up"
              emptyDescription={`No member in your scope has a birthday in the next ${days} days.`}
              onOpen={(id) => router.push(`/members/${id}`)}
            />
          </TabsContent>

          <TabsContent value="anniversaries">
            <CelebrationList
              members={data?.anniversaries ?? []}
              dateField="weddingAnniversary"
              icon={Heart}
              emptyTitle="No anniversaries coming up"
              emptyDescription={`No member in your scope has a wedding anniversary in the next ${days} days.`}
              onOpen={(id) => router.push(`/members/${id}`)}
            />
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}

function CelebrationList({
  members,
  dateField,
  icon: Icon,
  emptyTitle,
  emptyDescription,
  onOpen,
}: {
  members: Member[];
  dateField: 'dateOfBirth' | 'weddingAnniversary';
  icon: typeof CakeSlice;
  emptyTitle: string;
  emptyDescription: string;
  onOpen: (id: string) => void;
}) {
  if (members.length === 0) {
    return <EmptyState icon={Icon} title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {members.map((member) => {
        const original = member[dateField];
        const name = `${member.firstName} ${member.lastName}`;
        const occasion = original ? nextOccurrence(original) : null;

        return (
          <Card key={member._id} className="transition-colors hover:bg-accent/40">
            <CardContent className="pt-5">
              <button
                type="button"
                onClick={() => onOpen(member._id)}
                className="flex w-full items-center gap-3 text-left"
              >
                <Avatar className="h-12 w-12">
                  {member.photoUrl && <AvatarImage src={member.photoUrl} alt={name} />}
                  <AvatarFallback>{initials(name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{member.preferredName || name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {member.homecell?.name ?? member.memberId}
                  </p>
                </div>
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>

              <div className="mt-4 flex items-center justify-between gap-2 border-t pt-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {occasion?.label ?? 'Date'}
                  </p>
                  <p className="truncate text-sm font-medium">
                    {original ? formatDate(original) : '—'}
                    {occasion?.years ? (
                      <span className="ml-1 text-muted-foreground">({occasion.years})</span>
                    ) : null}
                  </p>
                </div>
                {member.phone && (
                  <Button variant="ghost" size="sm" asChild>
                    <a href={`tel:${member.phone}`} onClick={(e) => e.stopPropagation()}>
                      <Phone className="h-4 w-4" />
                    </a>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

/** How many days away the next anniversary of a date is, and which one it will be. */
function nextOccurrence(iso: string): { label: string; years: string } {
  const original = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const next = new Date(today.getFullYear(), original.getMonth(), original.getDate());
  if (next < today) next.setFullYear(next.getFullYear() + 1);

  const diffDays = Math.round((next.getTime() - today.getTime()) / 86_400_000);
  const label = diffDays === 0 ? 'Today' : diffDays === 1 ? 'Tomorrow' : `In ${diffDays} days`;

  const years = next.getFullYear() - original.getFullYear();
  return { label, years: years > 0 ? `${ordinal(years)}` : '' };
}

function ordinal(value: number): string {
  const suffix =
    value % 100 >= 11 && value % 100 <= 13
      ? 'th'
      : value % 10 === 1
        ? 'st'
        : value % 10 === 2
          ? 'nd'
          : value % 10 === 3
            ? 'rd'
            : 'th';
  return `${value}${suffix}`;
}
