import { Schema, model, type Model, type Types } from 'mongoose';

/**
 * A record of every email the system attempts.
 *
 * The `dedupeKey` unique index is the important part: the celebration job runs daily,
 * and a retry or a double invocation must not greet the same person twice. The guard
 * is the database, not a prior read, so it holds even if two runs overlap.
 */
export interface MailLogDoc {
  _id: Types.ObjectId;
  to: string;
  subject: string;
  type: string;
  member?: Types.ObjectId | null;
  recipientName?: string | null;

  status: 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';
  transport: string;
  messageId?: string | null;
  error?: string | null;
  dedupeKey?: string | null;

  sentAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const mailLogSchema = new Schema<MailLogDoc>(
  {
    to: { type: String, required: true, trim: true, lowercase: true, maxlength: 320 },
    subject: { type: String, required: true, trim: true, maxlength: 300 },
    type: { type: String, required: true, trim: true, maxlength: 40 },
    member: { type: Schema.Types.ObjectId, ref: 'Member', default: null },
    recipientName: { type: String, trim: true, default: null, maxlength: 160 },

    status: {
      type: String,
      enum: ['QUEUED', 'SENT', 'FAILED', 'SKIPPED'],
      required: true,
      default: 'QUEUED',
    },
    transport: { type: String, required: true, trim: true, maxlength: 40 },
    messageId: { type: String, trim: true, default: null },
    error: { type: String, trim: true, default: null, maxlength: 500 },
    dedupeKey: { type: String, trim: true, default: null },

    sentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

mailLogSchema.index({ dedupeKey: 1 }, { unique: true, sparse: true });
mailLogSchema.index({ createdAt: -1 });
mailLogSchema.index({ member: 1, createdAt: -1 });
mailLogSchema.index({ status: 1, createdAt: -1 });

export const MailLog: Model<MailLogDoc> = model<MailLogDoc>('MailLog', mailLogSchema);
