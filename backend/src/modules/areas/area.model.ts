import { Schema, model, type Model, type Types } from 'mongoose';
import { OrgStatus } from '../../types/enums';

export interface AreaDoc {
  _id: Types.ObjectId;
  code: string;
  name: string;
  description?: string;
  /** BR-002: an Area must belong to a Zone. */
  zone: Types.ObjectId;
  coordinator?: Types.ObjectId | null;
  status: OrgStatus;
  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const areaSchema = new Schema<AreaDoc>(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 16,
      match: [/^[A-Z0-9-]+$/, 'Area code may only contain letters, digits and hyphens'],
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 500 },
    zone: { type: Schema.Types.ObjectId, ref: 'Zone', required: true, index: true },
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

areaSchema.index({ code: 1 }, { unique: true });
areaSchema.index({ zone: 1, name: 1 }, { unique: true });
areaSchema.index({ zone: 1, status: 1 });

export const Area: Model<AreaDoc> = model<AreaDoc>('Area', areaSchema);
