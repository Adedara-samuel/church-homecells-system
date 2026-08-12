'use client';

import * as React from 'react';
import { Plus, Tags } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatMinor } from '@/lib/utils';
import { financeService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery } from '@/hooks/use-api';
import type { ExpenseCategory } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge, Input, Switch, Textarea } from '@/components/ui/primitives';
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
import { Field, MoneyInput } from '@/components/common/form';

/**
 * Expense category configuration (SRS 7.4).
 *
 * Categories are never deleted — an existing expense references one permanently — so
 * retiring a category deactivates it, keeping historical records intact while removing
 * it from the list coordinators can choose from.
 */
export default function ExpenseCategoriesPage() {
  const { can } = useAuth();
  const [editing, setEditing] = React.useState<ExpenseCategory | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.finance, 'categories', 'all'],
    () => financeService.categories(true),
  );

  const canManage = can('settings.update');

  const columns: Column<ExpenseCategory>[] = [
    {
      key: 'name',
      header: 'Category',
      render: (category) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{category.name}</p>
          <p className="truncate text-xs text-muted-foreground">{category.code}</p>
        </div>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      hideOnMobile: true,
      render: (category) => (
        <span className="text-sm text-muted-foreground">{category.description ?? '—'}</span>
      ),
    },
    {
      key: 'approvalThresholdMinor',
      header: 'Approval threshold',
      align: 'right',
      render: (category) =>
        category.approvalThresholdMinor > 0 ? (
          <span className="text-sm">{formatMinor(category.approvalThresholdMinor)}</span>
        ) : (
          <Badge variant="warning">Always</Badge>
        ),
    },
    {
      key: 'requiresReceipt',
      header: 'Receipt',
      render: (category) =>
        category.requiresReceipt ? (
          <Badge variant="default">Required</Badge>
        ) : (
          <span className="text-sm text-muted-foreground">Optional</span>
        ),
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (category) =>
        category.isActive ? (
          <Badge variant="success">Active</Badge>
        ) : (
          <Badge variant="muted">Retired</Badge>
        ),
    },
    {
      key: 'actions',
      header: '',
      render: (category) =>
        canManage ? (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditing(category);
                setDialogOpen(true);
              }}
            >
              Edit
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Expense categories"
        description="The categories a coordinator can choose when recording an expense, and the approval and receipt rules that apply to each."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Expense categories' }]}
        actions={
          canManage && (
            <Button
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              New category
            </Button>
          )
        }
      />

      {isLoading ? (
        <TableSkeleton rows={6} columns={6} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={data ?? []}
          rowKey={(category) => category._id}
          emptyState={
            <EmptyState
              icon={Tags}
              title="No expense categories yet"
              description="Create categories such as Welfare or Meeting Materials so coordinators can classify their expenses."
              action={
                canManage && (
                  <Button
                    onClick={() => {
                      setEditing(null);
                      setDialogOpen(true);
                    }}
                  >
                    <Plus className="h-4 w-4" />
                    New category
                  </Button>
                )
              }
            />
          }
        />
      )}

      <CategoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        category={editing}
        onSaved={() => setDialogOpen(false)}
      />
    </>
  );
}

function CategoryDialog({
  open,
  onOpenChange,
  category,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: ExpenseCategory | null;
  onSaved: () => void;
}) {
  const [form, setForm] = React.useState({
    code: '',
    name: '',
    description: '',
    approvalThreshold: '0',
    requiresReceipt: false,
    isActive: true,
  });

  React.useEffect(() => {
    setForm({
      code: category?.code ?? '',
      name: category?.name ?? '',
      description: category?.description ?? '',
      approvalThreshold: category ? String(category.approvalThresholdMinor / 100) : '0',
      requiresReceipt: category?.requiresReceipt ?? false,
      isActive: category?.isActive ?? true,
    });
  }, [category, open]);

  const mutation = useApiMutation(
    () =>
      financeService.upsertCategory({
        id: category?._id,
        code: form.code.trim().toUpperCase(),
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        approvalThreshold: Number(form.approvalThreshold || 0),
        requiresReceipt: form.requiresReceipt,
        isActive: form.isActive,
      }),
    {
      successMessage: category ? 'Category updated' : 'Category created',
      invalidates: [queryKeys.finance],
      onSuccess: onSaved,
    },
  );

  const canSubmit = form.code.trim().length >= 2 && form.name.trim().length >= 2;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{category ? `Edit ${category.name}` : 'New expense category'}</DialogTitle>
          <DialogDescription>
            The threshold and receipt rules here are enforced by the API when an expense is
            submitted, not just in the form.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field
            label="Category code"
            htmlFor="category-code"
            required
            hint="A stable identifier, for example WELFARE"
          >
            <Input
              id="category-code"
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              disabled={Boolean(category)}
              placeholder="WELFARE"
            />
          </Field>

          <Field label="Display name" htmlFor="category-name" required>
            <Input
              id="category-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Welfare"
            />
          </Field>

          <Field label="Description" htmlFor="category-description">
            <Textarea
              id="category-description"
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Support extended to members in need."
            />
          </Field>

          <Field
            label="Approval threshold"
            hint="Expenses at or above this amount always need approval. Zero means every expense in this category does."
          >
            <MoneyInput
              value={form.approvalThreshold}
              onChange={(e) => setForm((f) => ({ ...f, approvalThreshold: e.target.value }))}
            />
          </Field>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Receipt required</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                An expense in this category cannot be submitted without a supporting document.
              </p>
            </div>
            <Switch
              checked={form.requiresReceipt}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, requiresReceipt: checked }))}
              aria-label="Receipt required"
            />
          </div>

          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Available to coordinators</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Turn off to retire the category. Existing expenses keep it; new ones cannot use it.
              </p>
            </div>
            <Switch
              checked={form.isActive}
              onCheckedChange={(checked) => setForm((f) => ({ ...f, isActive: checked }))}
              aria-label="Available to coordinators"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!canSubmit}>
            {category ? 'Save changes' : 'Create category'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
