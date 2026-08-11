import crypto from 'node:crypto';
import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import { PaymentProviderName, PaymentStatus } from '../../../types/enums';
import { ProviderError, UnsupportedOperationError } from '../../../utils/errors';
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

/** Paystack's transaction states mapped onto our own status vocabulary. */
function mapStatus(raw: string | undefined): PaymentStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'success':
    case 'successful':
      return PaymentStatus.SUCCESSFUL;
    case 'failed':
      return PaymentStatus.FAILED;
    case 'abandoned':
    case 'cancelled':
      return PaymentStatus.CANCELLED;
    case 'reversed':
      return PaymentStatus.REVERSED;
    case 'ongoing':
    case 'pending':
    case 'processing':
    case 'queued':
      return PaymentStatus.PROCESSING;
    default:
      return PaymentStatus.PENDING;
  }
}

export class PaystackProvider implements PaymentProvider {
  readonly name = PaymentProviderName.PAYSTACK;
  readonly supportsPayouts = true;

  private readonly secretKey = env.PAYSTACK_SECRET_KEY ?? '';
  private readonly baseUrl = env.PAYSTACK_BASE_URL;

  get isConfigured(): boolean {
    return this.secretKey.length > 0;
  }

  private async request<T>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
  ): Promise<T> {
    if (!this.isConfigured) {
      throw new ProviderError('Paystack', 'PAYSTACK_SECRET_KEY is not configured.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.secretKey}`,
          'Content-Type': 'application/json',
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });

      const json = (await response.json().catch(() => ({}))) as {
        status?: boolean;
        message?: string;
        data?: unknown;
      };

      if (!response.ok || json.status === false) {
        throw new ProviderError('Paystack', json.message ?? `Request failed (${response.status})`, {
          path,
          httpStatus: response.status,
        });
      }
      return json as T;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new ProviderError('Paystack', 'The request timed out.');
      }
      throw new ProviderError('Paystack', (err as Error).message);
    } finally {
      clearTimeout(timeout);
    }
  }

  async initializePayment(request: InitializePaymentRequest): Promise<InitializePaymentResult> {
    const json = await this.request<{
      data: { authorization_url: string; access_code: string; reference: string };
    }>('/transaction/initialize', {
      method: 'POST',
      body: {
        // Paystack amounts are already in minor units for NGN.
        amount: request.amountMinor,
        email: request.email,
        currency: request.currency,
        reference: request.reference,
        callback_url: request.callbackUrl,
        metadata: {
          ...request.metadata,
          custom_fields: [
            { display_name: 'Description', variable_name: 'description', value: request.description ?? '' },
          ],
        },
      },
    });

    return {
      providerReference: json.data.reference ?? request.reference,
      authorizationUrl: json.data.authorization_url,
      accessCode: json.data.access_code,
      raw: json.data as unknown as Record<string, unknown>,
    };
  }

  async verifyPayment(reference: string): Promise<VerifyPaymentResult> {
    const json = await this.request<{
      data: {
        status: string;
        reference: string;
        id: number;
        amount: number;
        currency: string;
        paid_at: string | null;
        gateway_response: string | null;
      };
    }>(`/transaction/verify/${encodeURIComponent(reference)}`);

    const data = json.data;
    const status = mapStatus(data.status);
    return {
      status,
      providerStatusRaw: data.status,
      providerReference: data.reference,
      providerTransactionId: data.id ? String(data.id) : null,
      amountMinor: typeof data.amount === 'number' ? data.amount : null,
      currency: data.currency ?? null,
      paidAt: data.paid_at ? new Date(data.paid_at) : null,
      failureReason: status === PaymentStatus.SUCCESSFUL ? null : data.gateway_response ?? null,
      raw: data as unknown as Record<string, unknown>,
    };
  }

  async initiateTransfer(request: InitiateTransferRequest): Promise<InitiateTransferResult> {
    if (!this.isConfigured) {
      throw new UnsupportedOperationError('Paystack payouts require PAYSTACK_SECRET_KEY.');
    }

    // Paystack payouts are a two-step flow: create a recipient, then transfer to it.
    const recipient = await this.request<{ data: { recipient_code: string } }>(
      '/transferrecipient',
      {
        method: 'POST',
        body: {
          type: 'nuban',
          name: request.recipient.accountName,
          account_number: request.recipient.accountNumber,
          bank_code: request.recipient.bankCode,
          currency: request.currency,
        },
      },
    );

    const transfer = await this.request<{
      data: { status: string; transfer_code: string; id: number; reference: string };
    }>('/transfer', {
      method: 'POST',
      body: {
        source: 'balance',
        amount: request.amountMinor,
        recipient: recipient.data.recipient_code,
        reason: request.narration,
        reference: request.reference,
        currency: request.currency,
      },
    });

    const data = transfer.data;
    return {
      // A transfer is never "successful" on submission — the webhook decides.
      status: mapStatus(data.status) === PaymentStatus.SUCCESSFUL
        ? PaymentStatus.PROCESSING
        : mapStatus(data.status),
      providerReference: data.reference ?? data.transfer_code,
      providerTransactionId: data.id ? String(data.id) : data.transfer_code,
      providerStatusRaw: data.status,
      failureReason: null,
      raw: data as unknown as Record<string, unknown>,
    };
  }

  verifySignature(rawBody: Buffer, headers: Record<string, unknown>): boolean {
    const secret = env.PAYSTACK_WEBHOOK_SECRET || this.secretKey;
    if (!secret) return false;
    const signature = headers['x-paystack-signature'];
    if (typeof signature !== 'string') return false;

    const expected = crypto.createHmac('sha512', secret).update(rawBody).digest('hex');
    return safeEqual(expected, signature);
  }

  parseWebhook(payload: Record<string, unknown>, signatureValid: boolean): WebhookVerification {
    const eventType = String(payload.event ?? 'unknown');
    const data = (payload.data ?? {}) as Record<string, unknown>;
    const reference = (data.reference as string) ?? null;
    const rawStatus = (data.status as string) ?? null;

    // Paystack does not send an event id, so the event is keyed on its content.
    const eventKey = sha256(`${eventType}:${reference ?? ''}:${rawStatus ?? ''}:${String(data.id ?? '')}`);

    // A `transfer.*` event describes an outbound payout; `charge.*` an inbound payment.
    const status = eventType.startsWith('transfer.')
      ? eventType === 'transfer.success'
        ? PaymentStatus.SUCCESSFUL
        : eventType === 'transfer.failed'
          ? PaymentStatus.FAILED
          : eventType === 'transfer.reversed'
            ? PaymentStatus.REVERSED
            : mapStatus(rawStatus ?? undefined)
      : mapStatus(rawStatus ?? undefined);

    return {
      valid: signatureValid,
      eventKey,
      eventType,
      reference,
      status,
      providerStatusRaw: rawStatus,
      providerReference: reference,
      amountMinor: typeof data.amount === 'number' ? (data.amount as number) : null,
      currency: (data.currency as string) ?? null,
      failureReason:
        status === PaymentStatus.SUCCESSFUL
          ? null
          : ((data.gateway_response as string) ?? (data.reason as string) ?? null),
    };
  }

  async listTransactions(from: Date, to: Date): Promise<ProviderTransactionRecord[]> {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
      perPage: '200',
    });
    const json = await this.request<{
      data: {
        reference: string;
        id: number;
        status: string;
        amount: number;
        currency: string;
        created_at: string;
      }[];
    }>(`/transaction?${params.toString()}`);

    logger.debug({ count: json.data?.length ?? 0 }, 'Fetched Paystack transactions for reconciliation');

    return (json.data ?? []).map((t) => ({
      reference: t.reference,
      providerReference: t.reference,
      status: mapStatus(t.status),
      providerStatusRaw: t.status,
      amountMinor: t.amount,
      currency: t.currency,
      createdAt: t.created_at ? new Date(t.created_at) : null,
    }));
  }
}
