'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Home, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { formatMoney, formatNumber } from '@/lib/utils';
import { areasService, homecellsService, usersService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { Homecell } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/primitives';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import { PageHeader, StatusBadge } from '@/components/common/page';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { FilterBar, OrgFilters } from '@/components/common/filters';
import { Field, MoneyInput, SelectField } from '@/components/common/form';

export default function HomecellsPage() {
  const router = useRouter();
  const { can } = useAuth();
  const list = useListQuery();
  const [editing, setEditing] = React.useState<Homecell | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.homecells, list.query],
    () => homecellsService.list(list.query),
    { placeholderData: (previous) => previous },
  );

  const columns: Column<Homecell>[] = [
    {
      key: 'name',
      header: 'Homecell',
      sortable: true,
      render: (homecell) => (
        <div>
          <p className="font-medium">{homecell.name}</p>
          <p className="text-xs text-muted-foreground">{homecell.code}</p>
        </div>
      ),
    },
    {
      key: 'area',
      header: 'Area / Zone',
      render: (homecell) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{homecell.area?.name ?? '—'}</p>
          <p className="truncate text-xs text-muted-foreground">{homecell.zone?.name ?? ''}</p>
        </div>
      ),
    },
    {
      key: 'coordinator',
      header: 'Coordinator',
      hideOnMobile: true,
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
      header: 'Meeting location',
      hideOnMobile: true,
      render: (homecell) => (
        <span className="text-sm">{homecell.meetingLocation ?? '—'}</span>
      ),
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
    {
      key: 'actions',
      header: '',
      hideOnMobile: true,
      render: (homecell) =>
        can('homecells.update') ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setEditing(homecell);
              setDialogOpen(true);
            }}
          >
            Edit
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Homecells"
        description="The primary operational unit. Attendance, offerings and expenses are recorded here."
        breadcrumbs={[{ label: 'Church structure' }, { label: 'Homecells' }]}
        actions={
          can('homecells.create') && (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New homecell
            </Button>
          )
        }
      />

      <FilterBar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search homecells by name, code or location…"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <OrgFilters
          zoneId={list.filters.zoneId as string | undefined}
          areaId={list.filters.areaId as string | undefined}
          onChange={(key, value) => list.setFilter(key, value)}
          show={['zone', 'area']}
        />
      </FilterBar>

      {isLoading ? (
        <TableSkeleton rows={6} columns={6} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(homecell) => homecell._id}
          onRowClick={(homecell) => router.push(`/structure/homecells/${homecell._id}`)}
          pagination={data?.pagination}
          onPageChange={list.setPage}
          onLimitChange={list.setLimit}
          sort={list.sort}
          onSortChange={list.setSort}
          emptyState={
            <EmptyState
              icon={Home}
              title="No homecells yet"
              description="Create a Homecell inside an Area to start registering members."
            />
          }
        />
      )}

      <HomecellDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        homecell={editing}
        onSaved={() => setDialogOpen(false)}
      />
    </>
  );
}

