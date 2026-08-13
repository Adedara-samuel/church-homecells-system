'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarClock, Plus, RotateCcw, Power } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMinor, toDateInput } from '@/lib/utils';
import { duesService, zonesService } from '@/services';
import { queryKeys, useApiMutation } from '@/hooks/use-api';
import type { DuesDefinition } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge, Input, Textarea } from '@/components/ui/primitives';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import { PageHeader } from '@/components/common/page';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { ConfirmButton, FilterSelect } from '@/components/common/filters';
import { Field, MoneyInput, SelectField } from '@/components/common/form';

/**
 * Zone dues and levies.
 *
 * A Zone charges its Homecells a standing monthly due plus any number of named levies.
 * A levy closes itself once its due date passes; re-opening it for the following year
 * needs a new due date, which is why that action asks for one rather than just flipping
 * a switch.
 */
export default function DuesSettingsPage() {
  const { can, user } = useAuth();
  const [zoneId, setZoneId] = React.useState<string | undefined>(user?.zone ?? undefined);
  const [editing, setEditing] = React.useState<DuesDefinition | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [reopening, setReopening] = React.useState<DuesDefinition | null>(null);

  const zones = useQuery({
    queryKey: [...queryKeys.zones, 'options'],
    queryFn: zonesService.options,
  });

  const definitions = useQuery({
    queryKey: [...queryKeys.dues, 'definitions', zoneId ?? 'all'],
    queryFn: () => duesService.definitions(zoneId),
  });

  const setStatus = useApiMutation(
    ({ id, status }: { id: string; status: 'ACTIVE' | 'INACTIVE' }) =>
      duesService.setDefinitionStatus(id, status),
    {
      successMessage: 'Charge updated',
      invalidates: [queryKeys.dues],
    },
  );

  const columns: Column<DuesDefinition>[] = [
    {
      key: 'name',
      header: 'Charge',
      render: (definition) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{definition.name}</span>
            {definition.isPrimaryMonthlyDue && <Badge variant="default">Monthly due</Badge>}
            {definition.frequency === 'ONE_OFF' && <Badge variant="secondary">Levy</Badge>}
          </div>
          {definition.description && (
            <p className="text-xs text-muted-foreground">{definition.description}</p>
          )}
        </div>
      ),
    },
    {
      key: 'amountMinor',
      header: 'Amount',
      align: 'right',
      render: (definition) => (
        <span className="font-medium tabular-nums">
          {formatMinor(definition.amountMinor, definition.currency)}
          {definition.frequency === 'MONTHLY' && (
            <span className="text-xs text-muted-foreground"> /month</span>
          )}
        </span>
      ),
    },
    {
      key: 'dueDate',
      header: 'Due',
      render: (definition) =>
        definition.frequency === 'ONE_OFF' ? (
          formatDate(definition.dueDate)
        ) : (
          <span className="text-muted-foreground">Day {definition.dueDayOfMonth} monthly</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (definition) => (
        <div className="flex items-center gap-2">
          <Badge variant={definition.status === 'ACTIVE' ? 'success' : 'muted'}>
            {definition.status === 'ACTIVE' ? 'Active' : 'Closed'}
          </Badge>
          {definition.autoClosedAt && (
            <span className="text-xs text-muted-foreground">due date passed</span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (definition) => {
        if (!can('dues.configure')) return null;
        return (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(definition)}>
              Edit
            </Button>
            {definition.status === 'ACTIVE' ? (
              <ConfirmButton
                variant="ghost"
                size="sm"
                title={`Close "${definition.name}"?`}
                description="No new invoices will be raised. Charges already outstanding remain payable — closing a levy does not cancel a debt."
                confirmLabel="Close charge"
                onConfirm={() => setStatus.mutateAsync({ id: definition._id, status: 'INACTIVE' })}
              >
                <Power className="h-4 w-4" />
              </ConfirmButton>
            ) : definition.frequency === 'ONE_OFF' ? (
              <Button variant="outline" size="sm" onClick={() => setReopening(definition)}>
                <RotateCcw className="h-4 w-4" />
                Re-open
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStatus.mutate({ id: definition._id, status: 'ACTIVE' })}
              >
                <RotateCcw className="h-4 w-4" />
                Re-open
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Dues & levies"
        description="What this zone charges its homecells. Homecells and area coordinators are notified whenever a charge is introduced or re-opened."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Dues & levies' }]}
        actions={
          can('dues.configure') && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Add charge
            </Button>
          )
        }
      />

      <div className="mb-4 max-w-xs">
        <FilterSelect
          label="Zone"
          placeholder="All zones"
          value={zoneId}
          onChange={setZoneId}
          options={(zones.data ?? []).map((zone) => ({
            value: zone._id,
            label: `${zone.name} (${zone.code})`,
          }))}
        />
      </div>

      {definitions.isLoading ? (
        <TableSkeleton rows={4} columns={5} />
      ) : definitions.isError ? (
        <ErrorState error={definitions.error} onRetry={() => void definitions.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={definitions.data ?? []}
          rowKey={(definition) => definition._id}
          emptyState={
            <EmptyState
              icon={CalendarClock}
              title="No charges configured"
              description="Add a monthly due so homecells begin accruing from the month they were created."
            />
          }
        />
      )}

      <DefinitionDialog
        open={creating || Boolean(editing)}
        definition={editing}
        defaultZoneId={zoneId ?? user?.zone ?? undefined}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />

      <ReopenDialog definition={reopening} onClose={() => setReopening(null)} />
    </>
  );
}

function DefinitionDialog({
  open,
  definition,
  defaultZoneId,
  onClose,
}: {
  open: boolean;
  definition: DuesDefinition | null;
  defaultZoneId?: string;
  onClose: () => void;
}) {
  const [form, setForm] = React.useState({
    zoneId: defaultZoneId ?? '',
    name: '',
    description: '',
    frequency: 'MONTHLY' as 'MONTHLY' | 'ONE_OFF',
    amount: '',
    startDate: toDateInput(),
    dueDate: '',
    dueDayOfMonth: '10',
    isPrimaryMonthlyDue: false,
  });

  const zones = useQuery({
    queryKey: [...queryKeys.zones, 'options'],
    queryFn: zonesService.options,
    enabled: open,
  });

  React.useEffect(() => {
    if (!open) return;
    setForm({
      // `_id` is optional on a populated reference; `id` is always present.
      zoneId: definition ? definition.zone._id ?? definition.zone.id : defaultZoneId ?? '',
      name: definition?.name ?? '',
      description: definition?.description ?? '',
      frequency: definition?.frequency ?? 'MONTHLY',
      amount: definition ? String(definition.amountMinor / 100) : '',
      startDate: definition ? definition.startDate.slice(0, 10) : toDateInput(),
      dueDate: definition?.dueDate ? definition.dueDate.slice(0, 10) : '',
      dueDayOfMonth: String(definition?.dueDayOfMonth ?? 10),
      isPrimaryMonthlyDue: definition?.isPrimaryMonthlyDue ?? false,
    });
  }, [open, definition, defaultZoneId]);

  const mutation = useApiMutation(
    () => {
      const body = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        frequency: form.frequency,
        amount: Number(form.amount),
        startDate: form.startDate,
        dueDate: form.frequency === 'ONE_OFF' ? form.dueDate : undefined,
        dueDayOfMonth: Number(form.dueDayOfMonth),
        isPrimaryMonthlyDue: form.isPrimaryMonthlyDue,
      };
      return definition
        ? duesService.updateDefinition(definition._id, body)
        : duesService.createDefinition({ ...body, zoneId: form.zoneId });
    },
    {
      successMessage: definition ? 'Charge updated' : 'Charge created — homecells notified',
      invalidates: [queryKeys.dues],
      onSuccess: onClose,
    },
  );

  const monthly = form.frequency === 'MONTHLY';
  const canSubmit =
    Boolean(form.zoneId) &&
    form.name.trim().length >= 3 &&
    Number(form.amount) > 0 &&
    (monthly || Boolean(form.dueDate));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{definition ? 'Edit charge' : 'Add a charge'}</DialogTitle>
          <DialogDescription>
            A monthly due accrues from the month each homecell was created. A levy is a
            one-off charge that closes itself once its due date passes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!definition && (
            <Field label="Zone" required>
              <SelectField
                value={form.zoneId}
                onChange={(value) => setForm((f) => ({ ...f, zoneId: value }))}
                placeholder="Select a zone"
                options={(zones.data ?? []).map((zone) => ({
                  value: zone._id,
                  label: `${zone.name} (${zone.code})`,
                }))}
              />
            </Field>
          )}

          <Field label="Name" htmlFor="dues-name" required>
            <Input
              id="dues-name"
              value={form.name}
              placeholder="Monthly Due, Anniversary Levy…"
              onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
            />
          </Field>

          {!definition && (
            <Field label="Type" required>
              <SelectField
                value={form.frequency}
                onChange={(value) =>
                  setForm((f) => ({ ...f, frequency: value as 'MONTHLY' | 'ONE_OFF' }))
                }
                options={[
                  { value: 'MONTHLY', label: 'Monthly — recurring every month' },
                  { value: 'ONE_OFF', label: 'One-off levy — a single due date' },
                ]}
              />
            </Field>
          )}

          <Field label="Amount" htmlFor="dues-amount" required>
            <MoneyInput
              id="dues-amount"
              value={form.amount}
              placeholder="0.00"
              onChange={(event) => setForm((f) => ({ ...f, amount: event.target.value }))}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Charged from"
              htmlFor="dues-start"
              required
              hint="Homecells created later start from their own first month"
            >
              <DatePicker
                id="dues-start"
                value={form.startDate}
                clearable={false}
                onChange={(date) => setForm((f) => ({ ...f, startDate: date ?? f.startDate }))}
              />
            </Field>

            {monthly ? (
              <Field label="Due day of month" htmlFor="dues-day" required>
                <Input
                  id="dues-day"
                  type="number"
                  min={1}
                  max={28}
                  value={form.dueDayOfMonth}
                  onChange={(event) =>
                    setForm((f) => ({ ...f, dueDayOfMonth: event.target.value }))
                  }
                />
              </Field>
            ) : (
              <Field label="Due date" htmlFor="dues-due" required>
                <DatePicker
                  id="dues-due"
                  value={form.dueDate}
                  min={form.startDate}
                  clearable={false}
                  onChange={(date) => setForm((f) => ({ ...f, dueDate: date ?? '' }))}
                />
              </Field>
            )}
          </div>

          <Field label="Description" htmlFor="dues-description">
            <Textarea
              id="dues-description"
              rows={2}
              value={form.description}
              onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
            />
          </Field>

          {monthly && !definition && (
            <label className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={form.isPrimaryMonthlyDue}
                onChange={(event) =>
                  setForm((f) => ({ ...f, isPrimaryMonthlyDue: event.target.checked }))
                }
              />
              <span>
                This is the zone&apos;s standing monthly due
                <span className="block text-xs text-muted-foreground">
                  Only one per zone. Leave unticked for an additional recurring charge.
                </span>
              </span>
            </label>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!canSubmit}
          >
            {definition ? 'Save changes' : 'Create charge'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Re-opening a closed levy needs a new due date, usually the same date next year. */
function ReopenDialog({
  definition,
  onClose,
}: {
  definition: DuesDefinition | null;
  onClose: () => void;
}) {
  const [dueDate, setDueDate] = React.useState('');

  React.useEffect(() => {
    if (!definition?.dueDate) return setDueDate('');
    const previous = new Date(definition.dueDate);
    previous.setFullYear(previous.getFullYear() + 1);
    setDueDate(previous.toISOString().slice(0, 10));
  }, [definition]);

  const mutation = useApiMutation(
    () => duesService.setDefinitionStatus(definition!._id, 'ACTIVE', dueDate),
    {
      successMessage: 'Levy re-opened — homecells and areas notified',
      invalidates: [queryKeys.dues],
      onSuccess: onClose,
    },
  );

  return (
    <Dialog open={Boolean(definition)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Re-open {definition?.name}</DialogTitle>
          <DialogDescription>
            This levy closed when its due date passed. Give it a new due date to charge it
            again — every homecell and area coordinator in the zone is notified.
          </DialogDescription>
        </DialogHeader>

        <Field label="New due date" htmlFor="reopen-due" required>
          <DatePicker
            id="reopen-due"
            value={dueDate}
            min={toDateInput()}
            clearable={false}
            onChange={(date) => setDueDate(date ?? '')}
          />
        </Field>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!dueDate || dueDate <= toDateInput()}
          >
            Re-open levy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
