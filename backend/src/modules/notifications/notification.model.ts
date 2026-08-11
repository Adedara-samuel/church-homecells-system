import { Schema, model, type Model, type Types } from 'mongoose';
import { NotificationSeverity, NotificationType } from '../../types/enums';

export interface NotificationDoc {
  _id: Types.ObjectId;
  recipient: Types.ObjectId;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  message: string;

  /** Optional pointer to the record that triggered the notification. */
  entityModel?: string | null;
  entityId?: Types.ObjectId | null;
  /** Frontend route the notification deep-links to. */
  actionUrl?: string | null;

  homecell?: Types.ObjectId | null;
  area?: Types.ObjectId | null;
  zone?: Types.ObjectId | null;

  /**
   * Collapses repeat notifications for the same ongoing condition (e.g. a purse that
   * stays above threshold for a week) into a single unread item.
   */
  dedupeKey?: string | null;

  isRead: boolean;
  readAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    recipient: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: Object.values(NotificationType), required: true },
    severity: {
      type: String,
      enum: Object.values(NotificationSeverity),
      default: NotificationSeverity.INFO,
    },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    message: { type: String, required: true, trim: true, maxlength: 800 },

    entityModel: { type: String, default: null },
    entityId: { type: Schema.Types.ObjectId, default: null },
    actionUrl: { type: String, trim: true, default: null },

    homecell: { type: Schema.Types.ObjectId, ref: 'Homecell', default: null },
    area: { type: Schema.Types.ObjectId, ref: 'Area', default: null },
    zone: { type: Schema.Types.ObjectId, ref: 'Zone', default: null },

    dedupeKey: { type: String, default: null },

    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ type: 1, createdAt: -1 });
/** One live notification per recipient per ongoing condition. */
notificationSchema.index(
  { recipient: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' }, isRead: false } },
);

export const Notification: Model<NotificationDoc> = model<NotificationDoc>(
  'Notification',
  notificationSchema,
);
