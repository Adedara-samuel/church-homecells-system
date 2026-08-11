'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Check, CircleDashed, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, humanise } from '@/lib/utils';
import { transfersService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { DetailRow, PageHeader, StatusBadge } from '@/components/common/page';
import { DetailSkeleton, ErrorState } from '@/components/common/states';
import { ConfirmButton } from '@/components/common/filters';

export default function TransferDetailPage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();

  const { data: transfer, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.transfers, params.id],
    () => transfersService.get(params.id),
  );

  const approve = useApiMutation(
    (comment: string) => transfersService.approve(params.id, comment || undefined),
    {
      successMessage: 'Transfer approved',
      invalidates: [queryKeys.transfers, queryKeys.members, queryKeys.dashboard],
    },
  );

  const reject = useApiMutation((reason: string) => transfersService.reject(params.id, reason), {
    successMessage: 'Transfer rejected',
    invalidates: [queryKeys.transfers, queryKeys.dashboard],
  });

  const cancel = useApiMutation(() => transfersService.cancel(params.id), {
    successMessage: 'Transfer cancelled',
    invalidates: [queryKeys.transfers],
  });

  if (isLoading) return <DetailSkeleton />;
  if (isError || !transfer) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const memberName = `${transfer.member?.firstName ?? ''} ${transfer.member?.lastName ?? ''}`.trim();
  const isPending = transfer.status === 'PENDING';

  return (
    <>
      <PageHeader
        title={`Transfer ${transfer.reference}`}
        description={`${memberName} · ${humanise(transfer.scope)}`}
        breadcrumbs={[{ label: 'Transfers', href: '/transfers' }, { label: transfer.reference }]}
        actions={
          isPending && (
            <>
              {can('transfers.approve') && (
                <>
                  <ConfirmButton
                    variant="outline"
                    title="Reject this transfer?"
                    description="The requester is notified and the member stays in their current Homecell."
                    confirmLabel="Reject transfer"
                    requireReason
                    reasonLabel="Reason for rejection"
                    onConfirm={(reason) => reject.mutateAsync(reason)}
                    loading={reject.isPending}
                  >
                    Reject
                  </ConfirmButton>
                  <ConfirmButton
                    title="Approve this transfer?"
                    description={
                      transfer.currentStageIndex + 1 < transfer.approvalChain.length
                        ? 'This approves the current stage and passes the request to the next approver.'
                        : 'This is the final approval. The member will be moved to the destination Homecell.'
                    }
                    confirmLabel="Approve"
                    onConfirm={(comment) => approve.mutateAsync(comment)}
                    loading={approve.isPending}
                  >
                    <Check className="h-4 w-4" />
                    Approve
                  </ConfirmButton>
                </>
              )}
              {can('members.transfer') && (
                <ConfirmButton
                  variant="ghost"
                  title="Cancel this request?"
                  description="The request is withdrawn. A new one can be submitted later."
                  confirmLabel="Cancel request"
                  onConfirm={() => cancel.mutateAsync()}
                  loading={cancel.isPending}
                >
                  Withdraw
                </ConfirmButton>
              )}
            </>
          )
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Transfer details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-5 sm:grid-cols-2">
              <DetailRow label="Member">
                <Link
                  href={`/members/${transfer.member?._id}`}
                  className="text-primary hover:underline"
                >
                  {memberName} ({transfer.member?.memberId})
                </Link>
              </DetailRow>
              <DetailRow label="Status">
                <StatusBadge status={transfer.status} />
              </DetailRow>
              <DetailRow label="Scope">
                <Badge variant="secondary">{humanise(transfer.scope)}</Badge>
              </DetailRow>
              <DetailRow label="Requested by">
                {transfer.requestedBy
                  ? `${transfer.requestedBy.firstName} ${transfer.requestedBy.lastName}`
                  : null}
              </DetailRow>
              <DetailRow label="Date requested">{formatDate(transfer.requestedAt, true)}</DetailRow>
              <DetailRow label="Date completed">
                {transfer.completedAt ? formatDate(transfer.completedAt, true) : null}
              </DetailRow>

              <DetailRow label="From" className="sm:col-span-2">
                {transfer.previousHomecell?.name} · {transfer.previousArea?.name} ·{' '}
                {transfer.previousZone?.name}
              </DetailRow>
              <DetailRow label="To" className="sm:col-span-2">
                {transfer.newHomecell?.name} · {transfer.newArea?.name} · {transfer.newZone?.name}
              </DetailRow>
              <DetailRow label="Reason" className="sm:col-span-2">
                {transfer.reason}
              </DetailRow>
              {transfer.rejectionReason && (
                <DetailRow label="Rejection reason" className="sm:col-span-2">
                  {transfer.rejectionReason}
                </DetailRow>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approval chain</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4">
              {transfer.approvalChain.map((step, index) => {
                const done = Boolean(step.decision);
                const current = isPending && index === transfer.currentStageIndex;
                return (
                  <li key={`${step.stage}-${index}`} className="flex gap-3">
                    <div
                      className={cn(
                        'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2',
                        step.decision === 'APPROVED' && 'border-success bg-success text-success-foreground',
                        step.decision === 'REJECTED' &&
                          'border-destructive bg-destructive text-destructive-foreground',
                        current && !done && 'border-primary text-primary',
                        !current && !done && 'border-muted-foreground/30 text-muted-foreground',
                      )}
                    >
                      {step.decision === 'APPROVED' ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : step.decision === 'REJECTED' ? (
                        <X className="h-3.5 w-3.5" />
                      ) : (
                        <CircleDashed className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{humanise(step.stage)}</p>
                      {step.approver ? (
                        <p className="text-xs text-muted-foreground">
                          {step.approver.firstName} {step.approver.lastName} ·{' '}
                          {formatDate(step.decidedAt)}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {current ? 'Awaiting decision' : 'Not yet reached'}
                        </p>
                      )}
                      {step.comment && (
                        <p className="mt-1 text-xs text-muted-foreground">“{step.comment}”</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
