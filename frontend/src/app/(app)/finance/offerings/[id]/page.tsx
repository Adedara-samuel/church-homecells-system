'use client';

import { useParams } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatDate, formatMinor, humanise } from '@/lib/utils';
import { financeService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery } from '@/hooks/use-api';
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
} from '@/components/common/detail';

export default function OfferingDetailPage() {
  const params = useParams<{ id: string }>();
  const { can } = useAuth();
  const id = params.id;

  const { data: offering, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.finance, 'offering', id],
    () => financeService.offering(id),
  );

  const reverse = useApiMutation((reason: string) => financeService.reverseOffering(id, reason), {
    successMessage: 'Offering reversed',
    invalidates: [queryKeys.finance, queryKeys.dashboard],
  });

  if (isLoading) return <DetailSkeleton />;
  if (isError || !offering) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <>
      <RecordHeader
        backHref="/finance/offerings"
        backLabel="Offerings"
        title={`${offering.homecell?.name ?? 'Homecell'} offering`}
        reference={offering.reference}
        subtitle={
          <>
            {humanise(offering.channel)} · Sunday meeting on {formatDate(offering.date)}
          </>
        }
        status={<StatusBadge status={offering.status} />}
        highlight={{
          label: 'Amount',
          value: formatMinor(offering.amountMinor, offering.currency),
          tone: offering.status === 'POSTED' ? 'success' : 'default',
        }}
        actions={
          can('finance.reverse') &&
          offering.status === 'POSTED' && (
            <ConfirmButton
              variant="outline"
              title="Reverse this offering?"
              description="A reversing entry is posted to the ledger, removing the credit from the purse. The original record is preserved."
              confirmLabel="Reverse offering"
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

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <InfoCard title="Offering details">
            <InfoGrid>
              <Info label="Homecell">
                {offering.homecell?._id ? (
                  <RecordLink href={`/finance/purses/${offering.homecell._id}`}>
                    {offering.homecell.name}
                  </RecordLink>
                ) : (
                  offering.homecell?.name
                )}
              </Info>
              <Info label="Meeting date">{formatDate(offering.date)}</Info>
              <Info label="Amount">{formatMinor(offering.amountMinor, offering.currency)}</Info>
              <Info label="Channel">{humanise(offering.channel)}</Info>
              <Info label="Recorded by">
                {offering.recordedBy
                  ? `${offering.recordedBy.firstName} ${offering.recordedBy.lastName}`
                  : null}
              </Info>
              <Info label="Recorded at">{formatDate(offering.createdAt, true)}</Info>
              <Info label="Description" full>
                {offering.description}
              </Info>
            </InfoGrid>
          </InfoCard>

          {offering.channel === 'ONLINE_PAYMENT' && (
            <InfoCard
              title="Online payment"
              description="This offering was created automatically when the payment provider confirmed the transaction."
            >
              <RecordLink href={`/finance/payments?search=${offering.reference}`}>
                View the related payment
              </RecordLink>
            </InfoCard>
          )}

          <InfoCard title="Supporting document">
            <AttachmentPreview
              url={offering.receiptUrl}
              label="Offering record"
              emptyMessage="No supporting document attached"
            />
          </InfoCard>

          <RecordAuditTrail
            entityModel="Offering"
            entityId={offering._id}
            canView={can('audit.view')}
          />
        </div>

        <div className="space-y-5">
          <InfoCard title="Progress">
            <Timeline
              steps={[
                {
                  label: 'Recorded',
                  at: offering.createdAt,
                  state: 'done',
                  actor: offering.recordedBy
                    ? `${offering.recordedBy.firstName} ${offering.recordedBy.lastName}`
                    : undefined,
                },
                {
                  label: 'Posted to the ledger',
                  at: offering.createdAt,
                  state: offering.status === 'POSTED' ? 'done' : 'failed',
                  description:
                    offering.status === 'POSTED'
                      ? 'The Homecell purse has been credited.'
                      : 'This offering has been reversed.',
                },
                ...(offering.status === 'REVERSED'
                  ? [
                      {
                        label: 'Reversed',
                        state: 'failed' as const,
                        description: 'A reversing entry removed the credit from the purse.',
                      },
                    ]
                  : []),
              ]}
            />
          </InfoCard>

          <InfoCard title="Business rule">
            <p className="text-sm text-muted-foreground">
              Homecell offerings can only be recorded against a Sunday meeting (BR-008), and each
              posts a credit to the Homecell purse immediately.
            </p>
          </InfoCard>
        </div>
      </div>
    </>
  );
}
