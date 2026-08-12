'use client';

import { useParams } from 'next/navigation';
import { CheckCircle2, ExternalLink, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMinor, humanise } from '@/lib/utils';
import { paymentsService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery } from '@/hooks/use-api';
import type { PaymentStatus } from '@/types';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/common/page';
import { DetailSkeleton, ErrorState } from '@/components/common/states';
import { ConfirmButton } from '@/components/common/filters';
import {
  Info,
  InfoCard,
  InfoGrid,
  RecordAuditTrail,
  RecordHeader,
  RecordLink,
  Timeline,
  type TimelineStep,
} from '@/components/common/detail';

const TERMINAL: PaymentStatus[] = ['SUCCESSFUL', 'REVERSED', 'REFUNDED'];

export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const id = params.id;

  const { data: payment, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.payments, id],
    () => paymentsService.get(id),
    {
      // A pending payment is waiting on a provider webhook — poll until it settles.
      refetchInterval: (query) =>
        query.state.data && !TERMINAL.includes(query.state.data.status) ? 8000 : false,
    },
  );

  const verify = useApiMutation(() => paymentsService.verify(payment!.reference), {
    successMessage: 'Status refreshed from the provider',
    invalidates: [queryKeys.payments, queryKeys.finance, queryKeys.dashboard],
  });

  const settle = useApiMutation((note: string) => paymentsService.settle(id, note), {
    successMessage: 'Payment settled manually and posted to the ledger',
    invalidates: [queryKeys.payments, queryKeys.finance, queryKeys.dashboard],
  });

  if (isLoading) return <DetailSkeleton />;
  if (isError || !payment) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const mismatch =
    payment.providerAmountMinor != null && payment.providerAmountMinor !== payment.amountMinor;

  return (
    <>
      <RecordHeader
        backHref="/finance/payments"
        backLabel="Payments"
        title={`${humanise(payment.purpose)} payment`}
        reference={payment.reference}
        subtitle={
          <>
            {payment.provider} · {humanise(payment.direction)} · {payment.homecell?.name}
          </>
        }
        status={<StatusBadge status={payment.status} />}
        highlight={{
          label: 'Amount',
          value: formatMinor(payment.amountMinor, payment.currency),
          tone:
            payment.status === 'SUCCESSFUL'
              ? 'success'
              : payment.status === 'FAILED'
                ? 'destructive'
                : 'default',
        }}
        actions={
          <>
            {payment.authorizationUrl && !TERMINAL.includes(payment.status) && (
              <Button variant="outline" asChild>
                <a href={payment.authorizationUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                  Open checkout
                </a>
              </Button>
            )}
            {!TERMINAL.includes(payment.status) && can('payments.view') && (
              <Button
                variant="outline"
                onClick={() => verify.mutate()}
                loading={verify.isPending}
              >
                <RefreshCw className="h-4 w-4" />
                Verify with provider
              </Button>
            )}
            {can('finance.reconcile') && !payment.ledgerTransaction && (
              <ConfirmButton
                title="Settle this payment manually?"
                description="Use only when the provider has confirmed the payment out of band. The amount is posted to the ledger and the purse is credited."
                confirmLabel="Settle payment"
                requireReason
                reasonLabel="Why is this being settled manually?"
                onConfirm={(note) => settle.mutateAsync(note)}
                loading={settle.isPending}
              >
                <CheckCircle2 className="h-4 w-4" />
                Settle manually
              </ConfirmButton>
            )}
          </>
        }
      />

      {mismatch && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">Amount mismatch</p>
          <p className="mt-1 text-sm text-muted-foreground">
            We expected {formatMinor(payment.amountMinor, payment.currency)} but the provider
            reported {formatMinor(payment.providerAmountMinor!, payment.currency)}. This payment has
            not been posted automatically and needs reconciliation.
          </p>
        </div>
      )}

      {payment.failureReason && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">Payment failed</p>
          <p className="mt-1 text-sm text-muted-foreground">{payment.failureReason}</p>
        </div>
      )}

      {!TERMINAL.includes(payment.status) && !payment.failureReason && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
          Awaiting confirmation from {payment.provider}. This page refreshes automatically — no
          money moves until the provider confirms the payment.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <InfoCard title="Payment details">
            <InfoGrid>
              <Info label="Homecell">
                {payment.homecell?._id ? (
                  <RecordLink href={`/finance/purses/${payment.homecell._id}`}>
                    {payment.homecell.name}
                  </RecordLink>
                ) : (
                  payment.homecell?.name
                )}
              </Info>
              <Info label="Purpose">{humanise(payment.purpose)}</Info>
              <Info label="Direction">{humanise(payment.direction)}</Info>
              <Info label="Provider">{payment.provider}</Info>
              <Info label="Amount">{formatMinor(payment.amountMinor, payment.currency)}</Info>
              <Info label="Provider amount">
                {payment.providerAmountMinor != null
                  ? formatMinor(payment.providerAmountMinor, payment.currency)
                  : null}
              </Info>
              <Info label="Payer">{payment.customerName}</Info>
              <Info label="Payer email">{payment.customerEmail}</Info>
              <Info label="Created">{formatDate(payment.createdAt, true)}</Info>
              <Info label="Completed">
                {payment.completedAt ? formatDate(payment.completedAt, true) : null}
              </Info>
              <Info label="Description" full>
                {payment.description}
              </Info>
            </InfoGrid>
          </InfoCard>

          <InfoCard
            title="Provider references"
            description="Quote these when raising a query with the payment provider."
          >
            <InfoGrid>
              <Info label="Our reference" mono>
                {payment.reference}
              </Info>
              <Info label="Provider reference" mono>
                {payment.providerReference}
              </Info>
              <Info label="Provider status" mono>
                {payment.providerStatusRaw ?? undefined}
              </Info>
              <Info label="Ledger transaction" mono>
                {payment.ledgerTransaction ? (
                  <RecordLink href={`/finance/ledger/${payment.ledgerTransaction}`}>
                    {payment.ledgerTransaction}
                  </RecordLink>
                ) : null}
              </Info>
            </InfoGrid>
          </InfoCard>

          <RecordAuditTrail
            entityModel="Payment"
            entityId={payment._id}
            canView={can('audit.view')}
          />
        </div>

        <div className="space-y-5">
          <InfoCard
            title="Status history"
            description="Every transition, and what caused it."
          >
            <Timeline steps={buildStatusTimeline(payment.statusHistory)} />
          </InfoCard>

          <InfoCard title="Reconciliation">
            <InfoGrid columns={1}>
              <Info label="State">
                <StatusBadge status={payment.reconciliationStatus} />
              </Info>
              <Info label="Note">{payment.reconciliationNote}</Info>
            </InfoGrid>
            {can('finance.reconcile') && (
              <Button variant="outline" size="sm" className="mt-4 w-full" asChild>
                <a href="/finance/reconciliation">Open reconciliation</a>
              </Button>
            )}
          </InfoCard>
        </div>
      </div>
    </>
  );
}

function buildStatusTimeline(
  history: { status: PaymentStatus; at: string; source: string; note?: string }[],
): TimelineStep[] {
  return history.map((entry, index) => ({
    label: humanise(entry.status),
    at: entry.at,
    state:
      entry.status === 'SUCCESSFUL'
        ? 'done'
        : entry.status === 'FAILED' || entry.status === 'CANCELLED'
          ? 'failed'
          : index === history.length - 1
            ? 'current'
            : 'done',
    actor: `via ${entry.source.toLowerCase()}`,
    description: entry.note,
  }));
}
