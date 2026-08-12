'use client';

import { useParams } from 'next/navigation';
import { ArrowDownLeft, ArrowUpRight, Undo2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatMinor, humanise } from '@/lib/utils';
import { financeService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery } from '@/hooks/use-api';
import { Badge } from '@/components/ui/primitives';
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
} from '@/components/common/detail';

/** Where a ledger entry's source document lives, by model name. */
const SOURCE_ROUTES: Record<string, string> = {
  Offering: '/finance/offerings',
  Expense: '/finance/expenses',
  Remittance: '/finance/remittances',
  Payment: '/finance/payments',
};

export default function LedgerTransactionPage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const id = params.id;

  const { data: txn, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.finance, 'transaction', id],
    () => financeService.transaction(id),
  );

  const reverse = useApiMutation((reason: string) => financeService.reverseTransaction(id, reason), {
    successMessage: 'Transaction reversed',
    invalidates: [queryKeys.finance, queryKeys.dashboard],
  });

  if (isLoading) return <DetailSkeleton />;
  if (isError || !txn) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const isCredit = txn.direction === 'CREDIT';
  const sourceRoute = txn.sourceModel ? SOURCE_ROUTES[txn.sourceModel] : undefined;

  return (
    <>
      <RecordHeader
        backHref="/finance/ledger"
        backLabel="Ledger"
        title={txn.description}
        reference={txn.transactionRef}
        subtitle={
          <>
            {humanise(txn.type)} · {txn.homecell?.name} · value date {formatDate(txn.valueDate)}
          </>
        }
        status={<StatusBadge status={txn.status} />}
        highlight={{
          label: isCredit ? 'Credit' : 'Debit',
          value: (
            <span className="inline-flex items-center gap-1.5">
              {isCredit ? (
                <ArrowDownLeft className="h-5 w-5" />
              ) : (
                <ArrowUpRight className="h-5 w-5" />
              )}
              {formatMinor(txn.amountMinor, txn.currency)}
            </span>
          ),
          tone: isCredit ? 'success' : 'destructive',
        }}
        actions={
          can('finance.reverse') &&
          txn.status === 'POSTED' && (
            <ConfirmButton
              variant="outline"
              title="Reverse this transaction?"
              description="An equal and opposite entry is posted. The original is preserved and marked as reversed — ledger entries are never edited or deleted."
              confirmLabel="Reverse transaction"
              requireReason
              reasonLabel="Reason for reversal"
              onConfirm={(reason) => reverse.mutateAsync(reason)}
              loading={reverse.isPending}
            >
              <Undo2 className="h-4 w-4" />
              Reverse
            </ConfirmButton>
          )
        }
      />

      {txn.status === 'REVERSED' && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4">
          <p className="text-sm font-medium">This entry has been reversed</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {txn.reversalReason ?? 'A reversing entry cancels this amount.'}
            {txn.reversedAt ? ` Reversed on ${formatDate(txn.reversedAt, true)}.` : ''}
          </p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <InfoCard title="Transaction">
            <InfoGrid>
              <Info label="Type">
                <Badge variant="secondary">{humanise(txn.type)}</Badge>
              </Info>
              <Info label="Direction">
                <span className={cn('font-medium', isCredit ? 'text-success' : 'text-destructive')}>
                  {humanise(txn.direction)}
                </span>
              </Info>
              <Info label="Amount">{formatMinor(txn.amountMinor, txn.currency)}</Info>
              <Info label="Currency">{txn.currency}</Info>
              <Info label="Value date">{formatDate(txn.valueDate)}</Info>
              <Info label="Posted at">{formatDate(txn.createdAt, true)}</Info>
              <Info label="Homecell">
                {txn.homecell?._id ? (
                  <RecordLink href={`/finance/purses/${txn.homecell._id}`}>
                    {txn.homecell.name}
                  </RecordLink>
                ) : (
                  txn.homecell?.name
                )}
              </Info>
              <Info label="Recorded by">
                {txn.createdBy ? `${txn.createdBy.firstName} ${txn.createdBy.lastName}` : 'System'}
              </Info>
              <Info label="Approved by">
                {txn.approvedBy ? `${txn.approvedBy.firstName} ${txn.approvedBy.lastName}` : null}
              </Info>
              <Info label="Description" full>
                {txn.description}
              </Info>
            </InfoGrid>
          </InfoCard>

          <InfoCard
            title="Traceability"
            description="Immutable identifiers linking this entry to its source and to the payment provider."
          >
            <InfoGrid>
              <Info label="Transaction reference" mono>
                {txn.transactionRef}
              </Info>
              <Info label="Business reference" mono>
                {txn.reference}
              </Info>
              <Info label="Provider reference" mono>
                {txn.providerReference}
              </Info>
              <Info label="Source document">
                {txn.sourceModel && sourceRoute && txn.sourceId ? (
                  <RecordLink href={`${sourceRoute}/${txn.sourceId}`}>
                    {humanise(txn.sourceModel)}
                  </RecordLink>
                ) : txn.sourceModel ? (
                  humanise(txn.sourceModel)
                ) : null}
              </Info>
            </InfoGrid>
          </InfoCard>

          {txn.supportingDocumentUrl && (
            <InfoCard title="Supporting document">
              <AttachmentPreview url={txn.supportingDocumentUrl} label="Attached document" />
            </InfoCard>
          )}

          <RecordAuditTrail
            entityModel="LedgerTransaction"
            entityId={txn._id}
            canView={can('audit.view')}
          />
        </div>

        <div className="space-y-5">
          <InfoCard title="Immutability">
            <p className="text-sm text-muted-foreground">
              Posted ledger entries cannot be edited or deleted by anyone, including a System
              Administrator. Corrections are made by posting an equal and opposite reversal, so the
              original fact and its correction both remain in the history.
            </p>
            <dl className="mt-4 space-y-3">
              <Info label="Status">
                <StatusBadge status={txn.status} />
              </Info>
              {txn.reversedAt && (
                <Info label="Reversed at">{formatDate(txn.reversedAt, true)}</Info>
              )}
              {txn.reversalReason && <Info label="Reason">{txn.reversalReason}</Info>}
            </dl>
          </InfoCard>
        </div>
      </div>
    </>
  );
}
