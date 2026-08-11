'use client';

import * as React from 'react';
import { Landmark, Plus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { formatNumber } from '@/lib/utils';
import { usersService, zonesService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { Zone } from '@/types';
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
import { FilterBar } from '@/components/common/filters';
import { Field, SelectField } from '@/components/common/form';

export default function ZonesPage() {
  const { can } = useAuth();
  const list = useListQuery();
  const [editing, setEditing] = React.useState<Zone | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.zones, list.query],
    () => zonesService.list(list.query),
    { placeholderData: (previous) => previous },
  );

  const columns: Column<Zone>[] = [
    {
      key: 'name',
      header: 'Zone',
      sortable: true,
      render: (zone) => (
        <div>
          <p className="font-medium">{zone.name}</p>
          <p className="text-xs text-muted-foreground">{zone.code}</p>
        </div>
      ),
    },
    {
      key: 'coordinator',
      header: 'Zonal Coordinator',
      render: (zone) =>
        zone.coordinator ? (
          <div className="min-w-0">
            <p className="truncate text-sm">
              {zone.coordinator.firstName} {zone.coordinator.lastName}
            </p>
            <p className="truncate text-xs text-muted-foreground">{zone.coordinator.email}</p>
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Not assigned</span>
        ),
    },
    {
      key: 'areaCount',
      header: 'Areas',
      align: 'right',
      render: (zone) => formatNumber(zone.areaCount ?? 0),
    },
    {
      key: 'homecellCount',
      header: 'Homecells',
      align: 'right',
      render: (zone) => formatNumber(zone.homecellCount ?? 0),
    },
    {
      key: 'memberCount',
      header: 'Members',
      align: 'right',
      render: (zone) => formatNumber(zone.memberCount ?? 0),
    },
    {
      key: 'status',
      header: 'Status',
      render: (zone) => <StatusBadge status={zone.status} />,
    },
    {
      key: 'actions',
      header: '',
      hideOnMobile: true,
      render: (zone) =>
        can('zones.update') ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              setEditing(zone);
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
        title="Zones"
        description="The top level of the church structure. Each Zone contains one or more Areas."
        breadcrumbs={[{ label: 'Church structure' }, { label: 'Zones' }]}
        actions={
          can('zones.create') && (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New zone
            </Button>
          )
        }
      />

      <FilterBar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search zones by name or code…"
      />

      {isLoading ? (
        <TableSkeleton rows={5} columns={6} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(zone) => zone._id}
          pagination={data?.pagination}
          onPageChange={list.setPage}
          onLimitChange={list.setLimit}
          sort={list.sort}
          onSortChange={list.setSort}
          emptyState={
            <EmptyState
              icon={Landmark}
              title="No zones yet"
              description="Create the first Zone to begin building the church structure."
              action={
                can('zones.create') && (
                  <Button
                    onClick={() => {
                      setEditing(null);
                      setDialogOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    New zone
                  </Button>
                )
              }
            />
          }
        />
      )}

      <ZoneDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        zone={editing}
        onSaved={() => setDialogOpen(false)}
      />
    </>
  );
}

function ZoneDialog({
  open,
  onOpenChange,
  zone,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  zone: Zone | null;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({
    code: '',
    name: '',
    description: '',
    coordinatorId: '',
    status: 'ACTIVE',
  });

  React.useEffect(() => {
    setForm({
      code: zone?.code ?? '',
      name: zone?.name ?? '',
      description: zone?.description ?? '',
      coordinatorId: zone?.coordinator?._id ?? '',
      status: zone?.status ?? 'ACTIVE',
    });
  }, [zone, open]);

  const coordinators = useQuery({
    queryKey: [...queryKeys.users, 'assignable', 'ZONAL_COORDINATOR'],
    queryFn: () => usersService.assignable('ZONAL_COORDINATOR'),
    enabled: open,
  });

  const mutation = useApiMutation(
    () => {
      const payload = {
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        coordinatorId: form.coordinatorId || null,
        status: form.status,
      };
      return zone ? zonesService.update(zone._id, payload) : zonesService.create(payload);
    },
    {
      successMessage: zone ? 'Zone updated' : 'Zone created',
      invalidates: [queryKeys.zones, queryKeys.dashboard],
      onSuccess: onSaved,
    },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{zone ? `Edit ${zone.name}` : 'New zone'}</DialogTitle>
          <DialogDescription>
            A Zone groups several Areas. Deactivating it requires all its Areas to be inactive first.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Zone code" htmlFor="zone-code" required hint="For example ZN-01">
            <Input
              id="zone-code"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              placeholder="ZN-01"
            />
          </Field>
          <Field label="Zone name" htmlFor="zone-name" required>
            <Input
              id="zone-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Ikeja Zone"
            />
          </Field>
          <Field label="Description" htmlFor="zone-description">
            <Textarea
              id="zone-description"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
          <Field label="Zonal Coordinator" hint="Only users holding the Zonal Coordinator role appear here">
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
          {zone && (
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
            disabled={!form.code.trim() || !form.name.trim()}
          >
            {zone ? 'Save changes' : 'Create zone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
