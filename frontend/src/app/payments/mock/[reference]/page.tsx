'use client';

import * as React from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { CreditCard, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { API_BASE } from '@/lib/api-client';
import { formatMinor } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';

/**
 * Development checkout for the mock payment provider.
 *
 * It exists so the *entire* payment path — checkout, webhook, signature verification,
 * idempotency, ledger posting and reconciliation — can be exercised without any
 * provider credentials. It never appears when a real provider is configured, because
 * only `MockPaymentProvider` produces a URL pointing here.
 *
 * Note the deliberate asymmetry: this page does not tell the application the payment
 * succeeded. It calls the webhook endpoint, exactly as a real provider would, and the
 * backend decides.
 */
export default function MockCheckoutPage() {
  return (
    <React.Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
          <div className="h-80 w-full max-w-md animate-pulse rounded-xl bg-muted" />
        </main>
      }
    >
      <MockCheckout />
    </React.Suspense>
  );
}

function MockCheckout() {
  const params = useParams<{ reference: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();

  const reference = decodeURIComponent(params.reference);
  const amountMinor = Number(searchParams.get('amount') ?? 0);
  const currency = searchParams.get('currency') ?? 'NGN';
  const callback = searchParams.get('callback') ?? '/payments/callback';

  const [submitting, setSubmitting] = React.useState<'success' | 'failed' | null>(null);

  const complete = async (outcome: 'success' | 'failed') => {
    setSubmitting(outcome);
    try {
      const body = JSON.stringify({
        event: outcome === 'success' ? 'charge.success' : 'charge.failed',
        data: {
          reference,
          status: outcome === 'success' ? 'success' : 'failed',
          amount: amountMinor,
          currency,
        },
      });

      // The mock provider signs webhooks the same way Paystack does; the backend
      // derives the expected signature itself, so this endpoint is not a bypass.
      const response = await fetch(`${API_BASE}/payments/webhooks/mock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-mock-signature': await mockSignature(body),
        },
        body,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(payload?.error?.message ?? 'The simulated webhook was rejected.');
      }

      router.push(`${callback}${callback.includes('?') ? '&' : '?'}reference=${encodeURIComponent(reference)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The simulated payment failed.');
      setSubmitting(null);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md">
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" />
              <span className="font-semibold">Mock checkout</span>
            </div>
            <Badge variant="warning">Development only</Badge>
          </div>

          <p className="mt-3 text-sm text-muted-foreground">
            No payment provider credentials are configured, so this simulated checkout stands in for
            Paystack or Flutterwave. Choosing an outcome below sends a signed webhook to the API,
            which then decides what actually happens.
          </p>

          <dl className="mt-6 space-y-2 rounded-lg border p-4 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Reference</dt>
              <dd className="truncate font-mono text-xs">{reference}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="tabular text-lg font-semibold">
                {formatMinor(amountMinor, currency)}
              </dd>
            </div>
          </dl>

          <div className="mt-6 space-y-2">
            <Button
              className="w-full"
              onClick={() => void complete('success')}
              loading={submitting === 'success'}
              disabled={submitting !== null}
            >
              <Lock className="h-4 w-4" />
              Simulate successful payment
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void complete('failed')}
              loading={submitting === 'failed'}
              disabled={submitting !== null}
            >
              Simulate failed payment
            </Button>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          Configure PAYSTACK_SECRET_KEY or FLUTTERWAVE_SECRET_KEY to use a real provider instead.
        </p>
      </div>
    </main>
  );
}

/**
 * Mirrors the mock provider's HMAC-SHA512 scheme using the Web Crypto API.
 *
 * The shared secret is the development JWT secret, which is only ever a known
 * placeholder in development — the mock provider is never selected in production, and
 * the backend refuses to boot in production with a default secret.
 */
async function mockSignature(body: string): Promise<string> {
  const secret =
    process.env.NEXT_PUBLIC_MOCK_WEBHOOK_SECRET ?? 'dev-only-access-secret-change-me-please';

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
