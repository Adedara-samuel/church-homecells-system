import type { PaymentProviderName, PaymentStatus } from '../../../types/enums';

/**
 * The contract every payment provider implements.
 *
 * The finance module depends only on this interface, so adding a provider means adding
 * one file — nothing in the ledger, remittance or webhook layers changes.
 */

export interface InitializePaymentRequest {
  reference: string;
  amountMinor: number;
  currency: string;
  email: string;
  name?: string;
  phone?: string;
  description?: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

export interface InitializePaymentResult {
  providerReference: string | null;
  authorizationUrl: string | null;
  accessCode: string | null;
  raw: Record<string, unknown>;
}

export interface VerifyPaymentResult {
  status: PaymentStatus;
  providerStatusRaw: string;
  providerReference: string | null;
  providerTransactionId: string | null;
  amountMinor: number | null;
  currency: string | null;
  paidAt: Date | null;
  failureReason: string | null;
  raw: Record<string, unknown>;
}

export interface TransferRecipient {
  accountNumber: string;
  bankCode: string;
  accountName: string;
}

export interface InitiateTransferRequest {
  reference: string;
  amountMinor: number;
  currency: string;
  narration: string;
  recipient: TransferRecipient;
  metadata?: Record<string, unknown>;
}

export interface InitiateTransferResult {
  status: PaymentStatus;
  providerReference: string | null;
  providerTransactionId: string | null;
  providerStatusRaw: string;
  failureReason: string | null;
  raw: Record<string, unknown>;
}

export interface WebhookVerification {
  valid: boolean;
  /** Stable key used to deduplicate repeated deliveries of the same event. */
  eventKey: string;
  eventType: string;
  /** Our reference, extracted from the provider's payload shape. */
  reference: string | null;
  status: PaymentStatus | null;
  providerStatusRaw: string | null;
  providerReference: string | null;
  amountMinor: number | null;
  currency: string | null;
  failureReason: string | null;
}

export interface ProviderTransactionRecord {
  reference: string | null;
  providerReference: string | null;
  status: PaymentStatus;
  providerStatusRaw: string;
  amountMinor: number;
  currency: string;
  createdAt: Date | null;
}

export interface PaymentProvider {
  readonly name: PaymentProviderName;
  /** False when credentials are absent — the API surfaces this in settings. */
  readonly isConfigured: boolean;
  /** Not every provider supports outbound disbursement in every account tier. */
  readonly supportsPayouts: boolean;

  initializePayment(request: InitializePaymentRequest): Promise<InitializePaymentResult>;
  verifyPayment(reference: string): Promise<VerifyPaymentResult>;
  initiateTransfer(request: InitiateTransferRequest): Promise<InitiateTransferResult>;
  verifySignature(rawBody: Buffer, headers: Record<string, unknown>): boolean;
  parseWebhook(payload: Record<string, unknown>, signatureValid: boolean): WebhookVerification;
  /** Used by reconciliation to compare our records against the provider's. */
  listTransactions(from: Date, to: Date): Promise<ProviderTransactionRecord[]>;
}
