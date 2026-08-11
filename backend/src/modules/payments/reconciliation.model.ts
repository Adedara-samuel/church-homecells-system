import { Schema, model, type Model, type Types } from 'mongoose';
import { PaymentProviderName, ReconciliationStatus } from '../../types/enums';

export interface ReconciliationExceptionDoc {
  payment?: Types.ObjectId | null;
  reference?: string | null;
  providerReference?: string | null;
  status: ReconciliationStatus;
  reason: string;
  internalAmountMinor?: number | null;
  providerAmountMinor?: number | null;
  internalStatus?: string | null;
  providerStatus?: string | null;
  resolved: boolean;
  resolvedBy?: Types.ObjectId | null;
  resolvedAt?: Date | null;
  resolutionNote?: string | null;
}

export interface ReconciliationRunDoc {
  _id: Types.ObjectId;
  provider: PaymentProviderName;
  from: Date;
  to: Date;
  trigger: 'SCHEDULED' | 'MANUAL';
  startedAt: Date;
  completedAt?: Date | null;
  totalChecked: number;
  matched: number;
  mismatched: number;
  orphaned: number;
  unresolved: number;
  exceptions: ReconciliationExceptionDoc[];
  runBy?: Types.ObjectId | null;
  error?: string | null;
}

const exceptionSchema = new Schema<ReconciliationExceptionDoc>(
  {
    payment: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    reference: { type: String, trim: true, default: null },
    providerReference: { type: String, trim: true, default: null },
    status: { type: String, enum: Object.values(ReconciliationStatus), required: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    internalAmountMinor: { type: Number, default: null },
    providerAmountMinor: { type: Number, default: null },
    internalStatus: { type: String, default: null },
    providerStatus: { type: String, default: null },
    resolved: { type: Boolean, default: false },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    resolutionNote: { type: String, trim: true, default: null, maxlength: 500 },
  },
  { _id: true },
);

const runSchema = new Schema<ReconciliationRunDoc>(
  {
    provider: { type: String, enum: Object.values(PaymentProviderName), required: true },
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    trigger: { type: String, enum: ['SCHEDULED', 'MANUAL'], required: true },
    startedAt: { type: Date, required: true, default: () => new Date() },
    completedAt: { type: Date, default: null },
    totalChecked: { type: Number, default: 0 },
    matched: { type: Number, default: 0 },
    mismatched: { type: Number, default: 0 },
    orphaned: { type: Number, default: 0 },
    unresolved: { type: Number, default: 0 },
    exceptions: { type: [exceptionSchema], default: [] },
    runBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    error: { type: String, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

runSchema.index({ provider: 1, startedAt: -1 });
runSchema.index({ startedAt: -1 });

export const ReconciliationRun: Model<ReconciliationRunDoc> = model<ReconciliationRunDoc>(
  'ReconciliationRun',
  runSchema,
);
