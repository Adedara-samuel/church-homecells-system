import { env } from '../../../config/env';
import { logger } from '../../../config/logger';
import { PaymentProviderName, PaymentStatus } from '../../../types/enums';
import { ProviderError, UnsupportedOperationError } from '../../../utils/errors';
import { safeEqual, sha256 } from '../../../utils/ids';
import { toMajor, toMinor } from '../../../utils/money';
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

function mapStatus(raw: string | undefined): PaymentStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'successful':
    case 'success':
    case 'completed':
      return PaymentStatus.SUCCESSFUL;
    case 'failed':
      return PaymentStatus.FAILED;
    case 'cancelled':
      return PaymentStatus.CANCELLED;
    case 'pending':
    case 'new':
      return PaymentStatus.PENDING;
    case 'processing':
      return PaymentStatus.PROCESSING;
    default:
      return PaymentStatus.PENDING;
  }
}

/**
 * Flutterwave quotes amounts in **major** units, unlike Paystack. All conversion is
 * confined to this class so the rest of the system only ever deals in minor units.
 */
export class FlutterwaveProvider implements PaymentProvider {
  readonly name = PaymentProviderName.FLUTTERWAVE;
  readonly supportsPayouts = true;

  private readonly secretKey = env.FLUTTERWAVE_SECRET_KEY ?? '';
  private readonly baseUrl = env.FLUTTERWAVE_BASE_URL;

  get isConfigured(): boolean {
    return this.secretKey.length > 0;
  }

  private async request<T>(
    path: string,
    init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
  ): Promise<T> {
    if (!this.isConfigured) {
      throw new ProviderError('Flutterwave', 'FLUTTERWAVE_SECRET_KEY is not configured.');
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
        status?: string;
        message?: string;
        data?: unknown;
      };

      if (!response.ok || json.status === 'error') {
        throw new ProviderError(
          'Flutterwave',
          json.message ?? `Request failed (${response.status})`,
          { path, httpStatus: response.status },
        );
      }
      return json as T;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      if ((err as Error).name === 'AbortError') {
        throw new ProviderError('Flutterwave', 'The request timed out.');
      }
      throw new ProviderError('Flutterwave', (err as Error).message);
    } finally {
      clearTimeout(timeout);
    }
  }

  async initializePayment(request: InitializePaymentRequest): Promise<InitializePaymentResult> {
    const json = await this.request<{ data: { link: string } }>('/payments', {
      method: 'POST',
      body: {
        tx_ref: request.reference,
        amount: toMajor(request.amountMinor),
        currency: request.currency,
        redirect_url: request.callbackUrl,
        customer: {
          email: request.email,
          name: request.name,
          phonenumber: request.phone,
        },
        customizations: {
          title: 'Church Homecell',
          description: request.description ?? 'Homecell contribution',
        },
        meta: request.metadata ?? {},
      },
    });

    return {
      providerReference: request.reference,
      authorizationUrl: json.data.link,
      accessCode: null,
      raw: json.data as unknown as Record<string, unknown>,
    };
  }

  async verifyPayment(reference: string): Promise<VerifyPaymentResult> {
    const json = await this.request<{
      data: {
        id: number;
        tx_ref: string;
        flw_ref: string;
        status: string;
        amount: number;
        currency: string;
        created_at: string;
        processor_response: string | null;
      };
    }>(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);

    const data = json.data;
    const status = mapStatus(data.status);
    return {
      status,
      providerStatusRaw: data.status,
      providerReference: data.flw_ref ?? data.tx_ref,
      providerTransactionId: data.id ? String(data.id) : null,
      amountMinor: typeof data.amount === 'number' ? toMinor(data.amount) : null,
      currency: data.currency ?? null,
      paidAt: data.created_at ? new Date(data.created_at) : null,
      failureReason: status === PaymentStatus.SUCCESSFUL ? null : data.processor_response ?? null,
      raw: data as unknown as Record<string, unknown>,
    };
  }

  async initiateTransfer(request: InitiateTransferRequest): Promise<InitiateTransferResult> {
    if (!this.isConfigured) {
      throw new UnsupportedOperationError('Flutterwave payouts require FLUTTERWAVE_SECRET_KEY.');
    }

    const json = await this.request<{
      data: { id: number; reference: string; status: string; complete_message: string | null };
    }>('/transfers', {
      method: 'POST',
      body: {
        account_bank: request.recipient.bankCode,
        account_number: request.recipient.accountNumber,
        amount: toMajor(request.amountMinor),
        currency: request.currency,
        narration: request.narration,
        reference: request.reference,
        beneficiary_name: request.recipient.accountName,
        meta: request.metadata ?? {},
      },
    });

    const data = json.data;
    return {
      status:
        mapStatus(data.status) === PaymentStatus.SUCCESSFUL
          ? PaymentStatus.PROCESSING
          : mapStatus(data.status),
      providerReference: data.reference,
      providerTransactionId: data.id ? String(data.id) : null,
      providerStatusRaw: data.status,
      failureReason: data.complete_message ?? null,
      raw: data as unknown as Record<string, unknown>,
    };
  }

  verifySignature(_rawBody: Buffer, headers: Record<string, unknown>): boolean {
    // Flutterwave sends a shared secret hash rather than an HMAC of the body.
    const secret = env.FLUTTERWAVE_WEBHOOK_SECRET;
    if (!secret) return false;
    const provided = headers['verif-hash'] ?? headers['verif_hash'];
    if (typeof provided !== 'string') return false;
    return safeEqual(secret, provided);
  }

  parseWebhook(payload: Record<string, unknown>, signatureValid: boolean): WebhookVerification {
    const eventType = String(payload.event ?? payload['event.type'] ?? 'unknown');
    const data = (payload.data ?? {}) as Record<string, unknown>;

    const reference = (data.tx_ref as string) ?? (data.reference as string) ?? null;
    const rawStatus = (data.status as string) ?? null;
    const eventKey = sha256(
      `${eventType}:${reference ?? ''}:${rawStatus ?? ''}:${String(data.id ?? '')}`,
    );

    return {
      valid: signatureValid,
      eventKey,
      eventType,
      reference,
      status: mapStatus(rawStatus ?? undefined),
      providerStatusRaw: rawStatus,
      providerReference: (data.flw_ref as string) ?? reference,
      amountMinor: typeof data.amount === 'number' ? toMinor(data.amount as number) : null,
      currency: (data.currency as string) ?? null,
      failureReason:
        mapStatus(rawStatus ?? undefined) === PaymentStatus.SUCCESSFUL
          ? null
          : ((data.processor_response as string) ?? (data.complete_message as string) ?? null),
    };
  }

  async listTransactions(from: Date, to: Date): Promise<ProviderTransactionRecord[]> {
    const params = new URLSearchParams({
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
    });
    const json = await this.request<{
      data: {
        tx_ref: string;
        flw_ref: string;
        status: string;
        amount: number;
        currency: string;
        created_at: string;
      }[];
    }>(`/transactions?${params.toString()}`);

    logger.debug(
      { count: json.data?.length ?? 0 },
      'Fetched Flutterwave transactions for reconciliation',
    );

    return (json.data ?? []).map((t) => ({
      reference: t.tx_ref,
      providerReference: t.flw_ref,
      status: mapStatus(t.status),
      providerStatusRaw: t.status,
      amountMinor: toMinor(t.amount),
      currency: t.currency,
      createdAt: t.created_at ? new Date(t.created_at) : null,
    }));
  }
}
