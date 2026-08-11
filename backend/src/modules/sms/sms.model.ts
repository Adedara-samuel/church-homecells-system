import { Schema, model, type Model, type Types } from 'mongoose';
import { SmsDeliveryStatus, SmsProviderName, SmsType } from '../../types/enums';

export interface SmsLogDoc {
  _id: Types.ObjectId;
  member?: Types.ObjectId | null;
  recipientName?: string;
  phone: string;
  type: SmsType;
  message: string;
  provider: SmsProviderName;
  status: SmsDeliveryStatus;
  providerReference?: string | null;
  providerResponse?: Record<string, unknown> | null;
  error?: string | null;
  segments: number;
  /**
   * Guarantees a celebrant is greeted once per occasion even if the job runs twice,
   * e.g. `BIRTHDAY:<memberId>:2026-08-10`.
   */
  dedupeKey?: string | null;
  sentAt?: Date | null;
  deliveredAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const smsLogSchema = new Schema<SmsLogDoc>(
  {
    member: { type: Schema.Types.ObjectId, ref: 'Member', default: null },
    recipientName: { type: String, trim: true, maxlength: 160 },
    phone: { type: String, required: true, trim: true, maxlength: 24 },
    type: { type: String, enum: Object.values(SmsType), required: true },
    message: { type: String, required: true, maxlength: 1000 },
    provider: { type: String, enum: Object.values(SmsProviderName), required: true },
    status: {
      type: String,
      enum: Object.values(SmsDeliveryStatus),
      required: true,
      default: SmsDeliveryStatus.QUEUED,
    },
    providerReference: { type: String, trim: true, default: null },
    providerResponse: { type: Schema.Types.Mixed, default: null },
    error: { type: String, default: null },
    segments: { type: Number, default: 1 },
    dedupeKey: { type: String, default: null },
    sentAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

smsLogSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
smsLogSchema.index({ member: 1, createdAt: -1 });
smsLogSchema.index({ type: 1, status: 1, createdAt: -1 });
smsLogSchema.index({ createdAt: -1 });

export const SmsLog: Model<SmsLogDoc> = model<SmsLogDoc>('SmsLog', smsLogSchema);
