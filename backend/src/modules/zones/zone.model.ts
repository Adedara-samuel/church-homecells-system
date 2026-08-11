import { Schema, model, type Model, type Types } from 'mongoose';
import { OrgStatus } from '../../types/enums';

export interface ZoneDoc {
  _id: Types.ObjectId;
  code: string;
  name: string;
  description?: string;
  coordinator?: Types.ObjectId | null;
  status: OrgStatus;
  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const zoneSchema = new Schema<ZoneDoc>(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 16,
      match: [/^[A-Z0-9-]+$/, 'Zone code may only contain letters, digits and hyphens'],
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },
    coordinator: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: {
      type: String,
      enum: Object.values(OrgStatus),
      default: OrgStatus.ACTIVE,
      required: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

zoneSchema.index({ code: 1 }, { unique: true });
zoneSchema.index({ name: 1 }, { unique: true });
zoneSchema.index({ status: 1 });

export const Zone: Model<ZoneDoc> = model<ZoneDoc>('Zone', zoneSchema);
