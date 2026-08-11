import { Schema, model, type Model, type Types } from 'mongoose';
import { OrgStatus } from '../../types/enums';

export interface HomecellDoc {
  _id: Types.ObjectId;
  code: string;
  name: string;
  /** BR-001: a Homecell must belong to an Area. */
  area: Types.ObjectId;
  /**
   * Denormalised zone reference. It is written only by the service layer from the
   * parent Area and lets every scope filter and roll-up report avoid a join.
   */
  zone: Types.ObjectId;

  coordinator?: Types.ObjectId | null;
  assistantCoordinator?: Types.ObjectId | null;

  meetingLocation?: string;
  meetingAddress?: string;

  /**
   * Per-Homecell override of the church-wide maximum purse threshold (minor units).
   * `null` means "inherit the value configured in system settings".
   */
  maxPurseThresholdOverride?: number | null;

  status: OrgStatus;
  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const homecellSchema = new Schema<HomecellDoc>(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 20,
      match: [/^[A-Z0-9-]+$/, 'Homecell code may only contain letters, digits and hyphens'],
    },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    area: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    zone: { type: Schema.Types.ObjectId, ref: 'Zone', required: true },

    coordinator: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    assistantCoordinator: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    meetingLocation: { type: String, trim: true, maxlength: 160 },
    meetingAddress: { type: String, trim: true, maxlength: 300 },

    maxPurseThresholdOverride: { type: Number, default: null, min: 0 },

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

homecellSchema.index({ code: 1 }, { unique: true });
homecellSchema.index({ area: 1, name: 1 }, { unique: true });
homecellSchema.index({ zone: 1, status: 1 });
homecellSchema.index({ area: 1, status: 1 });
homecellSchema.index({ coordinator: 1 });

export const Homecell: Model<HomecellDoc> = model<HomecellDoc>('Homecell', homecellSchema);
