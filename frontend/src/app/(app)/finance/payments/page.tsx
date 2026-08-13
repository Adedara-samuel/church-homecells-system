'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CreditCard, ExternalLink, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMinor, humanise } from '@/lib/utils';
import { homecellsService, paymentsService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { Payment } from '@/types';
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
import { PaymentReceiptButton } from '@/components/common/receipt-button';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { DateFilter, FilterBar, FilterSelect, OrgFilters } from '@/components/common/filters';
import { Field, MoneyInput, SelectField } from '@/components/common/form';

const STATUSES = ['PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'CANCELLED', 'REVERSED', 'REFUNDED'];

export default function PaymentsPage() {
  const router = useRouter();
  const { can } = useAuth();
  const list = useListQuery();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.payments, list.query],
    () => paymentsService.list(list.query),
    { placeholderData: (previous) => previous },
  );

  const verify = useApiMutation((reference: string) => paymentsService.verify(reference), {
    successMessage: 'Payment status refreshed from the provider',
    invalidates: [queryKeys.payments, queryKeys.finance, queryKeys.dashboard],
  });

  const columns: Column<Payment>[] = [
    {
      key: 'reference',
      header: 'Reference',
      render: (payment) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{payment.reference}</p>
          <p className="truncate text-xs text-muted-foreground">{payment.homecell?.name}</p>
        </div>
      ),
    },
    {
      key: 'provider',
      header: 'Provider',
      hideOnMobile: true,
      render: (payment) => <Badge variant="secondary">{payment.provider}</Badge>,
    },
    {
      key: 'direction',
      header: 'Direction',
      hideOnMobile: true,
      render: (payment) => <span className="text-sm">{humanise(payment.direction)}</span>,
    },
    {
      key: 'amountMinor',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (payment) => (
        <span className="font-medium">{formatMinor(payment.amountMinor, payment.currency)}</span>
      ),
    },
    { key: 'status', header: 'Status', render: (payment) => <StatusBadge status={payment.status} /> },
    {
      key: 'reconciliationStatus',
      header: 'Reconciliation',
      hideOnMobile: true,
      render: (payment) => <StatusBadge status={payment.reconciliationStatus} />,
    },
    {
      key: 'createdAt',
      header: 'Created',
      sortable: true,
      hideOnMobile: true,
      render: (payment) => <span className="text-sm">{formatDate(payment.createdAt, true)}</span>,
    },
    {
      key: 'actions',
      header: '',
      hideOnMobile: true,
      render: (payment) => (
        <div className="flex justify-end gap-1">
          {/* Every settled online payment has a receipt. The endpoint resolves to the
              remittance or dues form when the payment is linked to one. */}
          {payment.status === 'SUCCESSFUL' && (
            <PaymentReceiptButton reference={payment.reference} />
          )}
          {payment.authorizationUrl && payment.status === 'PROCESSING' && (
            <Button variant="ghost" size="sm" asChild>
              <a href={payment.authorizationUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          )}
          {!['SUCCESSFUL', 'REVERSED', 'REFUNDED'].includes(payment.status) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => verify.mutate(payment.reference)}
              loading={verify.isPending}
              aria-label="Verify with provider"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Payments"
        description="Online payments handled by the configured provider. Status always comes from the provider, never from the browser."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Payments' }]}
        actions={
          can('payments.initiate') && (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              New payment
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
              label="Direction"
              placeholder="All"
              value={list.filters.direction as string | undefined}
              onChange={(value) => list.setFilter('direction', value)}
              options={[
                { value: 'INBOUND', label: 'Inbound' },
                { value: 'OUTBOUND', label: 'Outbound' },
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
        <TableSkeleton rows={7} columns={7} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(payment) => payment._id}
          onRowClick={(payment) => router.push(`/finance/payments/${payment._id}`)}
          pagination={data?.pagination}
          onPageChange={list.setPage}
          onLimitChange={list.setLimit}
          sort={list.sort}
          onSortChange={list.setSort}
          emptyState={
            <EmptyState
              icon={CreditCard}
              title="No payments yet"
              description="Online payments appear here once a checkout is initiated."
            />
          }
        />
      )}

      <InitiatePaymentDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}

function InitiatePaymentDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = React.useState({
    homecellId: '',
    purpose: 'OFFERING',
    amount: '',
    email: '',
    name: '',
    description: '',
  });

  React.useEffect(() => {
    if (open) {
      setForm({
        homecellId: user?.homecell ?? '',
        purpose: 'OFFERING',
        amount: '',
        email: user?.email ?? '',
        name: '',
        description: '',
      });
    }
  }, [open, user]);

  const homecells = useQuery({
    queryKey: [...queryKeys.homecells, 'options', 'all'],
    queryFn: () => homecellsService.options({}),
    enabled: open,
  });

  const mutation = useApiMutation(
    () =>
      paymentsService.initiate({
        homecellId: form.homecellId,
        purpose: form.purpose,
        amount: Number(form.amount),
        email: form.email.trim(),
        name: form.name.trim() || undefined,
        description: form.description.trim() || undefined,
      }),
    {
      invalidates: [queryKeys.payments],
      onSuccess: (result) => {
        onOpenChange(false);
        if (result.authorizationUrl) {
          // Hand off to the provider's hosted checkout.
          window.open(result.authorizationUrl, '_blank', 'noopener');
          toast.success('Checkout opened in a new tab', {
            description: `Reference ${result.reference}. The purse updates once the provider confirms payment.`,
          });
        } else {
          toast.success(`Payment ${result.reference} created`);
        }
      },
    },
  );

  const canSubmit =
    Boolean(form.homecellId) && Number(form.amount) > 0 && /\S+@\S+\.\S+/.test(form.email);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New online payment</DialogTitle>
          <DialogDescription>
            A checkout session is created with the active provider. The Homecell purse is credited
            only after the provider confirms the payment.
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
          <Field label="Purpose" required>
            <SelectField
              value={form.purpose}
              onChange={(value) => setForm((f) => ({ ...f, purpose: value }))}
              options={[
                { value: 'OFFERING', label: 'Homecell offering' },
                { value: 'OTHER_INCOME', label: 'Other approved income' },
              ]}
            />
          </Field>
          <Field label="Amount" htmlFor="payment-amount" required>
            <MoneyInput
              id="payment-amount"
              value={form.amount}
              onChange={(event) => setForm((f) => ({ ...f, amount: event.target.value }))}
              placeholder="0.00"
            />
          </Field>
          <Field label="Payer email" htmlFor="payment-email" required>
            <Input
              id="payment-email"
              type="email"
              value={form.email}
              onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))}
            />
          </Field>
          <Field label="Payer name" htmlFor="payment-name">
            <Input
              id="payment-name"
              value={form.name}
              onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))}
            />
          </Field>
          <Field label="Description" htmlFor="payment-description">
            <Input
              id="payment-description"
              value={form.description}
              onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
              placeholder="Sunday Homecell offering"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!canSubmit}>
            Create checkout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
