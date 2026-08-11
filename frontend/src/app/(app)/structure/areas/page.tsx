'use client';

import * as React from 'react';
import { Building2, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { formatNumber } from '@/lib/utils';
import { areasService, usersService, zonesService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { Area } from '@/types';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/primitives';
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
import { Field, SelectField } from '@/components/common/form';

export default function AreasPage() {
  const { can } = useAuth();
  const list = useListQuery();
  const [editing, setEditing] = React.useState<Area | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.areas, list.query],
    () => areasService.list(list.query),
    { placeholderData: (previous) => previous },
  );

  const columns: Column<Area>[] = [
    {
      key: 'name',
      header: 'Area',
      sortable: true,
      render: (area) => (
        <div>
          <p className="font-medium">{area.name}</p>
          <p className="text-xs text-muted-foreground">{area.code}</p>
        </div>
      ),
    },
    {
      key: 'zone',
      header: 'Zone',
      render: (area) => <span className="text-sm">{area.zone?.name ?? '—'}</span>,
    },
    {
      key: 'coordinator',
      header: 'Area Coordinator',
      hideOnMobile: true,
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
    {
      key: 'actions',
      header: '',
      hideOnMobile: true,
      render: (area) =>
        can('areas.update') ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setEditing(area);
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
        title="Areas"
        description="Each Area belongs to a Zone and groups several Homecells."
        breadcrumbs={[{ label: 'Church structure' }, { label: 'Areas' }]}
        actions={
          can('areas.create') && (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New area
            </Button>
          )
        }
      />

      <FilterBar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search areas by name or code…"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <OrgFilters
          zoneId={list.filters.zoneId as string | undefined}
          onChange={(key, value) => list.setFilter(key, value)}
          show={['zone']}
        />
      </FilterBar>

      {isLoading ? (
        <TableSkeleton rows={5} columns={6} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(area) => area._id}
          pagination={data?.pagination}
          onPageChange={list.setPage}
          onLimitChange={list.setLimit}
          sort={list.sort}
          onSortChange={list.setSort}
          emptyState={
            <EmptyState
              icon={Building2}
              title="No areas yet"
              description="Create an Area inside a Zone before adding Homecells."
            />
          }
        />
      )}

      <AreaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        area={editing}
        onSaved={() => setDialogOpen(false)}
      />
    </>
  );
}

function AreaDialog({
  open,
  onOpenChange,
  area,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  area: Area | null;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({
    code: '',
    name: '',
    description: '',
    zoneId: '',
    coordinatorId: '',
    status: 'ACTIVE',
  });

  React.useEffect(() => {
    setForm({
      code: area?.code ?? '',
      name: area?.name ?? '',
      description: area?.description ?? '',
      zoneId: area?.zone?._id ?? '',
      coordinatorId: area?.coordinator?._id ?? '',
      status: area?.status ?? 'ACTIVE',
    });
  }, [area, open]);

  const zones = useQuery({
    queryKey: [...queryKeys.zones, 'options'],
    queryFn: zonesService.options,
    enabled: open,
  });
  const coordinators = useQuery({
    queryKey: [...queryKeys.users, 'assignable', 'AREA_COORDINATOR'],
    queryFn: () => usersService.assignable('AREA_COORDINATOR'),
    enabled: open,
  });

  const mutation = useApiMutation(
    () => {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        zoneId: form.zoneId,
        coordinatorId: form.coordinatorId || null,
        status: form.status,
      };
      return area ? areasService.update(area._id, payload) : areasService.create(payload);
    },
    {
      successMessage: area ? 'Area updated' : 'Area created',
      invalidates: [queryKeys.areas, queryKeys.zones, queryKeys.dashboard],
      onSuccess: onSaved,
    },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{area ? `Edit ${area.name}` : 'New area'}</DialogTitle>
          <DialogDescription>
            An Area must belong to a Zone. Moving it to another Zone also moves every Homecell and
            member beneath it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Zone" required>
            <SelectField
              value={form.zoneId}
              onChange={(value) => setForm((f) => ({ ...f, zoneId: value }))}
              placeholder="Select a Zone"
              options={(zones.data ?? []).map((zone) => ({
                value: zone._id,
                label: `${zone.name} (${zone.code})`,
              }))}
            />
          </Field>
          <Field label="Area code" htmlFor="area-code" required hint="For example AR-01">
            <Input
              id="area-code"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
            />
          </Field>
          <Field label="Area name" htmlFor="area-name" required>
            <Input
              id="area-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </Field>
          <Field label="Description" htmlFor="area-description">
            <Textarea
              id="area-description"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <Field label="Area Coordinator">
            <SelectField
              value={form.coordinatorId}
              onChange={(value) => setForm((f) => ({ ...f, coordinatorId: value }))}
              placeholder="Not assigned"
              options={(coordinators.data ?? []).map((user) => ({
                value: user._id,
                label: `${user.firstName} ${user.lastName} — ${user.email}`,
              }))}
            />
          </Field>
          {area && (
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!form.code.trim() || !form.name.trim() || !form.zoneId}
          >
            {area ? 'Save changes' : 'Create area'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