function HomecellDialog({
  open,
  onOpenChange,
  homecell,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homecell: Homecell | null;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({
    code: '',
    name: '',
    areaId: '',
    coordinatorId: '',
    assistantCoordinatorId: '',
    meetingLocation: '',
    meetingAddress: '',
    maxPurseThreshold: '',
    status: 'ACTIVE',
  });

  React.useEffect(() => {
    setForm({
      code: homecell?.code ?? '',
      name: homecell?.name ?? '',
      areaId: homecell?.area?._id ?? '',
      coordinatorId: homecell?.coordinator?._id ?? '',
      assistantCoordinatorId: homecell?.assistantCoordinator?._id ?? '',
      meetingLocation: homecell?.meetingLocation ?? '',
      meetingAddress: homecell?.meetingAddress ?? '',
      maxPurseThreshold:
        homecell?.maxPurseThresholdOverride != null
          ? String(homecell.maxPurseThresholdOverride / 100)
          : '',
      status: homecell?.status ?? 'ACTIVE',
    });
  }, [homecell, open]);

  const areas = useQuery({
    queryKey: [...queryKeys.areas, 'options', 'all'],
    queryFn: () => areasService.options(),
    enabled: open,
  });
  const coordinators = useQuery({
    queryKey: [...queryKeys.users, 'assignable', 'HOMECELL_COORDINATOR'],
    queryFn: () => usersService.assignable('HOMECELL_COORDINATOR'),
    enabled: open,
  });

  const mutation = useApiMutation(
    () => {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        areaId: form.areaId,
        coordinatorId: form.coordinatorId || null,
        assistantCoordinatorId: form.assistantCoordinatorId || null,
        meetingLocation: form.meetingLocation.trim() || undefined,
        meetingAddress: form.meetingAddress.trim() || undefined,
        // Blank clears the override and falls back to the church-wide threshold.
        maxPurseThreshold: form.maxPurseThreshold === '' ? null : Number(form.maxPurseThreshold),
        status: form.status,
      };
      return homecell
        ? homecellsService.update(homecell._id, payload)
        : homecellsService.create(payload);
    },
    {
      successMessage: homecell ? 'Homecell updated' : 'Homecell created',
      invalidates: [queryKeys.homecells, queryKeys.areas, queryKeys.dashboard],
      onSuccess: onSaved,
    },
  );

  const coordinatorOptions = (coordinators.data ?? []).map((user) => ({
    value: user._id,
    label: `${user.firstName} ${user.lastName} — ${user.email}`,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{homecell ? `Edit ${homecell.name}` : 'New homecell'}</DialogTitle>
          <DialogDescription>
            A Homecell must belong to an Area; its Zone is derived automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Area" required className="sm:col-span-2">
            <SelectField
              value={form.areaId}
              onChange={(value) => setForm((f) => ({ ...f, areaId: value }))}
              placeholder="Select an Area"
              options={(areas.data ?? []).map((area) => ({
                value: area._id,
                label: `${area.name} (${area.code})`,
              }))}
            />
          </Field>
          <Field label="Homecell code" htmlFor="hc-code" required hint="For example HC-001">
            <Input
              id="hc-code"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="Homecell name" htmlFor="hc-name" required>
            <Input
              id="hc-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <Field label="Meeting location" htmlFor="hc-location">
            <Input
              id="hc-location"
              value={form.meetingLocation}
              onChange={(e) => setForm((f) => ({ ...f, meetingLocation: e.target.value }))}
              placeholder="Oregun"
            />
          </Field>
          <Field label="Meeting address" htmlFor="hc-address">
            <Input
              id="hc-address"
              value={form.meetingAddress}
              onChange={(e) => setForm((f) => ({ ...f, meetingAddress: e.target.value }))}
              placeholder="14 Kudirat Abiola Way"
            />
          </Field>
          <Field label="Coordinator">
            <SelectField
              value={form.coordinatorId}
              onChange={(value) => setForm((f) => ({ ...f, coordinatorId: value }))}
              placeholder="Not assigned"
              options={coordinatorOptions}
            />
          </Field>
          <Field label="Assistant coordinator">
            <SelectField
              value={form.assistantCoordinatorId}
              onChange={(value) => setForm((f) => ({ ...f, assistantCoordinatorId: value }))}
              placeholder="Not assigned"
              options={coordinatorOptions.filter((o) => o.value !== form.coordinatorId)}
            />
          </Field>
          <Field
            label="Maximum purse override"
            className="sm:col-span-2"
            hint="Leave blank to use the church-wide threshold from system settings."
          >
            <MoneyInput
              value={form.maxPurseThreshold}
              onChange={(e) => setForm((f) => ({ ...f, maxPurseThreshold: e.target.value }))}
              placeholder="100000.00"
            />
          </Field>
          {homecell && (
            <Field label="Status">
              <SelectField
                value={form.status}
                onChange={(value) => setForm((f) => ({ ...f, status: value }))}
                options={[
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                ]}
              />
            </Field>
          )}
        </div>

        {homecell?.maxPurseThresholdOverride != null && (
          <p className="text-xs text-muted-foreground">
            Current override: {formatMoney(homecell.maxPurseThresholdOverride / 100)}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.code.trim() || !form.name.trim() || !form.areaId}
          >
            {homecell ? 'Save changes' : 'Create homecell'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
