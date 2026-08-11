import { Schema, model, type Model, type Types } from 'mongoose';
import { TransferApprovalStage, TransferScope, TransferStatus } from '../../types/enums';

export interface TransferApprovalStep {
  stage: TransferApprovalStage;
  approver?: Types.ObjectId | null;
  decidedAt?: Date | null;
  decision?: 'APPROVED' | 'REJECTED' | null;
  comment?: string;
}

export interface MemberTransferDoc {
  _id: Types.ObjectId;
  reference: string;
  member: Types.ObjectId;

  previousZone: Types.ObjectId;
  previousArea: Types.ObjectId;
  previousHomecell: Types.ObjectId;

  newZone: Types.ObjectId;
  newArea: Types.ObjectId;
  newHomecell: Types.ObjectId;

  scope: TransferScope;
  reason: string;
  status: TransferStatus;

  /** Ordered approval chain resolved from settings at request time (SRS FR-TRANS-005). */
  approvalChain: TransferApprovalStep[];
  currentStageIndex: number;

  requestedBy: Types.ObjectId;
  requestedAt: Date;
  completedBy?: Types.ObjectId | null;
  completedAt?: Date | null;
  rejectionReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

const approvalStepSchema = new Schema<TransferApprovalStep>(
  {
    stage: { type: String, enum: Object.values(TransferApprovalStage), required: true },
    approver: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedAt: { type: Date, default: null },
    decision: { type: String, enum: ['APPROVED', 'REJECTED', null], default: null },
    comment: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const transferSchema = new Schema<MemberTransferDoc>(
  {
    reference: { type: String, required: true, trim: true, uppercase: true },
    member: { type: Schema.Types.ObjectId, ref: 'Member', required: true },

    previousZone: { type: Schema.Types.ObjectId, ref: 'Zone', required: true },
    previousArea: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    previousHomecell: { type: Schema.Types.ObjectId, ref: 'Homecell', required: true },

    newZone: { type: Schema.Types.ObjectId, ref: 'Zone', required: true },
    newArea: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    newHomecell: { type: Schema.Types.ObjectId, ref: 'Homecell', required: true },

    scope: { type: String, enum: Object.values(TransferScope), required: true },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: Object.values(TransferStatus),
      default: TransferStatus.PENDING,
      required: true,
    },

    approvalChain: { type: [approvalStepSchema], default: [] },
    currentStageIndex: { type: Number, default: 0 },

    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    requestedAt: { type: Date, required: true, default: () => new Date() },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    completedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

transferSchema.index({ reference: 1 }, { unique: true });
transferSchema.index({ member: 1, createdAt: -1 });
transferSchema.index({ status: 1, createdAt: -1 });
transferSchema.index({ previousHomecell: 1 });
transferSchema.index({ newHomecell: 1 });
transferSchema.index({ previousZone: 1, status: 1 });
transferSchema.index({ newZone: 1, status: 1 });
transferSchema.index({ previousArea: 1, status: 1 });
transferSchema.index({ newArea: 1, status: 1 });

/** BR-004: only one transfer may be in flight for a member at any time. */
transferSchema.index(
  { member: 1 },
  { unique: true, partialFilterExpression: { status: TransferStatus.PENDING } },
);

export const MemberTransfer: Model<MemberTransferDoc> = model<MemberTransferDoc>(
  'MemberTransfer',
  transferSchema,
);
