'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, Download, Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMinor, humanise, mostRecentWeekday } from '@/lib/utils';
import { financeService, homecellsService, reportsService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { Offering } from '@/types';
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
import {
  ConfirmButton,
  DateFilter,
  FilterBar,
  FilterSelect,
  OrgFilters,
} from '@/components/common/filters';
import { Field, MoneyInput, SelectField } from '@/components/common/form';

export default function OfferingsPage() {
  const { can } = useAuth();
  const list = useListQuery();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.finance, 'offerings', list.query],
    () => financeService.offerings(list.query),
    { placeholderData: (previous) => previous },
  );

  const reverse = useApiMutation(
    ({ id, reason }: { id: string; reason: string }) => financeService.reverseOffering(id, reason),
    {
      successMessage: 'Offering reversed',
      invalidates: [queryKeys.finance, queryKeys.dashboard],
    },
  );

  const columns: Column<Offering>[] = [
    {
      key: 'reference',
      header: 'Reference',
      render: (offering) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{offering.reference}</p>
          <p className="truncate text-xs text-muted-foreground">{offering.homecell?.name}</p>
        </div>
      ),
    },
    {
      key: 'date',
      header: 'Sunday',
      sortable: true,
      render: (offering) => <span className="text-sm">{formatDate(offering.date)}</span>,
    },
    {
      key: 'amountMinor',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (offering) => (
        <span className="font-medium">{formatMinor(offering.amountMinor, offering.currency)}</span>
      ),
    },
    {
      key: 'channel',
      header: 'Channel',
      hideOnMobile: true,
      render: (offering) => <span className="text-sm">{humanise(offering.channel)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (offering) => <StatusBadge status={offering.status} />,
    },
    {
      key: 'recordedBy',
      header: 'Recorded by',
      hideOnMobile: true,
      render: (offering) =>
        offering.recordedBy ? (
          <span className="text-sm">
            {offering.recordedBy.firstName} {offering.recordedBy.lastName}
          </span>
        ) : (
          '—'
        ),
    },
    {
      key: 'actions',
      header: '',
      hideOnMobile: true,
      render: (offering) =>
        can('finance.reverse') && offering.status === 'POSTED' ? (
          <ConfirmButton
            variant="ghost"
            size="sm"
            title="Reverse this offering?"
            description="The original record stays in place and a reversing entry is posted to the ledger. This cannot be undone."
            confirmLabel="Reverse offering"
            requireReason
            reasonLabel="Reason for reversal"
            onConfirm={(reason) => reverse.mutateAsync({ id: offering._id, reason })}
          >
            Reverse
          </ConfirmButton>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Offerings"
        description="Offerings collected during Sunday Homecell meetings. Each posts a credit to the Homecell purse."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Offerings' }]}
        actions={
          <>
            {can('reports.export') && (
              <Button
                variant="outline"
                onClick={() =>
                  void reportsService.export('transactions', 'xlsx', {
                    ...list.filters,
                    type: 'OFFERING',
                  } as never)
                }
              >
                <Download className="h-4 w-4" />
                <span className="hidden sm:inline">Export</span>
              </Button>
            )}
            {can('finance.create') && (
              <Button onClick={() => setDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                Record offering
              </Button>
            )}
          </>
        }
      />

      <FilterBar activeFilterCount={list.activeFilterCount} onReset={list.resetFilters}>
        <div className="space-y-4">
          <OrgFilters
            zoneId={list.filters.zoneId as string | undefined}
            areaId={list.filters.areaId as string | undefined}
            homecellId={list.filters.homecellId as string | undefined}
            onChange={(key, value) => list.setFilter(key, value)}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <FilterSelect
              label="Status"
              placeholder="All statuses"
              value={list.filters.status as string | undefined}
              onChange={(value) => list.setFilter('status', value)}
              options={['POSTED', 'REVERSED', 'PENDING'].map((s) => ({ value: s, label: humanise(s) }))}
            />
            <DateFilter
              label="From"
              value={list.filters.from as string | undefined}
              onChange={(value) => list.setFilter('from', value)}
            />
            <DateFilter
              label="To"
              value={list.filters.to as string | undefined}
              onChange={(value) => list.setFilter('to', value)}
            />
          </div>
        </div>
      </FilterBar>

      {isLoading ? (
        <TableSkeleton rows={7} columns={6} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(offering) => offering._id}
          pagination={data?.pagination}
          onPageChange={list.setPage}
          onLimitChange={list.setLimit}
          sort={list.sort}
          onSortChange={list.setSort}
          emptyState={
            <EmptyState
              icon={Banknote}
              title="No offerings recorded yet"
              description="Record the offering collected at a Sunday Homecell meeting to build the purse balance."
              action={
                can('finance.create') && (
                  <Button onClick={() => setDialogOpen(true)}>
                    <Plus className="h-4 w-4" />
                    Record offering
                  </Button>
                )
              }
            />
          }
        />
      )}

      <RecordOfferingDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

function RecordOfferingDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = React.useState({
    homecellId: '',
    amount: '',
    // Offerings are Sunday-only (BR-008), so the field opens on the last Sunday.
    date: mostRecentWeekday(0),
    channel: 'CASH',
    description: '',
  });

  React.useEffect(() => {
    if (open) {
      setForm({
        homecellId: user?.homecell ?? '',
        amount: '',
        date: mostRecentWeekday(0),
        channel: 'CASH',
        description: '',
      });
    }
  }, [open, user?.homecell]);

  const homecells = useQuery({
    queryKey: [...queryKeys.homecells, 'options', 'all'],
    queryFn: () => homecellsService.options({}),
    enabled: open,
  });

  const mutation = useApiMutation(
    () =>
      financeService.recordOffering({
        homecellId: form.homecellId,
        amount: Number(form.amount),
        date: form.date,
        channel: form.channel,
        description: form.description.trim() || undefined,
      }),
    {
      successMessage: 'Offering recorded and posted to the purse',
      invalidates: [queryKeys.finance, queryKeys.dashboard],
      onSuccess: () => onOpenChange(false),
    },
  );

  const selectedDay = form.date ? new Date(`${form.date}T00:00:00`).getDay() : 0;
  const isSunday = selectedDay === 0;
  const canSubmit = Boolean(form.homecellId) && Number(form.amount) > 0 && isSunday;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record offering</DialogTitle>
          <DialogDescription>
            Homecell offerings can only be recorded against a Sunday meeting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Homecell" required>
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

          <Field
            label="Meeting date"
            htmlFor="offering-date"
            required
            error={!isSunday && form.date ? 'Offerings can only be recorded against a Sunday.' : undefined}
          >
            <Input
              id="offering-date"
              type="date"
              value={form.date}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(event) => setForm((f) => ({ ...f, date: event.target.value }))}
              aria-invalid={!isSunday}
            />
          </Field>

          <Field label="Amount" htmlFor="offering-amount" required>
            <MoneyInput
              id="offering-amount"
              value={form.amount}
              onChange={(event) => setForm((f) => ({ ...f, amount: event.target.value }))}
              placeholder="0.00"
              autoFocus
            />
          </Field>

          <Field label="Channel">
            <SelectField
              value={form.channel}
              onChange={(value) => setForm((f) => ({ ...f, channel: value }))}
              options={[
                { value: 'CASH', label: 'Cash' },
                { value: 'BANK_TRANSFER', label: 'Bank transfer' },
              ]}
            />
          </Field>

          <Field label="Description" htmlFor="offering-description">
            <Textarea
              id="offering-description"
              rows={2}
              value={form.description}
              onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
              placeholder="Sunday Homecell offering"
            />
          </Field>

          {Number(form.amount) > 0 && (
            <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p>
                {formatMinor(Math.round(Number(form.amount) * 100))} will be credited to the Homecell
                purse immediately and recorded in the ledger.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!canSubmit}>
            Record offering
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
