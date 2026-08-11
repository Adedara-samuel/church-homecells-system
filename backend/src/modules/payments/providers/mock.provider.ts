import crypto from 'node:crypto';
import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import { PaymentProviderName, PaymentStatus } from '../../../types/enums';
import { safeEqual, sha256 } from '../../../utils/ids';
import type {
  InitializePaymentRequest,
  InitializePaymentResult,
  InitiateTransferRequest,
  InitiateTransferResult,
  PaymentProvider,
  ProviderTransactionRecord,
  VerifyPaymentResult,
  WebhookVerification,
} from './types';

/**
 * Development / demo provider.
 *
 * It implements the same interface and the same *shape* of behaviour as the real
 * providers — including signed webhooks and asynchronous payout confirmation — so the
 * whole payment, webhook, idempotency and reconciliation flow can be exercised end to
 * end with no credentials. It never contacts a network.
 *
 * The mock checkout page is served by the frontend at `/payments/mock/[reference]`,
 * which calls back into the webhook endpoint exactly as a real provider would.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = PaymentProviderName.MOCK;
  readonly supportsPayouts = true;
  readonly isConfigured = true;

  /** Shared secret for the mock webhook signature — deterministic in development. */
  private readonly secret = env.JWT_ACCESS_SECRET;

  private readonly store = new Map<string, { amountMinor: number; currency: string; createdAt: Date }>();

  async initializePayment(request: InitializePaymentRequest): Promise<InitializePaymentResult> {
    this.store.set(request.reference, {
      amountMinor: request.amountMinor,
      currency: request.currency,
      createdAt: new Date(),
    });

    const providerReference = `MOCK-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const authorizationUrl =
      `${env.FRONTEND_URL}/payments/mock/${encodeURIComponent(request.reference)}` +
      `?amount=${request.amountMinor}&currency=${request.currency}` +
      `&callback=${encodeURIComponent(request.callbackUrl)}`;

    logger.info(
      { reference: request.reference, amountMinor: request.amountMinor },
      'Mock payment initialised — open the authorization URL to simulate checkout',
    );

    return {
      providerReference,
      authorizationUrl,
      accessCode: providerReference,
      raw: { mock: true, reference: request.reference },
    };
  }

  async verifyPayment(reference: string): Promise<VerifyPaymentResult> {
    const record = this.store.get(reference);
    return {
      // In-memory state is lost on restart, so an unknown reference is reported as
      // still pending rather than fabricated as successful.
      status: record ? PaymentStatus.SUCCESSFUL : PaymentStatus.PENDING,
      providerStatusRaw: record ? 'success' : 'pending',
      providerReference: reference,
      providerTransactionId: `MOCKTX-${sha256(reference).slice(0, 12).toUpperCase()}`,
      amountMinor: record?.amountMinor ?? null,
      currency: record?.currency ?? null,
      paidAt: record ? new Date() : null,
      failureReason: null,
      raw: { mock: true, reference },
    };
  }

  async initiateTransfer(request: InitiateTransferRequest): Promise<InitiateTransferResult> {
    this.store.set(request.reference, {
      amountMinor: request.amountMinor,
      currency: request.currency,
      createdAt: new Date(),
    });

    logger.info(
      { reference: request.reference, amountMinor: request.amountMinor },
      'Mock payout accepted — awaiting simulated webhook confirmation',
    );

    // Deliberately PROCESSING, never SUCCESSFUL: the payout is only complete when the
    // webhook says so, exactly as with a real provider.
    return {
      status: PaymentStatus.PROCESSING,
      providerReference: `MOCKPO-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
      providerTransactionId: `MOCKPO-${sha256(request.reference).slice(0, 10).toUpperCase()}`,
      providerStatusRaw: 'processing',
      failureReason: null,
      raw: { mock: true, reference: request.reference },
    };
  }

  /** Mirrors Paystack's HMAC-SHA512 scheme so the verification path is genuinely tested. */
  verifySignature(rawBody: Buffer, headers: Record<string, unknown>): boolean {
    const signature = headers['x-mock-signature'];
    if (typeof signature !== 'string') return false;
    const expected = crypto.createHmac('sha512', this.secret).update(rawBody).digest('hex');
    return safeEqual(expected, signature);
  }

  /** Helper used by the frontend mock checkout page and by tests to sign a payload. */
  sign(body: string): string {
    return crypto.createHmac('sha512', this.secret).update(body).digest('hex');
  }

  parseWebhook(payload: Record<string, unknown>, signatureValid: boolean): WebhookVerification {
    const eventType = String(payload.event ?? 'charge.success');
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const reference = (data.reference as string) ?? null;
    const rawStatus = String(data.status ?? 'success');

    const status =
      rawStatus === 'success' || rawStatus === 'successful'
        ? PaymentStatus.SUCCESSFUL
        : rawStatus === 'failed'
          ? PaymentStatus.FAILED
          : rawStatus === 'cancelled'
            ? PaymentStatus.CANCELLED
            : PaymentStatus.PROCESSING;

    return {
      valid: signatureValid,
      eventKey: sha256(`${eventType}:${reference ?? ''}:${rawStatus}`),
      eventType,
      reference,
      status,
      providerStatusRaw: rawStatus,
      providerReference: (data.provider_reference as string) ?? reference,
      amountMinor: typeof data.amount === 'number' ? (data.amount as number) : null,
      currency: (data.currency as string) ?? null,
      failureReason: status === PaymentStatus.SUCCESSFUL ? null : 'Simulated failure',
    };
  }

  async listTransactions(from: Date, to: Date): Promise<ProviderTransactionRecord[]> {
    return [...this.store.entries()]
      .filter(([, v]) => v.createdAt >= from && v.createdAt <= to)
      .map(([reference, v]) => ({
        reference,
        providerReference: reference,
        status: PaymentStatus.SUCCESSFUL,
        providerStatusRaw: 'success',
        amountMinor: v.amountMinor,
        currency: v.currency,
        createdAt: v.createdAt,
      }));
  }
}
