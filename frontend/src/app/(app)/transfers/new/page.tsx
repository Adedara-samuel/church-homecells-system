'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Send } from 'lucide-react';
import { areasService, homecellsService, membersService, transfersService, zonesService } from '@/services';
import { queryKeys, useApiMutation } from '@/hooks/use-api';
import { humanise } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, Textarea } from '@/components/ui/primitives';
import { PageHeader } from '@/components/common/page';
import { Field, FormSection, SelectField } from '@/components/common/form';
import { ErrorState } from '@/components/common/states';

export default function NewTransferPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [memberId, setMemberId] = React.useState(searchParams.get('memberId') ?? '');
  const [memberSearch, setMemberSearch] = React.useState('');
  const [zoneId, setZoneId] = React.useState('');
  const [areaId, setAreaId] = React.useState('');
  const [destinationHomecellId, setDestinationHomecellId] = React.useState('');
  const [reason, setReason] = React.useState('');

  const members = useQuery({
    queryKey: [...queryKeys.members, 'transfer-picker', memberSearch],
    queryFn: () =>
      membersService.list({ search: memberSearch || undefined, membershipStatus: 'ACTIVE', limit: 50 }),
  });

  const selectedMember = useQuery({
    queryKey: [...queryKeys.members, memberId],
    queryFn: () => membersService.get(memberId),
    enabled: Boolean(memberId),
  });

  const zones = useQuery({ queryKey: [...queryKeys.zones, 'options'], queryFn: zonesService.options });
  const areas = useQuery({
    queryKey: [...queryKeys.areas, 'options', zoneId || 'all'],
    queryFn: () => areasService.options(zoneId || undefined),
  });
  const homecells = useQuery({
    queryKey: [...queryKeys.homecells, 'options', zoneId || 'all', areaId || 'all'],
    queryFn: () => homecellsService.options({ zoneId: zoneId || undefined, areaId: areaId || undefined }),
  });

  const mutation = useApiMutation(
    () => transfersService.initiate({ memberId, destinationHomecellId, reason: reason.trim() }),
    {
      successMessage: 'Transfer request submitted for approval',
      invalidates: [queryKeys.transfers, queryKeys.members, queryKeys.dashboard],
      onSuccess: (transfer) => router.push(`/transfers/${transfer._id}`),
    },
  );

  const member = selectedMember.data;
  const currentHomecellId = member?.homecell?._id;

  // The scope determines the approval chain, so it is shown before submission.
  const scope = React.useMemo(() => {
    if (!member || !destinationHomecellId) return null;
    const destination = homecells.data?.find((h) => h._id === destinationHomecellId);
    if (!destination) return null;
    if (destination.zone?._id !== member.zone?._id) return 'CROSS_ZONE';
    if (destination.area?._id !== member.area?._id) return 'CROSS_AREA';
    return 'SAME_AREA';
  }, [member, destinationHomecellId, homecells.data]);

  const canSubmit =
    Boolean(memberId) &&
    Boolean(destinationHomecellId) &&
    destinationHomecellId !== currentHomecellId &&
    reason.trim().length >= 5;

  return (
    <>
      <PageHeader
        title="New member transfer"
        description="Move a member to another Homecell. The request follows the configured approval chain."
        breadcrumbs={[{ label: 'Transfers', href: '/transfers' }, { label: 'New' }]}
      />

      {selectedMember.isError && (
        <ErrorState error={selectedMember.error} onRetry={() => void selectedMember.refetch()} />
      )}

      <FormSection title="Member" description="Choose the member being transferred.">
        <Field label="Search members" className="sm:col-span-2">
          <input
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={memberSearch}
            onChange={(event) => setMemberSearch(event.target.value)}
            placeholder="Type a name, member ID or phone number"
          />
        </Field>
        <Field label="Member" required className="sm:col-span-2">
          <SelectField
            value={memberId}
            onChange={setMemberId}
            placeholder="Select a member"
            options={(members.data?.items ?? []).map((m) => ({
              value: m._id,
              label: `${m.firstName} ${m.lastName} — ${m.memberId} (${m.homecell?.name ?? 'No Homecell'})`,
            }))}
          />
        </Field>
      </FormSection>

      {member && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center">
            <div className="flex-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Current</p>
              <p className="font-medium">{member.homecell?.name}</p>
              <p className="text-sm text-muted-foreground">
                {member.area?.name} · {member.zone?.name}
              </p>
            </div>
            <ArrowRight className="hidden h-5 w-5 shrink-0 text-muted-foreground sm:block" />
            <div className="flex-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Destination</p>
              <p className="font-medium">
                {homecells.data?.find((h) => h._id === destinationHomecellId)?.name ?? 'Not selected'}
              </p>
              {scope && (
                <p className="text-sm text-muted-foreground">{humanise(scope)} transfer</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <FormSection
        title="Destination"
        description="Narrow by Zone and Area to find the destination Homecell."
      >
        <Field label="Destination zone">
          <SelectField
            value={zoneId}
            onChange={(value) => {
              setZoneId(value);
              setAreaId('');
              setDestinationHomecellId('');
            }}
            placeholder="All zones"
            options={(zones.data ?? []).map((z) => ({ value: z._id, label: z.name }))}
          />
        </Field>
        <Field label="Destination area">
          <SelectField
            value={areaId}
            onChange={(value) => {
              setAreaId(value);
              setDestinationHomecellId('');
            }}
            placeholder="All areas"
            options={(areas.data ?? []).map((a) => ({ value: a._id, label: a.name }))}
          />
        </Field>
        <Field
          label="Destination homecell"
          required
          className="sm:col-span-2"
          error={
            destinationHomecellId && destinationHomecellId === currentHomecellId
              ? 'The member already belongs to this Homecell.'
              : undefined
          }
        >
          <SelectField
            value={destinationHomecellId}
            onChange={setDestinationHomecellId}
            placeholder="Select the destination Homecell"
            options={(homecells.data ?? [])
              .filter((h) => h._id !== currentHomecellId)
              .map((h) => ({ value: h._id, label: `${h.name} (${h.code})` }))}
          />
        </Field>
        <Field
          label="Reason for transfer"
          htmlFor="transfer-reason"
          required
          className="sm:col-span-2"
          hint="Recorded permanently in the transfer history and audit trail."
        >
          <Textarea
            id="transfer-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="For example: relocated closer to the destination Homecell"
          />
        </Field>
      </FormSection>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={() => router.push('/transfers')}>
          Cancel
        </Button>
        <Button
          onClick={() => mutation.mutate()}
          loading={mutation.isPending}
          disabled={!canSubmit}
        >
          <Send className="h-4 w-4" />
          Submit transfer request
        </Button>
      </div>
    </>
  );
}
