'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Check, ClipboardList, Plus, Send, ShieldCheck, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMinor, humanise, toDateInput } from '@/lib/utils';
import { financeService, homecellsService, remittancesService, settingsService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { Remittance } from '@/types';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/primitives';
import { DatePicker } from '@/components/ui/date-picker';
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
import { Field, FileUploadField, MoneyInput, SelectField } from '@/components/common/form';

const STATUSES = [
  'PENDING_APPROVAL',
  'APPROVED',
  'PROCESSING',
  'SUCCESSFUL',
  'FAILED',
  'CANCELLED',
  'REVERSED',
];

export default function RemittancesPage() {
  const { can } = useAuth();
  const searchParams = useSearchParams();
  const list = useListQuery();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [disbursing, setDisbursing] = React.useState<Remittance | null>(null);

  // A dashboard threshold warning links straight here with the Homecell preselected.
  React.useEffect(() => {
    if (searchParams.get('homecellId')) setDialogOpen(true);
  }, [searchParams]);

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.remittances, list.query],
    () => remittancesService.list(list.query),
    { placeholderData: (previous) => previous },
  );

  const invalidations = [queryKeys.remittances, queryKeys.finance, queryKeys.dashboard];

  const approve = useApiMutation((id: string) => remittancesService.approve(id), {
    successMessage: 'Remittance approved',
    invalidates: invalidations,
  });

  const verify = useApiMutation((id: string) => remittancesService.verify(id), {
    successMessage: 'Remittance verified and deducted from the purse',
    invalidates: invalidations,
  });

  const reject = useApiMutation(
    ({ id, reason }: { id: string; reason: string }) => remittancesService.reject(id, reason),
    { successMessage: 'Remittance rejected', invalidates: invalidations },
  );

  const columns: Column<Remittance>[] = [
    {
      key: 'reference',
      header: 'Reference',
      render: (remittance) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{remittance.reference}</p>
          <p className="truncate text-xs text-muted-foreground">{remittance.homecell?.name}</p>
        </div>
      ),
    },
    {
      key: 'date',
      header: 'Date',
      sortable: true,
      render: (remittance) => <span className="text-sm">{formatDate(remittance.date)}</span>,
    },
    {
      key: 'amountMinor',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (remittance) => (
        <span className="font-medium">
          {formatMinor(remittance.amountMinor, remittance.currency)}
        </span>
      ),
    },
    {
      key: 'channel',
      header: 'Channel',
      hideOnMobile: true,
      render: (remittance) => <span className="text-sm">{humanise(remittance.channel)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (remittance) => <StatusBadge status={remittance.status} />,
    },
    {
      key: 'receipt',
      header: 'Proof',
      hideOnMobile: true,
      render: (remittance) =>
        remittance.receiptUrl ? (
          <a
            href={remittance.receiptUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary hover:underline"
          >
            View
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">None</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (remittance) => (
        <div className="flex flex-wrap justify-end gap-1">
          {can('remittances.approve') && remittance.status === 'PENDING_APPROVAL' && (
            <>
              <ConfirmButton
                variant="ghost"
                size="sm"
                title="Reject this remittance?"
                description="The purse balance is unaffected and the coordinator is notified."
                confirmLabel="Reject"
                requireReason
                onConfirm={(reason) => reject.mutateAsync({ id: remittance._id, reason })}
              >
                <X className="h-4 w-4" />
              </ConfirmButton>
              <ConfirmButton
                variant="ghost"
                size="sm"
                title="Approve this remittance?"
                description="Approving allows it to be verified or disbursed. The purse is not debited yet."
                confirmLabel="Approve"
                onConfirm={() => approve.mutateAsync(remittance._id)}
              >
                <Check className="h-4 w-4" />
              </ConfirmButton>
            </>
          )}

          {can('remittances.verify') &&
            remittance.status === 'APPROVED' &&
            remittance.channel === 'MANUAL' && (
              <ConfirmButton
                variant="outline"
                size="sm"
                title="Verify this remittance?"
                description={`Confirms the proof of payment. ${formatMinor(
                  remittance.amountMinor,
                  remittance.currency,
                )} will be deducted from the Homecell purse.`}
                confirmLabel="Verify and post"
                onConfirm={() => verify.mutateAsync(remittance._id)}
              >
                <ShieldCheck className="h-4 w-4" />
                Verify
              </ConfirmButton>
            )}

          {can('payments.disburse') && remittance.status === 'APPROVED' && (
            <Button variant="outline" size="sm" onClick={() => setDisbursing(remittance)}>
              <Send className="h-4 w-4" />
              Disburse
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Remittances"
        description="Transfers from a Homecell purse to the General Homecell Purse. The purse is debited only once the remittance completes."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Remittances' }]}
        actions={
          can('remittances.create') && (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Record remittance
            </Button>
          )
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect
              label="Status"
              placeholder="All statuses"
              value={list.filters.status as string | undefined}
              onChange={(value) => list.setFilter('status', value)}
              options={STATUSES.map((s) => ({ value: s, label: humanise(s) }))}
            />
            <FilterSelect
              label="Channel"
              placeholder="All channels"
              value={list.filters.channel as string | undefined}
              onChange={(value) => list.setFilter('channel', value)}
              options={[
                { value: 'MANUAL', label: 'Manual' },
                { value: 'PROVIDER_TRANSFER', label: 'Provider transfer' },
              ]}
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
          rowKey={(remittance) => remittance._id}
          pagination={data?.pagination}
          onPageChange={list.setPage}
          onLimitChange={list.setLimit}
          sort={list.sort}
          onSortChange={list.setSort}
          emptyState={
            <EmptyState
              icon={ClipboardList}
              title="No remittances yet"
              description="Record a remittance when a Homecell purse reaches its maximum threshold."
            />
          }
        />
      )}

      <RecordRemittanceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        presetHomecellId={searchParams.get('homecellId') ?? undefined}
      />
      <DisburseDialog remittance={disbursing} onClose={() => setDisbursing(null)} />
    </>
  );
}

function RecordRemittanceDialog({
  open,
  onOpenChange,
  presetHomecellId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presetHomecellId?: string;
}) {
  const { user } = useAuth();
  const [form, setForm] = React.useState({
    homecellId: '',
    amount: '',
    date: toDateInput(),
    paymentReference: '',
    description: '',
  });
  const [receipt, setReceipt] = React.useState<{ url: string; publicId: string } | null>(null);

  const settings = useQuery({
    queryKey: [...queryKeys.settings],
    queryFn: settingsService.get,
    enabled: open,
  });

  const homecells = useQuery({
    queryKey: [...queryKeys.homecells, 'options', 'all'],
    queryFn: () => homecellsService.options({}),
    enabled: open,
  });

  const homecellId = form.homecellId || presetHomecellId || user?.homecell || '';

  const purse = useQuery({
    queryKey: [...queryKeys.finance, 'purse', homecellId],
    queryFn: () => financeService.purse(homecellId),
    enabled: open && Boolean(homecellId),
  });

  React.useEffect(() => {
    if (open) {
      setForm({
        homecellId: presetHomecellId ?? user?.homecell ?? '',
        amount: '',
        date: toDateInput(),
        paymentReference: '',
        description: '',
      });
      setReceipt(null);
    }
  }, [open, presetHomecellId, user?.homecell]);

  const mutation = useApiMutation(
    () =>
      remittancesService.create({
        homecellId,
        amount: Number(form.amount),
        date: form.date,
        channel: 'MANUAL',
        paymentReference: form.paymentReference.trim() || undefined,
        description: form.description.trim() || undefined,
        receiptUrl: receipt?.url,
        receiptPublicId: receipt?.publicId,
      }),
    {
      successMessage: 'Remittance recorded',
      invalidates: [queryKeys.remittances, queryKeys.finance, queryKeys.dashboard],
      onSuccess: () => onOpenChange(false),
    },
  );

  const receiptRequired = settings.data?.remittanceRequiresReceipt ?? true;
  const amountMinor = Math.round(Number(form.amount || 0) * 100);
  const exceedsBalance = purse.data ? amountMinor > purse.data.balance.availableMinor : false;

  const canSubmit =
    Boolean(homecellId) &&
    Number(form.amount) > 0 &&
    !exceedsBalance &&
    (!receiptRequired || Boolean(receipt));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record remittance</DialogTitle>
          <DialogDescription>
            Remitting to {settings.data?.generalPurseAccountName ?? 'the General Homecell Purse'}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Homecell" required>
            <SelectField
              value={homecellId}
              onChange={(value) => setForm((f) => ({ ...f, homecellId: value }))}
              placeholder="Select a Homecell"
              options={(homecells.data ?? []).map((h) => ({
                value: h._id,
                label: `${h.name} (${h.code})`,
              }))}
            />
          </Field>

          {purse.data && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Available balance</span>
                <span className="tabular font-medium">
                  {formatMinor(purse.data.balance.availableMinor, purse.data.currency)}
                </span>
              </div>
              {purse.data.requiresRemittance && (
                <div className="mt-1 flex justify-between text-warning">
                  <span>Suggested remittance</span>
                  <span className="tabular font-medium">
                    {formatMinor(purse.data.suggestedRemittanceMinor, purse.data.currency)}
                  </span>
                </div>
              )}
            </div>
          )}

          <Field
            label="Amount"
            htmlFor="remittance-amount"
            required
            error={exceedsBalance ? 'The amount exceeds the available purse balance.' : undefined}
          >
            <MoneyInput
              id="remittance-amount"
              value={form.amount}
              onChange={(event) => setForm((f) => ({ ...f, amount: event.target.value }))}
              placeholder="0.00"
              aria-invalid={exceedsBalance}
            />
          </Field>

          <Field label="Remittance date" htmlFor="remittance-date" required>
            <DatePicker
              id="remittance-date"
              value={form.date}
              max={toDateInput()}
              clearable={false}
              onChange={(date) => setForm((f) => ({ ...f, date: date ?? '' }))}
            />
          </Field>

          <Field
            label="Payment / transfer reference"
            htmlFor="remittance-payment-ref"
            hint="The bank reference from the transfer"
          >
            <Input
              id="remittance-payment-ref"
              value={form.paymentReference}
              onChange={(event) => setForm((f) => ({ ...f, paymentReference: event.target.value }))}
            />
          </Field>

          <Field label="Description" htmlFor="remittance-description">
            <Textarea
              id="remittance-description"
              rows={2}
              value={form.description}
              onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
            />
          </Field>

          <Field
            label="Proof of payment"
            required={receiptRequired}
            error={receiptRequired && !receipt ? 'Proof of payment is required.' : undefined}
          >
            <FileUploadField
              value={receipt}
              onChange={setReceipt}
              folder="receipts"
              label="Upload proof of payment"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!canSubmit}>
            Record remittance
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Provider payout.
 *
 * The remittance moves to PROCESSING; the purse is only debited when the provider's
 * webhook confirms the transfer, so nothing is deducted on the strength of a click.
 */
function DisburseDialog({
  remittance,
  onClose,
}: {
  remittance: Remittance | null;
  onClose: () => void;
}) {
  const [form, setForm] = React.useState({ accountNumber: '', bankCode: '', accountName: '' });

  React.useEffect(() => {
    setForm({ accountNumber: '', bankCode: '', accountName: '' });
  }, [remittance]);

  const mutation = useApiMutation(
    () => remittancesService.disburse(remittance!._id, form),
    {
      successMessage: 'Payout submitted — awaiting confirmation from the payment provider',
      invalidates: [queryKeys.remittances, queryKeys.payments, queryKeys.finance],
      onSuccess: onClose,
    },
  );

  const canSubmit =
    /^\d{10}$/.test(form.accountNumber) &&
    form.bankCode.trim().length >= 3 &&
    form.accountName.trim().length >= 3;

  return (
    <Dialog open={Boolean(remittance)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disburse remittance</DialogTitle>
          <DialogDescription>
            {remittance
              ? `${formatMinor(remittance.amountMinor, remittance.currency)} will be sent through the active payment provider.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Account number" htmlFor="disburse-account" required>
            <Input
              id="disburse-account"
              inputMode="numeric"
              maxLength={10}
              value={form.accountNumber}
              onChange={(event) =>
                setForm((f) => ({ ...f, accountNumber: event.target.value.replace(/\D/g, '') }))
              }
              placeholder="0123456789"
            />
          </Field>
          <Field label="Bank code" htmlFor="disburse-bank" required hint="The provider's numeric bank code">
            <Input
              id="disburse-bank"
              value={form.bankCode}
              onChange={(event) => setForm((f) => ({ ...f, bankCode: event.target.value }))}
              placeholder="057"
            />
          </Field>
          <Field label="Account name" htmlFor="disburse-name" required>
            <Input
              id="disburse-name"
              value={form.accountName}
              onChange={(event) => setForm((f) => ({ ...f, accountName: event.target.value }))}
            />
          </Field>

          <p className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
            The payout is submitted to the provider and marked as processing. The Homecell purse is
            debited only when the provider confirms the transfer succeeded.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!canSubmit}>
            <Send className="h-4 w-4" />
            Submit payout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
