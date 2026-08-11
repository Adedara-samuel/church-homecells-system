'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { paymentsService } from '@/services';
import { formatMinor, humanise } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Post-checkout landing page.
 *
 * The provider's redirect is *not* treated as proof of payment. This page polls the
 * API, which reports only what the backend has independently confirmed via webhook or
 * a server-side verification call.
 */
export default function PaymentCallbackPage() {
  return (
    <React.Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
          <div className="h-72 w-full max-w-md animate-pulse rounded-xl bg-muted" />
        </main>
      }
    >
      <PaymentCallback />
    </React.Suspense>
  );
}

function PaymentCallback() {
  const searchParams = useSearchParams();
  const reference =
    searchParams.get('reference') ?? searchParams.get('tx_ref') ?? searchParams.get('trxref') ?? '';

  const [attempts, setAttempts] = React.useState(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['payment-status', reference],
    queryFn: () => paymentsService.status(reference),
    enabled: Boolean(reference),
    // Webhooks usually land within seconds; stop polling after roughly a minute.
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && ['SUCCESSFUL', 'FAILED', 'CANCELLED', 'REVERSED'].includes(status)) return false;
      return attempts < 20 ? 3000 : false;
    },
  });

  React.useEffect(() => {
    if (data && !['SUCCESSFUL', 'FAILED', 'CANCELLED'].includes(data.status)) {
      setAttempts((count) => count + 1);
    }
  }, [data]);

  const status = data?.status;
  const settled = status === 'SUCCESSFUL';
  const failed = status === 'FAILED' || status === 'CANCELLED';

  const Icon = settled ? CheckCircle2 : failed ? XCircle : Clock;
  const tone = settled
    ? 'text-success bg-success/10'
    : failed
      ? 'text-destructive bg-destructive/10'
      : 'text-warning bg-warning/10';

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${tone}`}>
          <Icon className={isLoading || (!settled && !failed) ? 'h-8 w-8 animate-pulse' : 'h-8 w-8'} />
        </div>

        <h1 className="mt-5 text-xl font-semibold">
          {!reference
            ? 'No payment reference'
            : isError
              ? 'Payment not found'
              : settled
                ? 'Payment successful'
                : failed
                  ? `Payment ${humanise(status ?? '').toLowerCase()}`
                  : 'Confirming your payment'}
        </h1>

        <p className="mt-2 text-sm text-muted-foreground">
          {!reference
            ? 'This page was opened without a payment reference.'
            : isError
              ? 'We could not find a payment with that reference.'
              : settled
                ? 'The Homecell purse has been credited and a receipt recorded in the ledger.'
                : failed
                  ? data?.failureReason ?? 'The payment did not complete. No money has been moved.'
                  : 'We are waiting for confirmation from the payment provider. This usually takes a few seconds.'}
        </p>

        {data && (
          <dl className="mt-6 space-y-2 rounded-lg border p-4 text-left text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Reference</dt>
              <dd className="truncate font-mono text-xs">{data.reference}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="tabular font-medium">
                {formatMinor(data.amountMinor, data.currency)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">{humanise(data.status)}</dd>
            </div>
          </dl>
        )}

        {!settled && !failed && reference && attempts >= 20 && (
          <p className="mt-4 rounded-md bg-muted p-3 text-xs text-muted-foreground">
            Confirmation is taking longer than usual. The payment is safe — check the payments screen
            shortly, or ask an administrator to verify it against the provider.
          </p>
        )}

        <Button asChild className="mt-6 w-full">
          <Link href="/finance/payments">Go to payments</Link>
        </Button>
      </div>
    </main>
  );
}
