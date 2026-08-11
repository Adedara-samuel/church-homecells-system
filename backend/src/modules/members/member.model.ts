import { Schema, model, type Model, type Types } from 'mongoose';
import {
  BaptismStatus,
  MEMBERSHIP_CATEGORIES,
  MEMBERSHIP_STATUSES,
  MARITAL_STATUSES,
  MaritalStatus,
  MembershipCategory,
  MembershipStatus,
  SEXES,
  Sex,
} from '../../types/enums';

export interface MemberLocation {
  state?: string;
  lga?: string;
  city?: string;
  community?: string;
  street?: string;
}

export interface EmergencyContact {
  name?: string;
  relationship?: string;
  phone?: string;
}

export interface MemberDoc {
  _id: Types.ObjectId;
  /** Human-facing identifier, e.g. `MBR-000142`. */
  memberId: string;

  firstName: string;
  middleName?: string;
  lastName: string;
  preferredName?: string;
  sex: Sex;
  dateOfBirth?: Date | null;

  phone: string;
  alternatePhone?: string;
  email?: string;

  maritalStatus: MaritalStatus;
  weddingAnniversary?: Date | null;

  photoUrl?: string;
  photoPublicId?: string;

  residentialAddress?: string;
  location: MemberLocation;
  occupation?: string;
  emergencyContact: EmergencyContact;

  dateJoinedChurch?: Date | null;
  membershipStatus: MembershipStatus;
  membershipCategory: MembershipCategory;

  /** BR-003: these three must always be mutually consistent. */
  zone: Types.ObjectId;
  area: Types.ObjectId;
  homecell: Types.ObjectId;
  previousHomecell?: Types.ObjectId | null;

  baptismStatus: BaptismStatus;
  department?: string;
  membershipClassCompleted: boolean;
  notes?: string;

  /**
   * Denormalised month/day used to find celebrants without a full collection scan.
   * Maintained by a pre-validate hook so it can never drift from the source date.
   */
  birthMonthDay?: string | null;
  anniversaryMonthDay?: string | null;

  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;

  fullName: string;
}

function monthDayKey(value?: Date | null): string | null {
  if (!value) return null;
  const m = String(value.getUTCMonth() + 1).padStart(2, '0');
  const d = String(value.getUTCDate()).padStart(2, '0');
  return `${m}-${d}`;
}

const memberSchema = new Schema<MemberDoc>(
  {
    memberId: { type: String, required: true, trim: true, uppercase: true },

    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    middleName: { type: String, trim: true, maxlength: 80 },
    lastName: { type: String, required: true, trim: true, maxlength: 80 },
    preferredName: { type: String, trim: true, maxlength: 80 },
    sex: { type: String, enum: SEXES, required: true, default: Sex.UNSPECIFIED },
    dateOfBirth: { type: Date, default: null },

    phone: { type: String, required: true, trim: true, maxlength: 24 },
    alternatePhone: { type: String, trim: true, maxlength: 24 },
    email: { type: String, trim: true, lowercase: true, maxlength: 160 },

    maritalStatus: {
      type: String,
      enum: MARITAL_STATUSES,
      required: true,
      default: MaritalStatus.SINGLE,
    },
    weddingAnniversary: { type: Date, default: null },

    photoUrl: { type: String, trim: true },
    photoPublicId: { type: String, trim: true },

    residentialAddress: { type: String, trim: true, maxlength: 300 },
    location: {
      state: { type: String, trim: true, maxlength: 80 },
      lga: { type: String, trim: true, maxlength: 80 },
      city: { type: String, trim: true, maxlength: 80 },
      community: { type: String, trim: true, maxlength: 80 },
      street: { type: String, trim: true, maxlength: 160 },
    },
    occupation: { type: String, trim: true, maxlength: 120 },
    emergencyContact: {
      name: { type: String, trim: true, maxlength: 120 },
      relationship: { type: String, trim: true, maxlength: 60 },
      phone: { type: String, trim: true, maxlength: 24 },
    },

    dateJoinedChurch: { type: Date, default: null },
    membershipStatus: {
      type: String,
      enum: MEMBERSHIP_STATUSES,
      required: true,
      default: MembershipStatus.ACTIVE,
    },
    membershipCategory: {
      type: String,
      enum: MEMBERSHIP_CATEGORIES,
      required: true,
      default: MembershipCategory.MEMBER,
    },

    zone: { type: Schema.Types.ObjectId, ref: 'Zone', required: true },
    area: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    homecell: { type: Schema.Types.ObjectId, ref: 'Homecell', required: true },
    previousHomecell: { type: Schema.Types.ObjectId, ref: 'Homecell', default: null },

    baptismStatus: {
      type: String,
      enum: Object.values(BaptismStatus),
      default: BaptismStatus.NOT_BAPTISED,
    },
    department: { type: String, trim: true, maxlength: 120 },
    membershipClassCompleted: { type: Boolean, default: false },
    notes: { type: String, trim: true, maxlength: 2000 },

    birthMonthDay: { type: String, default: null },
    anniversaryMonthDay: { type: String, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

memberSchema.virtual('fullName').get(function (this: MemberDoc) {
  return [this.firstName, this.middleName, this.lastName].filter(Boolean).join(' ');
});

memberSchema.pre('validate', function (next) {
  this.birthMonthDay = monthDayKey(this.dateOfBirth);
  this.anniversaryMonthDay = monthDayKey(this.weddingAnniversary);
  next();
});

memberSchema.index({ memberId: 1 }, { unique: true });
memberSchema.index({ phone: 1 });
memberSchema.index({ email: 1 }, { sparse: true });
memberSchema.index({ homecell: 1, membershipStatus: 1 });
memberSchema.index({ area: 1, membershipStatus: 1 });
memberSchema.index({ zone: 1, membershipStatus: 1 });
memberSchema.index({ birthMonthDay: 1, membershipStatus: 1 });
memberSchema.index({ anniversaryMonthDay: 1, membershipStatus: 1 });
memberSchema.index({ sex: 1 });
memberSchema.index({ 'location.state': 1, 'location.lga': 1 });
memberSchema.index(
  { firstName: 'text', lastName: 'text', middleName: 'text', memberId: 'text', phone: 'text' },
  { name: 'member_search', weights: { lastName: 5, firstName: 5, memberId: 8, phone: 3 } },
);

export const Member: Model<MemberDoc> = model<MemberDoc>('Member', memberSchema);
