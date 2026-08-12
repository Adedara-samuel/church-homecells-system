'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Check, Landmark, Send, ShieldCheck, Undo2, Upload, Wallet, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMinor, humanise } from '@/lib/utils';
import { financeService, remittancesService, settingsService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery } from '@/hooks/use-api';
import type { Remittance } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/primitives';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import { StatusBadge } from '@/components/common/page';
import { DetailSkeleton, ErrorState } from '@/components/common/states';
import { ConfirmButton } from '@/components/common/filters';
import { Field, FileUploadField } from '@/components/common/form';
import {
  AttachmentPreview,
  Info,
  InfoCard,
  InfoGrid,
  MiniStat,
  RecordAuditTrail,
  RecordHeader,
  RecordLink,
  Timeline,
  type TimelineStep,
} from '@/components/common/detail';

export default function RemittanceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const id = params.id;

  const [disburseOpen, setDisburseOpen] = React.useState(false);
  const [receiptOpen, setReceiptOpen] = React.useState(false);

  const { data: remittance, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.remittances, id],
    () => remittancesService.get(id),
  );

  const purse = useQuery({
    queryKey: [...queryKeys.finance, 'purse', remittance?.homecell?._id],
    queryFn: () => financeService.purse(remittance!.homecell._id!),
    enabled: Boolean(remittance?.homecell?._id),
  });

  const settings = useQuery({ queryKey: [...queryKeys.settings], queryFn: settingsService.get });

  const invalidates = [queryKeys.remittances, queryKeys.finance, queryKeys.dashboard];

  const approve = useApiMutation(() => remittancesService.approve(id), {
    successMessage: 'Remittance approved',
    invalidates,
  });
  const verify = useApiMutation(() => remittancesService.verify(id), {
    successMessage: 'Remittance verified — the purse has been debited',
    invalidates,
  });
  const reject = useApiMutation((reason: string) => remittancesService.reject(id, reason), {
    successMessage: 'Remittance rejected',
    invalidates,
  });
  const reverse = useApiMutation((reason: string) => remittancesService.reverse(id, reason), {
    successMessage: 'Remittance reversed',
    invalidates,
  });

  if (isLoading) return <DetailSkeleton />;
  if (isError || !remittance) {
    return <ErrorState error={error} onRetry={() => void refetch()} />;
  }

  const steps = buildTimeline(remittance);
  const isManual = remittance.channel === 'MANUAL';
  const terminal = ['SUCCESSFUL', 'FAILED', 'CANCELLED', 'REVERSED'].includes(remittance.status);

  return (
    <>
      <RecordHeader
        backHref="/finance/remittances"
        backLabel="Remittances"
        title={remittance.homecell?.name ?? 'Remittance'}
        reference={remittance.reference}
        subtitle={
          <>
            {humanise(remittance.channel)} remittance to {remittance.receivingAccount} ·{' '}
            {formatDate(remittance.date)}
          </>
        }
        status={<StatusBadge status={remittance.status} />}
        highlight={{
          label: 'Amount',
          value: formatMinor(remittance.amountMinor, remittance.currency),
          tone: remittance.status === 'SUCCESSFUL' ? 'success' : 'default',
        }}
        actions={
          <>
            {can('remittances.approve') && remittance.status === 'PENDING_APPROVAL' && (
              <>
                <ConfirmButton
                  variant="outline"
                  title="Reject this remittance?"
                  description="The purse balance is unaffected and the coordinator is notified."
                  confirmLabel="Reject remittance"
                  requireReason
                  reasonLabel="Reason for rejection"
                  onConfirm={(reason) => reject.mutateAsync(reason)}
                  loading={reject.isPending}
                >
                  <X className="h-4 w-4" />
                  Reject
                </ConfirmButton>
                <ConfirmButton
                  title="Approve this remittance?"
                  description="Approving allows it to be verified or disbursed. The purse is not debited yet."
                  confirmLabel="Approve"
                  onConfirm={() => approve.mutateAsync()}
                  loading={approve.isPending}
                >
                  <Check className="h-4 w-4" />
                  Approve
                </ConfirmButton>
              </>
            )}

            {can('remittances.verify') && remittance.status === 'APPROVED' && isManual && (
              <ConfirmButton
                title="Verify this remittance?"
                description={`Confirms the proof of payment. ${formatMinor(
                  remittance.amountMinor,
                  remittance.currency,
                )} will be deducted from the Homecell purse and posted to the ledger.`}
                confirmLabel="Verify and post"
                onConfirm={() => verify.mutateAsync()}
                loading={verify.isPending}
              >
                <ShieldCheck className="h-4 w-4" />
                Verify
              </ConfirmButton>
            )}

            {can('payments.disburse') && remittance.status === 'APPROVED' && (
              <Button variant="outline" onClick={() => setDisburseOpen(true)}>
                <Send className="h-4 w-4" />
                Disburse
              </Button>
            )}

            {can('remittances.create') && !terminal && (
              <Button variant="outline" onClick={() => setReceiptOpen(true)}>
                <Upload className="h-4 w-4" />
                {remittance.receiptUrl ? 'Replace proof' : 'Attach proof'}
              </Button>
            )}

            {can('finance.reverse') && remittance.status === 'SUCCESSFUL' && (
              <ConfirmButton
                variant="outline"
                title="Reverse this remittance?"
                description="A reversing entry is posted to the ledger, returning the amount to the Homecell purse. The original record is preserved."
                confirmLabel="Reverse remittance"
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

      {remittance.status === 'APPROVED' && isManual && !remittance.receiptUrl &&
        settings.data?.remittanceRequiresReceipt && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-4 text-sm">
            Proof of payment must be attached before this remittance can be verified.
          </div>
        )}

      {remittance.failureReason && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">The payout did not complete</p>
          <p className="mt-1 text-sm text-muted-foreground">{remittance.failureReason}</p>
        </div>
      )}

      {remittance.rejectionReason && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm font-medium text-destructive">Rejected</p>
          <p className="mt-1 text-sm text-muted-foreground">{remittance.rejectionReason}</p>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <InfoCard title="Remittance details">
            <InfoGrid>
              <Info label="Homecell">
                {remittance.homecell?._id ? (
                  <RecordLink href={`/finance/purses/${remittance.homecell._id}`}>
                    {remittance.homecell.name}
                  </RecordLink>
                ) : (
                  remittance.homecell?.name
                )}
              </Info>
              <Info label="Remittance date">{formatDate(remittance.date)}</Info>
              <Info label="Amount">
                {formatMinor(remittance.amountMinor, remittance.currency)}
              </Info>
              <Info label="Channel">{humanise(remittance.channel)}</Info>
              <Info label="Destination account">{remittance.receivingAccount}</Info>
              <Info label="Payment reference" mono>
                {remittance.paymentReference}
              </Info>
              <Info label="Provider reference" mono>
                {remittance.providerReference}
              </Info>
              <Info label="Recorded by">
                {remittance.recordedBy
                  ? `${remittance.recordedBy.firstName} ${remittance.recordedBy.lastName}`
                  : null}
              </Info>
              <Info label="Description" full>
                {remittance.description}
              </Info>
            </InfoGrid>
          </InfoCard>

          <InfoCard
            title="Proof of payment"
            description="Attached to the remittance and to its ledger entry."
          >
            <AttachmentPreview
              url={remittance.receiptUrl}
              label="Remittance receipt"
              emptyMessage="No proof of payment attached yet"
            />
          </InfoCard>

          <RecordAuditTrail
            entityModel="Remittance"
            entityId={remittance._id}
            canView={can('audit.view')}
          />
        </div>

        <div className="space-y-5">
          <InfoCard title="Progress">
            <Timeline steps={steps} />
          </InfoCard>

          {purse.data && (
            <InfoCard
              title="Homecell purse"
              actions={
                <Button variant="ghost" size="sm" onClick={() => router.push(`/finance/purses/${purse.data.homecellId}`)}>
                  Open
                </Button>
              }
            >
              <div className="grid gap-3">
                <MiniStat
                  label="Available balance"
                  value={formatMinor(purse.data.balance.availableMinor, purse.data.currency)}
                  icon={Wallet}
                  tone={purse.data.requiresRemittance ? 'warning' : 'default'}
                />
                <MiniStat
                  label="Maximum threshold"
                  value={formatMinor(purse.data.thresholdMinor, purse.data.currency)}
                  icon={Landmark}
                  tone="muted"
                />
              </div>
              {purse.data.requiresRemittance && (
                <p className="mt-3 rounded-md bg-warning/10 p-3 text-xs">
                  This purse is at or above its maximum threshold.
                </p>
              )}
            </InfoCard>
          )}

          {remittance.payment && (
            <InfoCard title="Linked payment">
              <p className="text-sm text-muted-foreground">
                This remittance was disbursed through the payment provider.
              </p>
              <Button variant="outline" size="sm" className="mt-3 w-full" asChild>
                <a href={`/finance/payments?search=${remittance.reference}`}>View payment</a>
              </Button>
            </InfoCard>
          )}
        </div>
      </div>

      <DisburseDialog
        remittance={disburseOpen ? remittance : null}
        onClose={() => setDisburseOpen(false)}
      />
      <AttachReceiptDialog
        remittanceId={id}
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        existing={remittance.receiptUrl}
      />
    </>
  );
}

/** Maps the remittance lifecycle onto the shared timeline component. */
function buildTimeline(remittance: Remittance): TimelineStep[] {
  const status = remittance.status;
  const failed = status === 'FAILED' || status === 'CANCELLED';

  const reached = (...statuses: string[]) => statuses.includes(status);

  const steps: TimelineStep[] = [
    {
      label: 'Recorded',
      at: remittance.createdAt,
      state: 'done',
      actor: remittance.recordedBy
        ? `${remittance.recordedBy.firstName} ${remittance.recordedBy.lastName}`
        : undefined,
    },
    {
      label: 'Approved',
      at: remittance.approvedAt,
      state: remittance.approvedAt
        ? failed
          ? 'failed'
          : 'done'
        : reached('PENDING_APPROVAL')
          ? 'current'
          : 'pending',
      actor: remittance.approvedBy
        ? `${remittance.approvedBy.firstName} ${remittance.approvedBy.lastName}`
        : undefined,
      description: remittance.rejectionReason ?? undefined,
    },
  ];

  if (remittance.channel === 'PROVIDER_TRANSFER') {
    steps.push({
      label: 'Sent to payment provider',
      state: reached('PROCESSING', 'SUCCESSFUL') ? 'done' : failed ? 'failed' : 'pending',
      description: remittance.providerReference
        ? `Provider reference ${remittance.providerReference}`
        : 'Awaiting submission',
    });
  }

  steps.push({
    label: remittance.channel === 'MANUAL' ? 'Verified' : 'Confirmed by provider',
    at: remittance.verifiedAt,
    state: reached('SUCCESSFUL')
      ? 'done'
      : failed
        ? 'failed'
        : reached('APPROVED', 'PROCESSING')
          ? 'current'
          : 'pending',
    actor: remittance.verifiedBy
      ? `${remittance.verifiedBy.firstName} ${remittance.verifiedBy.lastName}`
      : undefined,
    description:
      remittance.failureReason ??
      (reached('SUCCESSFUL') ? 'The Homecell purse has been debited.' : undefined),
  });

  if (status === 'REVERSED') {
    steps.push({
      label: 'Reversed',
      state: 'failed',
      description: 'A reversing entry returned the amount to the Homecell purse.',
    });
  }

  return steps;
}

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

  const mutation = useApiMutation(() => remittancesService.disburse(remittance!._id, form), {
    successMessage: 'Payout submitted — awaiting confirmation from the payment provider',
    invalidates: [queryKeys.remittances, queryKeys.payments, queryKeys.finance],
    onSuccess: onClose,
  });

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
              ? `${formatMinor(
                  remittance.amountMinor,
                  remittance.currency,
                )} will be sent through the active payment provider.`
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
          <Field
            label="Bank code"
            htmlFor="disburse-bank"
            required
            hint="The provider's numeric bank code, for example 057 for Zenith Bank"
          >
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
            The payout is submitted to the provider and marked as processing. The Homecell purse
            is debited only when the provider confirms the transfer succeeded.
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

function AttachReceiptDialog({
  remittanceId,
  open,
  onOpenChange,
  existing,
}: {
  remittanceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing?: string | null;
}) {
  const [receipt, setReceipt] = React.useState<{ url: string; publicId: string } | null>(null);

  React.useEffect(() => {
    if (open) setReceipt(null);
  }, [open]);

  const mutation = useApiMutation(
    () => remittancesService.attachReceipt(remittanceId, receipt!.url, receipt!.publicId),
    {
      successMessage: 'Proof of payment attached',
      invalidates: [queryKeys.remittances, queryKeys.finance],
      onSuccess: () => onOpenChange(false),
    },
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? 'Replace proof of payment' : 'Attach proof of payment'}</DialogTitle>
          <DialogDescription>
            The receipt is stored against the remittance and its ledger entry.
          </DialogDescription>
        </DialogHeader>

        <FileUploadField
          value={receipt}
          onChange={setReceipt}
          folder="receipts"
          label="Upload proof of payment"
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!receipt}>
            Attach receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
