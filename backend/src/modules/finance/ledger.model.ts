import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  ApprovalStatus,
  PaymentProviderName,
  TRANSACTION_TYPES,
  TransactionDirection,
  TransactionStatus,
  TransactionType,
} from '../../types/enums';

/**
 * The Homecell purse is **not** a stored number. It is the fold of this collection.
 *
 * Rules enforced here and in `ledger.service.ts`:
 *  - A posted entry is immutable. Corrections happen through REVERSAL / ADJUSTMENT
 *    entries that reference the original (BR-016, SRS §8.8).
 *  - `amountMinor` is always a positive integer; `direction` carries the sign.
 *  - `idempotencyKey` is globally unique, so a retried request or a webhook replayed
 *    three times can only ever produce one entry.
 */
export interface LedgerTransactionDoc {
  _id: Types.ObjectId;
  transactionRef: string;
  idempotencyKey: string;

  homecell: Types.ObjectId;
  area: Types.ObjectId;
  zone: Types.ObjectId;
  member?: Types.ObjectId | null;

  type: TransactionType;
  direction: TransactionDirection;
  amountMinor: number;
  currency: string;
  status: TransactionStatus;

  /** Calendar date the money moved (may differ from createdAt). */
  valueDate: Date;
  description: string;
  reference?: string;
  metadata: Record<string, unknown>;

  /** Link back to the source document that produced this posting. */
  sourceModel?: 'Offering' | 'Expense' | 'Remittance' | 'Payment' | 'DuesInvoice' | null;
  sourceId?: Types.ObjectId | null;

  paymentProvider?: PaymentProviderName | null;
  providerReference?: string | null;

  supportingDocumentUrl?: string | null;

  approvalStatus: ApprovalStatus;
  createdBy?: Types.ObjectId | null;
  approvedBy?: Types.ObjectId | null;
  approvedAt?: Date | null;

  /** Set on the original when it is reversed; set on the reversal to point back. */
  reversalOf?: Types.ObjectId | null;
  reversedBy?: Types.ObjectId | null;
  reversedAt?: Date | null;
  reversalReason?: string | null;

  postedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;

  signedAmountMinor: number;
}

const ledgerSchema = new Schema<LedgerTransactionDoc>(
  {
    transactionRef: { type: String, required: true, trim: true, uppercase: true },
    idempotencyKey: { type: String, required: true, trim: true },

    homecell: { type: Schema.Types.ObjectId, ref: 'Homecell', required: true },
    area: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    zone: { type: Schema.Types.ObjectId, ref: 'Zone', required: true },
    member: { type: Schema.Types.ObjectId, ref: 'Member', default: null },

    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    direction: {
      type: String,
      enum: Object.values(TransactionDirection),
      required: true,
    },
    amountMinor: {
      type: Number,
      required: true,
      min: [1, 'Transaction amount must be greater than zero'],
      validate: {
        validator: Number.isInteger,
        message: 'Transaction amount must be an integer number of minor units (kobo)',
      },
    },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    status: {
      type: String,
      enum: Object.values(TransactionStatus),
      required: true,
      default: TransactionStatus.POSTED,
    },

    valueDate: { type: Date, required: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    reference: { type: String, trim: true, maxlength: 120 },
    metadata: { type: Schema.Types.Mixed, default: {} },

    sourceModel: {
      type: String,
      enum: ['Offering', 'Expense', 'Remittance', 'Payment', 'DuesInvoice', null],
      default: null,
    },
    sourceId: { type: Schema.Types.ObjectId, default: null },

    paymentProvider: {
      type: String,
      enum: [...Object.values(PaymentProviderName), null],
      default: null,
    },
    providerReference: { type: String, trim: true, default: null },

    supportingDocumentUrl: { type: String, trim: true, default: null },

    approvalStatus: {
      type: String,
      enum: Object.values(ApprovalStatus),
      default: ApprovalStatus.NOT_REQUIRED,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },

    reversalOf: { type: Schema.Types.ObjectId, ref: 'LedgerTransaction', default: null },
    reversedBy: { type: Schema.Types.ObjectId, ref: 'LedgerTransaction', default: null },
    reversedAt: { type: Date, default: null },
    reversalReason: { type: String, trim: true, default: null },

    postedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

ledgerSchema.virtual('signedAmountMinor').get(function (this: LedgerTransactionDoc) {
  return this.direction === TransactionDirection.CREDIT ? this.amountMinor : -this.amountMinor;
});

ledgerSchema.index({ transactionRef: 1 }, { unique: true });
ledgerSchema.index({ idempotencyKey: 1 }, { unique: true });
ledgerSchema.index({ homecell: 1, status: 1, valueDate: -1 });
ledgerSchema.index({ homecell: 1, type: 1, valueDate: -1 });
ledgerSchema.index({ area: 1, status: 1, valueDate: -1 });
ledgerSchema.index({ zone: 1, status: 1, valueDate: -1 });
ledgerSchema.index({ providerReference: 1 }, { sparse: true });
ledgerSchema.index({ sourceModel: 1, sourceId: 1 });
ledgerSchema.index({ valueDate: -1 });

/**
 * Immutability guard. Only the small set of fields involved in the reversal handshake
 * and status transitions may ever be written after creation.
 */
const MUTABLE_AFTER_POST = new Set([
  'status',
  'reversedBy',
  'reversedAt',
  'reversalReason',
  'approvalStatus',
  'approvedBy',
  'approvedAt',
  'postedAt',
  'providerReference',
  'supportingDocumentUrl',
  'metadata',
  'updatedAt',
]);

ledgerSchema.pre('save', function (next) {
  if (this.isNew) {
    if (!this.postedAt && this.status === TransactionStatus.POSTED) this.postedAt = new Date();
    return next();
  }
  const illegal = this.modifiedPaths().filter((p) => !MUTABLE_AFTER_POST.has(p.split('.')[0]));
  if (illegal.length) {
    return next(
      new Error(
        `Ledger transactions are immutable. Use a reversal or adjustment instead. ` +
          `Attempted to modify: ${illegal.join(', ')}`,
      ),
    );
  }
  next();
});

export const LedgerTransaction: Model<LedgerTransactionDoc> = model<LedgerTransactionDoc>(
  'LedgerTransaction',
  ledgerSchema,
);

/** A live document with Mongoose instance methods (`save`, `markModified`, …). */
export type LedgerTransactionDocument = HydratedDocument<LedgerTransactionDoc>;
