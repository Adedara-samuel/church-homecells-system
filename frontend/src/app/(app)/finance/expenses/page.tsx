'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Plus, Receipt, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMinor, humanise, toDateInput } from '@/lib/utils';
import { financeService, homecellsService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { Expense } from '@/types';
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

const STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'REVERSED'];

export default function ExpensesPage() {
  const { can } = useAuth();
  const list = useListQuery();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.finance, 'expenses', list.query],
    () => financeService.expenses(list.query),
    { placeholderData: (previous) => previous },
  );

  const categories = useQuery({
    queryKey: [...queryKeys.finance, 'categories'],
    queryFn: () => financeService.categories(),
  });

  const invalidations = [queryKeys.finance, queryKeys.dashboard];

  const approve = useApiMutation((id: string) => financeService.approveExpense(id), {
    successMessage: 'Expense approved and deducted from the purse',
    invalidates: invalidations,
  });

  const reject = useApiMutation(
    ({ id, reason }: { id: string; reason: string }) => financeService.rejectExpense(id, reason),
    { successMessage: 'Expense rejected', invalidates: invalidations },
  );

  const reverse = useApiMutation(
    ({ id, reason }: { id: string; reason: string }) => financeService.reverseExpense(id, reason),
    { successMessage: 'Expense reversed', invalidates: invalidations },
  );

  const columns: Column<Expense>[] = [
    {
      key: 'reference',
      header: 'Expense',
      render: (expense) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{expense.description}</p>
          <p className="truncate text-xs text-muted-foreground">
            {expense.reference} · {expense.homecell?.name}
          </p>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      hideOnMobile: true,
      render: (expense) => <span className="text-sm">{expense.category?.name ?? '—'}</span>,
    },
    {
      key: 'date',
      header: 'Date',
      sortable: true,
      render: (expense) => <span className="text-sm">{formatDate(expense.date)}</span>,
    },
    {
      key: 'amountMinor',
      header: 'Amount',
      align: 'right',
      sortable: true,
      render: (expense) => (
        <span className="font-medium">{formatMinor(expense.amountMinor, expense.currency)}</span>
      ),
    },
    { key: 'status', header: 'Status', render: (expense) => <StatusBadge status={expense.status} /> },
    {
      key: 'receipt',
      header: 'Receipt',
      hideOnMobile: true,
      render: (expense) =>
        expense.receiptUrl ? (
          <a
            href={expense.receiptUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            View
          </a>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (expense) => (
        <div className="flex justify-end gap-1">
          {can('finance.approve') && expense.status === 'PENDING_APPROVAL' && (
            <>
              <ConfirmButton
                variant="ghost"
                size="sm"
                title="Reject this expense?"
                description="The submitter is notified and the purse balance is unaffected."
                confirmLabel="Reject"
                requireReason
                onConfirm={(reason) => reject.mutateAsync({ id: expense._id, reason })}
              >
                <X className="h-4 w-4" />
              </ConfirmButton>
              <ConfirmButton
                variant="ghost"
                size="sm"
                title="Approve this expense?"
                description={`${formatMinor(expense.amountMinor, expense.currency)} will be deducted from the Homecell purse immediately.`}
                confirmLabel="Approve expense"
                onConfirm={() => approve.mutateAsync(expense._id)}
              >
                <Check className="h-4 w-4" />
              </ConfirmButton>
            </>
          )}
          {can('finance.reverse') && expense.status === 'APPROVED' && (
            <ConfirmButton
              variant="ghost"
              size="sm"
              title="Reverse this expense?"
              description="A reversing entry is posted to the ledger, returning the amount to the purse."
              confirmLabel="Reverse"
              requireReason
              onConfirm={(reason) => reverse.mutateAsync({ id: expense._id, reason })}
            >
              Reverse
            </ConfirmButton>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Only approved expenses reduce the available purse balance."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Expenses' }]}
        actions={
          can('finance.create') && (
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Record expense
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
              label="Category"
              placeholder="All categories"
              value={list.filters.categoryId as string | undefined}
              onChange={(value) => list.setFilter('categoryId', value)}
              options={(categories.data ?? []).map((c) => ({ value: c._id, label: c.name }))}
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
          rowKey={(expense) => expense._id}
          pagination={data?.pagination}
          onPageChange={list.setPage}
          onLimitChange={list.setLimit}
          sort={list.sort}
          onSortChange={list.setSort}
          emptyState={
            <EmptyState
              icon={Receipt}
              title="No expenses recorded"
              description="Record an approved Homecell expense to see it here."
            />
          }
        />
      )}

      <RecordExpenseDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        categories={categories.data ?? []}
      />
    </>
  );
}

function RecordExpenseDialog({
  open,
  onOpenChange,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: { _id: string; name: string; requiresReceipt: boolean }[];
}) {
  const { user } = useAuth();
  const [form, setForm] = React.useState({
    homecellId: '',
    categoryId: '',
    amount: '',
    date: toDateInput(),
    description: '',
  });
  const [receipt, setReceipt] = React.useState<{ url: string; publicId: string } | null>(null);

  React.useEffect(() => {
    if (open) {
      setForm({
        homecellId: user?.homecell ?? '',
        categoryId: '',
        amount: '',
        date: toDateInput(),
        description: '',
      });
      setReceipt(null);
    }
  }, [open, user?.homecell]);

  const homecells = useQuery({
    queryKey: [...queryKeys.homecells, 'options', 'all'],
    queryFn: () => homecellsService.options({}),
    enabled: open,
  });

  const category = categories.find((c) => c._id === form.categoryId);
  const receiptRequired = Boolean(category?.requiresReceipt);

  const mutation = useApiMutation(
    () =>
      financeService.recordExpense({
        homecellId: form.homecellId,
        categoryId: form.categoryId,
        amount: Number(form.amount),
        date: form.date,
        description: form.description.trim(),
        receiptUrl: receipt?.url,
        receiptPublicId: receipt?.publicId,
      }),
    {
      successMessage: 'Expense submitted',
      invalidates: [queryKeys.finance, queryKeys.dashboard],
      onSuccess: () => onOpenChange(false),
    },
  );

  const canSubmit =
    Boolean(form.homecellId) &&
    Boolean(form.categoryId) &&
    Number(form.amount) > 0 &&
    form.description.trim().length >= 3 &&
    (!receiptRequired || Boolean(receipt));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record expense</DialogTitle>
          <DialogDescription>
            The expense is submitted for approval where the configuration requires it, and only
            reduces the purse once approved.
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
          <Field label="Category" required>
            <SelectField
              value={form.categoryId}
              onChange={(value) => setForm((f) => ({ ...f, categoryId: value }))}
              placeholder="Select a category"
              options={categories.map((c) => ({ value: c._id, label: c.name }))}
            />
          </Field>
          <Field label="Amount" htmlFor="expense-amount" required>
            <MoneyInput
              id="expense-amount"
              value={form.amount}
              onChange={(event) => setForm((f) => ({ ...f, amount: event.target.value }))}
              placeholder="0.00"
            />
          </Field>
          <Field label="Date" htmlFor="expense-date" required>
            <DatePicker
              id="expense-date"
              value={form.date}
              max={toDateInput()}
              clearable={false}
              onChange={(date) => setForm((f) => ({ ...f, date: date ?? '' }))}
            />
          </Field>
          <Field label="Description" htmlFor="expense-description" required>
            <Textarea
              id="expense-description"
              rows={2}
              value={form.description}
              onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
              placeholder="What was the money spent on?"
            />
          </Field>
          <Field
            label="Supporting receipt"
            required={receiptRequired}
            error={
              receiptRequired && !receipt
                ? `A receipt is required for ${category?.name} expenses.`
                : undefined
            }
          >
            <FileUploadField
              value={receipt}
              onChange={setReceipt}
              folder="receipts"
              label="Upload receipt"
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!canSubmit}>
            Submit expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
