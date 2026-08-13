import { Schema, model, type Model, type Types } from 'mongoose';
import { PaymentProviderName, RemittanceChannel, RemittanceStatus } from '../../types/enums';

/**
 * A remittance moves money from a Homecell purse to the General Homecell Purse.
 *
 * SRS 8.6 / BR-011: recording a remittance never edits a balance directly — it produces a
 * DEBIT ledger posting once the business condition for that channel is met:
 *   MANUAL            → posted when an authorised user verifies the uploaded proof
 *   PROVIDER_TRANSFER → posted when the provider webhook confirms a successful transfer
 */
export interface RemittanceDoc {
  _id: Types.ObjectId;
  reference: string;
  homecell: Types.ObjectId;
  area: Types.ObjectId;
  zone: Types.ObjectId;

  /** Calendar date only — what every report, filter and roll-up groups by. */
  date: Date;
  /**
   * The exact moment the coordinator says the money was sent, date *and* time.
   * Kept alongside `date` rather than replacing it so existing day-based reporting
   * is unaffected, and printed on the receipt where the precise time matters.
   */
  /** Absent on records created before this field existed; fall back to `date`. */
  remittedAt?: Date;
  amountMinor: number;
  currency: string;

  channel: RemittanceChannel;
  status: RemittanceStatus;

  /** Free-text bank/transfer reference supplied by the coordinator (manual channel). */
  paymentReference?: string | null;
  receivingAccount: string;
  description?: string;

  /** BR-013: proof of payment attached to the remittance transaction. */
  receiptUrl?: string | null;
  receiptPublicId?: string | null;

  payment?: Types.ObjectId | null;
  paymentProvider?: PaymentProviderName | null;
  providerReference?: string | null;

  ledgerTransaction?: Types.ObjectId | null;

  recordedBy: Types.ObjectId;
  approvedBy?: Types.ObjectId | null;
  approvedAt?: Date | null;
  verifiedBy?: Types.ObjectId | null;
  verifiedAt?: Date | null;
  rejectionReason?: string | null;
  failureReason?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const remittanceSchema = new Schema<RemittanceDoc>(
  {
    reference: { type: String, required: true, trim: true, uppercase: true },
    homecell: { type: Schema.Types.ObjectId, ref: 'Homecell', required: true },
    area: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    zone: { type: Schema.Types.ObjectId, ref: 'Zone', required: true },

    date: { type: Date, required: true },
    // Deliberately not required: remittances recorded before this field existed have
    // no value, and Mongoose validates the whole document on save — making it
    // mandatory would break approving, verifying or reversing any historical record.
    // The hook below fills it in from the calendar date whenever one is missing.
    remittedAt: { type: Date },
    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },

    channel: {
      type: String,
      enum: Object.values(RemittanceChannel),
      required: true,
      default: RemittanceChannel.MANUAL,
    },
    status: {
      type: String,
      enum: Object.values(RemittanceStatus),
      required: true,
      default: RemittanceStatus.PENDING_APPROVAL,
    },

    paymentReference: { type: String, trim: true, default: null, maxlength: 120 },
    receivingAccount: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 400 },

    receiptUrl: { type: String, trim: true, default: null },
    receiptPublicId: { type: String, trim: true, default: null },

    payment: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    paymentProvider: {
      type: String,
      enum: [...Object.values(PaymentProviderName), null],
      default: null,
    },
    providerReference: { type: String, trim: true, default: null },

    ledgerTransaction: { type: Schema.Types.ObjectId, ref: 'LedgerTransaction', default: null },

    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: null, maxlength: 500 },
    failureReason: { type: String, trim: true, default: null, maxlength: 500 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

/**
 * Backfills the exact timestamp for records that predate it, so a historical
 * remittance still prints a sensible date on its receipt. Midday is used rather than
 * midnight: the calendar date is all that was ever known, and midday survives a
 * timezone shift in either direction without moving to the adjacent day.
 */
remittanceSchema.pre('validate', function backfillRemittedAt(next) {
  if (!this.remittedAt && this.date) {
    const midday = new Date(this.date);
    midday.setUTCHours(12, 0, 0, 0);
    this.remittedAt = midday;
  }
  next();
});

remittanceSchema.index({ reference: 1 }, { unique: true });
remittanceSchema.index({ homecell: 1, date: -1 });
remittanceSchema.index({ area: 1, status: 1 });
remittanceSchema.index({ zone: 1, status: 1 });
remittanceSchema.index({ status: 1, createdAt: -1 });
remittanceSchema.index({ providerReference: 1 }, { sparse: true });

export const Remittance: Model<RemittanceDoc> = model<RemittanceDoc>(
  'Remittance',
  remittanceSchema,
);
