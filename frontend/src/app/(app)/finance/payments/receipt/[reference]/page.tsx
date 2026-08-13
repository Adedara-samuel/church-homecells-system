'use client';

import { useParams } from 'next/navigation';
import { formatDate, formatMinor, humanise } from '@/lib/utils';
import { paymentsService } from '@/services';
import { useApiQuery } from '@/hooks/use-api';
import { PageHeader } from '@/components/common/page';
import { ErrorState } from '@/components/common/states';
import { ReceiptPreview } from '@/components/common/receipt-preview';
import { Badge } from '@/components/ui/primitives';

/**
 * A permanent home for a receipt.
 *
 * The callback page shows it once, immediately after paying; this is where it lives
 * afterwards, so a notification or a payments row can link straight to it rather than
 * making a coordinator re-derive which payment they mean.
 */
export default function ReceiptPage() {
  const params = useParams<{ reference: string }>();
  const reference = params.reference;

  const payment = useApiQuery(['payment-status', reference], () =>
    paymentsService.status(reference),
  );

  const settled = payment.data?.status === 'SUCCESSFUL';

  return (
    <>
      <PageHeader
        title="Receipt"
        description={`Payment ${reference}`}
        breadcrumbs={[
          { label: 'Finance' },
          { label: 'Payments', href: '/finance/payments' },
          { label: 'Receipt' },
        ]}
      />

      {payment.isError ? (
        <ErrorState error={payment.error} onRetry={() => void payment.refetch()} />
      ) : (
        <div className="mx-auto max-w-2xl space-y-4">
          {payment.data && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
              <div>
                <p className="text-xs text-muted-foreground">Amount</p>
                <p className="text-lg font-semibold tabular-nums">
                  {formatMinor(payment.data.amountMinor, payment.data.currency)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">
                  {formatDate(payment.data.createdAt, true)}
                </p>
                <Badge variant={settled ? 'success' : 'warning'}>
                  {humanise(payment.data.status)}
                </Badge>
              </div>
            </div>
          )}

          {settled ? (
            <ReceiptPreview reference={reference} />
          ) : (
            <p className="rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm text-muted-foreground">
              A receipt is issued once the payment provider confirms this payment. It is not
              available while the payment is still {humanise(payment.data?.status ?? 'pending').toLowerCase()}.
            </p>
          )}
        </div>
      )}
    </>
  );
}
