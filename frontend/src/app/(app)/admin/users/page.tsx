'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Plus, ShieldBan, ShieldCheck, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { formatDate, humanise } from '@/lib/utils';
import { areasService, homecellsService, usersService, zonesService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { AppUser, Role } from '@/types';
import { ROLE_LABELS } from '@/components/layout/navigation';
import { Button } from '@/components/ui/button';
import { Badge, Input } from '@/components/ui/primitives';
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
import { ConfirmButton, FilterBar, FilterSelect } from '@/components/common/filters';
import { Field, SelectField } from '@/components/common/form';

const ROLES: Role[] = [
  'SYSTEM_ADMIN',
  'CHURCH_ADMIN',
  'ZONAL_COORDINATOR',
  'AREA_COORDINATOR',
  'HOMECELL_COORDINATOR',
];

export default function UsersPage() {
  const { can, user: currentUser } = useAuth();
  const list = useListQuery();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AppUser | null>(null);

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.users, list.query],
    () => usersService.list(list.query),
    { placeholderData: (previous) => previous },
  );

  const setStatus = useApiMutation(
    ({ id, status, reason }: { id: string; status: string; reason: string }) =>
      usersService.setStatus(id, status, reason || undefined),
    { successMessage: 'Account status updated', invalidates: [queryKeys.users] },
  );

  const columns: Column<AppUser>[] = [
    {
      key: 'name',
      header: 'User',
      render: (user) => (
        <div className="min-w-0">
          <p className="truncate font-medium">
            {user.firstName} {user.lastName}
          </p>
          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (user) => <Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>,
    },
    {
      key: 'scope',
      header: 'Assignment',
      hideOnMobile: true,
      render: (user) => (
        <span className="text-sm">
          {user.homecell?.name ?? user.area?.name ?? user.zone?.name ?? 'Church-wide'}
        </span>
      ),
    },
    {
      key: 'lastLoginAt',
      header: 'Last sign-in',
      sortable: true,
      hideOnMobile: true,
      render: (user) => (
        <span className="text-sm">
          {user.lastLoginAt ? formatDate(user.lastLoginAt, true) : 'Never'}
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (user) => <StatusBadge status={user.status} /> },
    {
      key: 'actions',
      header: '',
      render: (user) => {
        const isSelf = user._id === currentUser?.id;
        return (
          <div className="flex justify-end gap-1">
            {can('users.update') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditing(user);
                  setDialogOpen(true);
                }}
              >
                Edit
              </Button>
            )}
            {can('users.update') && !isSelf && (
              <ConfirmButton
                variant="ghost"
                size="sm"
                title={user.status === 'ACTIVE' ? 'Deactivate this account?' : 'Reactivate this account?'}
                description={
                  user.status === 'ACTIVE'
                    ? 'The user is signed out of every device immediately and cannot sign in again until reactivated.'
                    : 'The user will be able to sign in again with their existing password.'
                }
                confirmLabel={user.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                requireReason={user.status === 'ACTIVE'}
                reasonLabel="Reason for deactivation"
                onConfirm={(reason) =>
                  setStatus.mutateAsync({
                    id: user._id,
                    status: user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                    reason,
                  })
                }
              >
                {user.status === 'ACTIVE' ? (
                  <ShieldBan className="h-4 w-4" />
                ) : (
                  <ShieldCheck className="h-4 w-4" />
                )}
              </ConfirmButton>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description="System accounts and their organisational assignment. A role without an assignment cannot see anything."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Users' }]}
        actions={
          can('users.create') && (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New user
            </Button>
          )
        }
      />

      <FilterBar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search users by name, email or phone…"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <FilterSelect
            label="Role"
            placeholder="All roles"
            value={list.filters.role as string | undefined}
            onChange={(value) => list.setFilter('role', value)}
            options={ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
          />
          <FilterSelect
            label="Status"
            placeholder="All statuses"
            value={list.filters.status as string | undefined}
            onChange={(value) => list.setFilter('status', value)}
            options={['ACTIVE', 'INACTIVE', 'SUSPENDED'].map((s) => ({
              value: s,
              label: humanise(s),
            }))}
          />
        </div>
      </FilterBar>

      {isLoading ? (
        <TableSkeleton rows={7} columns={5} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(user) => user._id}
          pagination={data?.pagination}
          onPageChange={list.setPage}
          onLimitChange={list.setLimit}
          sort={list.sort}
          onSortChange={list.setSort}
          emptyState={
            <EmptyState
              icon={UserCog}
              title="No users found"
              description="Create accounts for coordinators so they can record attendance and finances."
            />
          }
        />
      )}

      <UserDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        user={editing}
        onSaved={() => setDialogOpen(false)}
      />
    </>
  );
}

function UserDialog({
  open,
  onOpenChange,
  user,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AppUser | null;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    role: 'HOMECELL_COORDINATOR' as Role,
    zoneId: '',
    areaId: '',
    homecellId: '',
  });

  React.useEffect(() => {
    setForm({
      firstName: user?.firstName ?? '',
      lastName: user?.lastName ?? '',
      email: user?.email ?? '',
      phone: user?.phone ?? '',
      role: user?.role ?? 'HOMECELL_COORDINATOR',
      zoneId: user?.zone?._id ?? '',
      areaId: user?.area?._id ?? '',
      homecellId: user?.homecell?._id ?? '',
    });
  }, [user, open]);

  const zones = useQuery({
    queryKey: [...queryKeys.zones, 'options'],
    queryFn: zonesService.options,
    enabled: open,
  });
  const areas = useQuery({
    queryKey: [...queryKeys.areas, 'options', form.zoneId || 'all'],
    queryFn: () => areasService.options(form.zoneId || undefined),
    enabled: open,
  });
  const homecells = useQuery({
    queryKey: [...queryKeys.homecells, 'options', form.zoneId || 'all', form.areaId || 'all'],
    queryFn: () =>
      homecellsService.options({
        zoneId: form.zoneId || undefined,
        areaId: form.areaId || undefined,
      }),
    enabled: open,
  });

  const mutation = useApiMutation(
    async () => {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        role: form.role,
        zoneId: form.zoneId || null,
        areaId: form.areaId || null,
        homecellId: form.homecellId || null,
      };
      if (user) return { user: await usersService.update(user._id, payload) };
      return usersService.create(payload);
    },
    {
      invalidates: [queryKeys.users],
      onSuccess: (result) => {
        const temporary = 'temporaryPassword' in result ? result.temporaryPassword : undefined;
        if (temporary) {
          // Shown once only; the administrator must pass it on securely.
          toast.success('User created', {
            description: `Temporary password: ${temporary} — share it securely; it is not shown again.`,
            duration: 20_000,
          });
        } else {
          toast.success(user ? 'User updated' : 'User created');
        }
        onSaved();
      },
    },
  );

  // Which assignment field applies depends entirely on the chosen role.
  const requiresZone = form.role === 'ZONAL_COORDINATOR';
  const requiresArea = form.role === 'AREA_COORDINATOR';
  const requiresHomecell = form.role === 'HOMECELL_COORDINATOR';
  const isChurchWide = form.role === 'SYSTEM_ADMIN' || form.role === 'CHURCH_ADMIN';

  const canSubmit =
    form.firstName.trim().length >= 2 &&
    form.lastName.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(form.email) &&
    form.phone.trim().length >= 7 &&
    (isChurchWide ||
      (requiresZone && form.zoneId) ||
      (requiresArea && form.areaId) ||
      (requiresHomecell && form.homecellId));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{user ? `Edit ${user.firstName} ${user.lastName}` : 'New user'}</DialogTitle>
          <DialogDescription>
            {user
              ? 'Changing the role or assignment signs the user out of every device.'
              : 'A strong temporary password is generated and shown once after creation.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="user-first" required>
            <Input
              id="user-first"
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            />
          </Field>
          <Field label="Last name" htmlFor="user-last" required>
            <Input
              id="user-last"
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            />
          </Field>
          <Field label="Email address" htmlFor="user-email" required>
            <Input
              id="user-email"
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </Field>
          <Field label="Phone number" htmlFor="user-phone" required>
            <Input
              id="user-phone"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+2348030000000"
            />
          </Field>
          <Field label="Role" required className="sm:col-span-2">
            <SelectField
              value={form.role}
              onChange={(value) =>
                setForm((f) => ({
                  ...f,
                  role: value as Role,
                  zoneId: '',
                  areaId: '',
                  homecellId: '',
                }))
              }
              options={ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
            />
          </Field>

          {isChurchWide ? (
            <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground sm:col-span-2">
              This role has church-wide visibility and needs no organisational assignment.
            </p>
          ) : (
            <>
              <Field label="Zone" required={requiresZone}>
                <SelectField
                  value={form.zoneId}
                  onChange={(value) =>
                    setForm((f) => ({ ...f, zoneId: value, areaId: '', homecellId: '' }))
                  }
                  placeholder="Select a Zone"
                  options={(zones.data ?? []).map((z) => ({ value: z._id, label: z.name }))}
                />
              </Field>
              {(requiresArea || requiresHomecell) && (
                <Field label="Area" required={requiresArea}>
                  <SelectField
                    value={form.areaId}
                    onChange={(value) => setForm((f) => ({ ...f, areaId: value, homecellId: '' }))}
                    placeholder="Select an Area"
                    options={(areas.data ?? []).map((a) => ({ value: a._id, label: a.name }))}
                  />
                </Field>
              )}
              {requiresHomecell && (
                <Field label="Homecell" required className="sm:col-span-2">
                  <SelectField
                    value={form.homecellId}
                    onChange={(value) => setForm((f) => ({ ...f, homecellId: value }))}
                    placeholder="Select a Homecell"
                    options={(homecells.data ?? []).map((h) => ({
                      value: h._id,
                      label: `${h.name} (${h.code})`,
                    }))}
                  />
                </Field>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!canSubmit}>
            <KeyRound className="h-4 w-4" />
            {user ? 'Save changes' : 'Create user'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
