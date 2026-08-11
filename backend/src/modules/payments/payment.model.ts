import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  PAYMENT_STATUSES,
  PaymentDirection,
  PaymentProviderName,
  PaymentPurpose,
  PaymentStatus,
  ReconciliationStatus,
} from '../../types/enums';

export interface PaymentStatusHistoryEntry {
  status: PaymentStatus;
  at: Date;
  source: 'SYSTEM' | 'WEBHOOK' | 'VERIFICATION' | 'MANUAL';
  note?: string;
}

export interface PaymentDoc {
  _id: Types.ObjectId;
  /** Our reference — the value sent to and echoed back by the provider. */
  reference: string;
  idempotencyKey: string;

  direction: PaymentDirection;
  purpose: PaymentPurpose;
  provider: PaymentProviderName;

  homecell: Types.ObjectId;
  area: Types.ObjectId;
  zone: Types.ObjectId;
  member?: Types.ObjectId | null;

  amountMinor: number;
  currency: string;
  status: PaymentStatus;

  customerEmail?: string;
  customerName?: string;
  customerPhone?: string;
  description?: string;

  /** Provider-side identifiers captured as soon as they are known. */
  providerReference?: string | null;
  providerTransactionId?: string | null;
  authorizationUrl?: string | null;
  accessCode?: string | null;

  /** Amount the provider says was actually settled — drives reconciliation. */
  providerAmountMinor?: number | null;
  providerStatusRaw?: string | null;
  providerResponse?: Record<string, unknown> | null;
  failureReason?: string | null;

  reconciliationStatus: ReconciliationStatus;
  reconciledAt?: Date | null;
  reconciledBy?: Types.ObjectId | null;
  reconciliationNote?: string | null;

  /** Populated once the payment has been folded into the ledger. */
  ledgerTransaction?: Types.ObjectId | null;
  relatedModel?: 'Offering' | 'Remittance' | null;
  relatedId?: Types.ObjectId | null;

  statusHistory: PaymentStatusHistoryEntry[];

  initiatedBy?: Types.ObjectId | null;
  approvedBy?: Types.ObjectId | null;
  approvedAt?: Date | null;
  completedAt?: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

const historySchema = new Schema<PaymentStatusHistoryEntry>(
  {
    status: { type: String, enum: PAYMENT_STATUSES, required: true },
    at: { type: Date, required: true, default: () => new Date() },
    source: {
      type: String,
      enum: ['SYSTEM', 'WEBHOOK', 'VERIFICATION', 'MANUAL'],
      required: true,
    },
    note: { type: String, trim: true, maxlength: 300 },
  },
  { _id: false },
);

const paymentSchema = new Schema<PaymentDoc>(
  {
    reference: { type: String, required: true, trim: true },
    idempotencyKey: { type: String, required: true, trim: true },

    direction: { type: String, enum: Object.values(PaymentDirection), required: true },
    purpose: { type: String, enum: Object.values(PaymentPurpose), required: true },
    provider: { type: String, enum: Object.values(PaymentProviderName), required: true },

    homecell: { type: Schema.Types.ObjectId, ref: 'Homecell', required: true },
    area: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    zone: { type: Schema.Types.ObjectId, ref: 'Zone', required: true },
    member: { type: Schema.Types.ObjectId, ref: 'Member', default: null },

    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    status: {
      type: String,
      enum: PAYMENT_STATUSES,
      required: true,
      default: PaymentStatus.PENDING,
    },

    customerEmail: { type: String, trim: true, lowercase: true, maxlength: 160 },
    customerName: { type: String, trim: true, maxlength: 160 },
    customerPhone: { type: String, trim: true, maxlength: 24 },
    description: { type: String, trim: true, maxlength: 400 },

    providerReference: { type: String, trim: true, default: null },
    providerTransactionId: { type: String, trim: true, default: null },
    authorizationUrl: { type: String, trim: true, default: null },
    accessCode: { type: String, trim: true, default: null },

    providerAmountMinor: { type: Number, default: null },
    providerStatusRaw: { type: String, trim: true, default: null },
    providerResponse: { type: Schema.Types.Mixed, default: null },
    failureReason: { type: String, trim: true, default: null, maxlength: 500 },

    reconciliationStatus: {
      type: String,
      enum: Object.values(ReconciliationStatus),
      default: ReconciliationStatus.UNRECONCILED,
    },
    reconciledAt: { type: Date, default: null },
    reconciledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reconciliationNote: { type: String, trim: true, default: null, maxlength: 500 },

    ledgerTransaction: { type: Schema.Types.ObjectId, ref: 'LedgerTransaction', default: null },
    relatedModel: { type: String, enum: ['Offering', 'Remittance', null], default: null },
    relatedId: { type: Schema.Types.ObjectId, default: null },

    statusHistory: { type: [historySchema], default: [] },

    initiatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

paymentSchema.index({ reference: 1 }, { unique: true });
paymentSchema.index({ idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ providerReference: 1 }, { sparse: true });
paymentSchema.index({ provider: 1, status: 1, createdAt: -1 });
paymentSchema.index({ homecell: 1, createdAt: -1 });
paymentSchema.index({ area: 1, createdAt: -1 });
paymentSchema.index({ zone: 1, createdAt: -1 });
paymentSchema.index({ reconciliationStatus: 1, createdAt: -1 });
paymentSchema.index({ direction: 1, status: 1 });

export const Payment: Model<PaymentDoc> = model<PaymentDoc>('Payment', paymentSchema);

/** A live document with Mongoose instance methods (`save`, `markModified`, …). */
export type PaymentDocument = HydratedDocument<PaymentDoc>;

// ---------------------------------------------------------------------------
// Webhook event log — the duplicate-delivery guard (SRS §42)
// ---------------------------------------------------------------------------

export interface WebhookEventDoc {
  _id: Types.ObjectId;
  provider: PaymentProviderName;
  /** Provider event id when available, otherwise a hash of the raw body. */
  eventKey: string;
  eventType: string;
  signatureValid: boolean;
  payload: Record<string, unknown>;
  processed: boolean;
  processedAt?: Date | null;
  paymentReference?: string | null;
  payment?: Types.ObjectId | null;
  error?: string | null;
  receivedAt: Date;
  deliveryCount: number;
}

const webhookSchema = new Schema<WebhookEventDoc>(
  {
    provider: { type: String, enum: Object.values(PaymentProviderName), required: true },
    eventKey: { type: String, required: true, trim: true },
    eventType: { type: String, required: true, trim: true },
    signatureValid: { type: Boolean, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    processed: { type: Boolean, default: false },
    processedAt: { type: Date, default: null },
    paymentReference: { type: String, trim: true, default: null },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    error: { type: String, default: null },
    receivedAt: { type: Date, required: true, default: () => new Date() },
    deliveryCount: { type: Number, default: 1 },
  },
  { versionKey: false },
);

/** The uniqueness that makes replayed webhooks harmless. */
webhookSchema.index({ provider: 1, eventKey: 1 }, { unique: true });
webhookSchema.index({ receivedAt: -1 });
webhookSchema.index({ processed: 1, receivedAt: -1 });

export const WebhookEvent: Model<WebhookEventDoc> = model<WebhookEventDoc>(
  'WebhookEvent',
  webhookSchema,
);
