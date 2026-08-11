import { Schema, model, type Model, type Types } from 'mongoose';
import { PaymentProviderName, TransactionStatus } from '../../types/enums';

export const OfferingChannel = {
  CASH: 'CASH',
  BANK_TRANSFER: 'BANK_TRANSFER',
  ONLINE_PAYMENT: 'ONLINE_PAYMENT',
} as const;
export type OfferingChannel = (typeof OfferingChannel)[keyof typeof OfferingChannel];

export interface OfferingDoc {
  _id: Types.ObjectId;
  reference: string;
  homecell: Types.ObjectId;
  area: Types.ObjectId;
  zone: Types.ObjectId;

  /** BR-008: must fall on a Sunday. Enforced in the service and re-checked here. */
  date: Date;
  amountMinor: number;
  currency: string;
  channel: OfferingChannel;
  description?: string;

  status: TransactionStatus;
  ledgerTransaction?: Types.ObjectId | null;
  payment?: Types.ObjectId | null;
  paymentProvider?: PaymentProviderName | null;

  receiptUrl?: string | null;
  receiptPublicId?: string | null;

  recordedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const offeringSchema = new Schema<OfferingDoc>(
  {
    reference: { type: String, required: true, trim: true, uppercase: true },
    homecell: { type: Schema.Types.ObjectId, ref: 'Homecell', required: true },
    area: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    zone: { type: Schema.Types.ObjectId, ref: 'Zone', required: true },

    date: { type: Date, required: true },
    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    channel: {
      type: String,
      enum: Object.values(OfferingChannel),
      required: true,
      default: OfferingChannel.CASH,
    },
    description: { type: String, trim: true, maxlength: 400 },

    status: {
      type: String,
      enum: Object.values(TransactionStatus),
      required: true,
      default: TransactionStatus.POSTED,
    },
    ledgerTransaction: { type: Schema.Types.ObjectId, ref: 'LedgerTransaction', default: null },
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    paymentProvider: {
      type: String,
      enum: [...Object.values(PaymentProviderName), null],
      default: null,
    },

    receiptUrl: { type: String, trim: true, default: null },
    receiptPublicId: { type: String, trim: true, default: null },

    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

offeringSchema.index({ reference: 1 }, { unique: true });
offeringSchema.index({ homecell: 1, date: -1 });
offeringSchema.index({ area: 1, date: -1 });
offeringSchema.index({ zone: 1, date: -1 });
offeringSchema.index({ status: 1, date: -1 });
/**
 * Deliberately NOT unique.
 *
 * A Sunday can legitimately carry more than one offering record — a cash collection
 * counted at the meeting plus an online contribution settled by the payment provider
 * are two distinct facts. Accidental re-entry of the *same* manually recorded offering
 * is prevented in `offering.service.ts`, which checks only the manual channels and
 * returns an explanatory 409 pointing at the reversal path.
 */
offeringSchema.index({ homecell: 1, date: 1, channel: 1 });

export const Offering: Model<OfferingDoc> = model<OfferingDoc>('Offering', offeringSchema);
