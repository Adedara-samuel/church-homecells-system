'use client';

import { useParams } from 'next/navigation';
import { Check, Undo2, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMinor, humanise } from '@/lib/utils';
import { financeService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery } from '@/hooks/use-api';
import type { Expense } from '@/types';
import { StatusBadge } from '@/components/common/page';
import { DetailSkeleton, ErrorState } from '@/components/common/states';
import { ConfirmButton } from '@/components/common/filters';
import {
  AttachmentPreview,
  Info,
  InfoCard,
  InfoGrid,
  RecordAuditTrail,
  RecordHeader,
  RecordLink,
  Timeline,
  type TimelineStep,
} from '@/components/common/detail';

export default function ExpenseDetailPage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const id = params.id;

  const { data: expense, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.finance, 'expense', id],
    () => financeService.expense(id),
  );

  const invalidates = [queryKeys.finance, queryKeys.dashboard];

  const approve = useApiMutation(() => financeService.approveExpense(id), {
    successMessage: 'Expense approved and deducted from the purse',
    invalidates,
  });
  const reject = useApiMutation((reason: string) => financeService.rejectExpense(id, reason), {
    successMessage: 'Expense rejected',
    invalidates,
  });
  const reverse = useApiMutation((reason: string) => financeService.reverseExpense(id, reason), {
    successMessage: 'Expense reversed',
    invalidates,
  });

  if (isLoading) return <DetailSkeleton />;
  if (isError || !expense) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <>
      <RecordHeader
        backHref="/finance/expenses"
        backLabel="Expenses"
        title={expense.description}
        reference={expense.reference}
        subtitle={
          <>
            {expense.category?.name} · {expense.homecell?.name} · {formatDate(expense.date)}
          </>
        }
        status={<StatusBadge status={expense.status} />}
        highlight={{
          label: 'Amount',
          value: formatMinor(expense.amountMinor, expense.currency),
          tone: expense.status === 'APPROVED' ? 'destructive' : 'default',
        }}
        actions={
          <>
            {can('finance.approve') && expense.status === 'PENDING_APPROVAL' && (
              <>
                <ConfirmButton
                  variant="outline"
                  title="Reject this expense?"
                  description="The submitter is notified and the purse balance is unaffected."
                  confirmLabel="Reject expense"
                  requireReason
                  reasonLabel="Reason for rejection"
                  onConfirm={(reason) => reject.mutateAsync(reason)}
                  loading={reject.isPending}
                >
                  <X className="h-4 w-4" />
                  Reject
                </ConfirmButton>
                <ConfirmButton
                  title="Approve this expense?"
                  description={`${formatMinor(
                    expense.amountMinor,
                    expense.currency,
                  )} will be deducted from the Homecell purse immediately and posted to the ledger.`}
                  confirmLabel="Approve expense"
                  onConfirm={() => approve.mutateAsync()}
                  loading={approve.isPending}
                >
                  <Check className="h-4 w-4" />
                  Approve
                </ConfirmButton>
              </>
            )}
            {can('finance.reverse') && expense.status === 'APPROVED' && (
              <ConfirmButton
                variant="outline"
                title="Reverse this expense?"
                description="A reversing entry is posted to the ledger, returning the amount to the purse. The original record is preserved."
                confirmLabel="Reverse expense"
                requireReason
                reasonLabel="Reason for reversal"
                onConfirm={(reason) => reverse.mutateAsync(reason)}
                loading={reverse.isPending}
              >
                <Undo2 className="h-4 w-4" />
                Reverse
              </ConfirmButton>
            )}
          </>
        }
      />

      {expense.rejectionReason && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">Rejected</p>
          <p className="mt-1 text-sm text-muted-foreground">{expense.rejectionReason}</p>
        </div>
      )}

      {expense.status === 'PENDING_APPROVAL' && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          This expense has not yet affected the purse balance. Only approved expenses are deducted.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <InfoCard title="Expense details">
            <InfoGrid>
              <Info label="Homecell">
                {expense.homecell?._id ? (
                  <RecordLink href={`/finance/purses/${expense.homecell._id}`}>
                    {expense.homecell.name}
                  </RecordLink>
                ) : (
                  expense.homecell?.name
                )}
              </Info>
              <Info label="Category">{expense.category?.name}</Info>
              <Info label="Date">{formatDate(expense.date)}</Info>
              <Info label="Amount">{formatMinor(expense.amountMinor, expense.currency)}</Info>
              <Info label="Submitted by">
                {expense.submittedBy
                  ? `${expense.submittedBy.firstName} ${expense.submittedBy.lastName}`
                  : null}
              </Info>
              <Info label="Approved by">
                {expense.approvedBy
                  ? `${expense.approvedBy.firstName} ${expense.approvedBy.lastName}`
                  : null}
              </Info>
              <Info label="Description" full>
                {expense.description}
              </Info>
            </InfoGrid>
          </InfoCard>

          <InfoCard title="Supporting receipt">
            <AttachmentPreview
              url={expense.receiptUrl}
              label="Expense receipt"
              emptyMessage="No receipt attached to this expense"
            />
          </InfoCard>

          <RecordAuditTrail
            entityModel="Expense"
            entityId={expense._id}
            canView={can('audit.view')}
          />
        </div>

        <div className="space-y-5">
          <InfoCard title="Progress">
            <Timeline steps={buildTimeline(expense)} />
          </InfoCard>

          {expense.category && (
            <InfoCard title="Category policy">
              <InfoGrid columns={1}>
                <Info label="Category">{expense.category.name}</Info>
                <Info label="Receipt required">
                  {expense.category.requiresReceipt ? 'Yes' : 'No'}
                </Info>
                <Info label="Approval threshold">
                  {expense.category.approvalThresholdMinor > 0
                    ? formatMinor(expense.category.approvalThresholdMinor, expense.currency)
                    : 'Always requires approval'}
                </Info>
              </InfoGrid>
            </InfoCard>
          )}
        </div>
      </div>
    </>
  );
}

function buildTimeline(expense: Expense): TimelineStep[] {
  const steps: TimelineStep[] = [
    {
      label: 'Submitted',
      at: expense.createdAt,
      state: 'done',
      actor: expense.submittedBy
        ? `${expense.submittedBy.firstName} ${expense.submittedBy.lastName}`
        : undefined,
    },
  ];

  if (expense.status === 'REJECTED') {
    steps.push({
      label: 'Rejected',
      at: expense.approvedAt,
      state: 'failed',
      actor: expense.approvedBy
        ? `${expense.approvedBy.firstName} ${expense.approvedBy.lastName}`
        : undefined,
      description: expense.rejectionReason ?? undefined,
    });
    return steps;
  }

  steps.push({
    label: 'Approved',
    at: expense.approvedAt,
    state: expense.status === 'PENDING_APPROVAL' ? 'current' : 'done',
    actor: expense.approvedBy
      ? `${expense.approvedBy.firstName} ${expense.approvedBy.lastName}`
      : undefined,
    description:
      expense.status === 'PENDING_APPROVAL'
        ? 'Awaiting an approver.'
        : 'Posted to the ledger and deducted from the purse.',
  });

  if (expense.status === 'REVERSED') {
    steps.push({
      label: 'Reversed',
      state: 'failed',
      description: 'A reversing entry returned the amount to the Homecell purse.',
    });
  }

  return steps;
}
