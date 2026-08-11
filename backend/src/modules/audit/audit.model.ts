import { Schema, model, type Model, type Types } from 'mongoose';
import { AuditAction, AuditModule } from '../../types/enums';

export interface AuditLogDoc {
  _id: Types.ObjectId;
  user?: Types.ObjectId | null;
  userName?: string;
  userRole?: string;

  action: AuditAction;
  module: AuditModule;
  entityModel?: string | null;
  entityId?: Types.ObjectId | null;
  entityLabel?: string | null;

  /** Field-level diff. Only changed keys are stored, with secrets already redacted. */
  previousValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;

  description: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;

  homecell?: Types.ObjectId | null;
  area?: Types.ObjectId | null;
  zone?: Types.ObjectId | null;

  success: boolean;
  createdAt: Date;
}

const auditSchema = new Schema<AuditLogDoc>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    userName: { type: String, trim: true },
    userRole: { type: String, trim: true },

    action: { type: String, enum: Object.values(AuditAction), required: true },
    module: { type: String, enum: Object.values(AuditModule), required: true },
    entityModel: { type: String, default: null },
    entityId: { type: Schema.Types.ObjectId, default: null },
    entityLabel: { type: String, default: null },

    previousValues: { type: Schema.Types.Mixed, default: null },
    newValues: { type: Schema.Types.Mixed, default: null },

    description: { type: String, required: true, trim: true, maxlength: 500 },
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null },
    requestId: { type: String, default: null },

    homecell: { type: Schema.Types.ObjectId, ref: 'Homecell', default: null },
    area: { type: Schema.Types.ObjectId, ref: 'Area', default: null },
    zone: { type: Schema.Types.ObjectId, ref: 'Zone', default: null },

    success: { type: Boolean, default: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

auditSchema.index({ createdAt: -1 });
auditSchema.index({ user: 1, createdAt: -1 });
auditSchema.index({ module: 1, action: 1, createdAt: -1 });
auditSchema.index({ entityModel: 1, entityId: 1, createdAt: -1 });
auditSchema.index({ zone: 1, createdAt: -1 });
auditSchema.index({ area: 1, createdAt: -1 });
auditSchema.index({ homecell: 1, createdAt: -1 });

/**
 * Audit records are append-only. There is no update or delete path in the service
 * layer, and these hooks make an accidental one fail loudly rather than silently.
 */
auditSchema.pre('save', function (next) {
  if (!this.isNew) return next(new Error('Audit log entries cannot be modified.'));
  next();
});
auditSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function (next) {
  next(new Error('Audit log entries cannot be modified.'));
});
auditSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function (next) {
  next(new Error('Audit log entries cannot be deleted.'));
});

export const AuditLog: Model<AuditLogDoc> = model<AuditLogDoc>('AuditLog', auditSchema);
