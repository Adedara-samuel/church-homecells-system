import { Schema, model, type Model, type Types } from 'mongoose';
import { ROLES, Role, USER_STATUSES, UserStatus } from '../../types/enums';

export interface UserDoc {
  _id: Types.ObjectId;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  passwordHash: string;
  /** Forces a password change on next login (used for seeded / admin-created accounts). */
  mustChangePassword: boolean;
  role: Role;
  status: UserStatus;

  /** Organisational assignment — exactly one is populated for scoped roles. */
  zone?: Types.ObjectId | null;
  area?: Types.ObjectId | null;
  homecell?: Types.ObjectId | null;

  extraPermissions: string[];
  revokedPermissions: string[];

  lastLoginAt?: Date | null;
  failedLoginAttempts: number;
  lockedUntil?: Date | null;

  passwordResetTokenHash?: string | null;
  passwordResetExpiresAt?: Date | null;
  passwordChangedAt?: Date | null;

  createdBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;

  fullName: string;
}

const userSchema = new Schema<UserDoc>(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 160,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'A valid email address is required'],
    },
    phone: { type: String, required: true, trim: true, maxlength: 24 },
    passwordHash: { type: String, required: true, select: false },
    mustChangePassword: { type: Boolean, default: false },
    role: { type: String, required: true, enum: ROLES },
    status: { type: String, required: true, enum: USER_STATUSES, default: UserStatus.ACTIVE },

    zone: { type: Schema.Types.ObjectId, ref: 'Zone', default: null },
    area: { type: Schema.Types.ObjectId, ref: 'Area', default: null },
    homecell: { type: Schema.Types.ObjectId, ref: 'Homecell', default: null },

    extraPermissions: { type: [String], default: [] },
    revokedPermissions: { type: [String], default: [] },

    lastLoginAt: { type: Date, default: null },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    passwordResetTokenHash: { type: String, default: null, select: false },
    passwordResetExpiresAt: { type: Date, default: null, select: false },
    passwordChangedAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        // Defence in depth: even if a query forgets `select:false`, secrets never serialise.
        const output = ret as Record<string, unknown>;
        delete output.passwordHash;
        delete output.passwordResetTokenHash;
        delete output.passwordResetExpiresAt;
        delete output.__v;
        return output;
      },
    },
    toObject: { virtuals: true },
  },
);

userSchema.virtual('fullName').get(function (this: UserDoc) {
  return `${this.firstName} ${this.lastName}`.trim();
});

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ phone: 1 }, { unique: true });
userSchema.index({ role: 1, status: 1 });
userSchema.index({ zone: 1 });
userSchema.index({ area: 1 });
userSchema.index({ homecell: 1 });
userSchema.index({ firstName: 'text', lastName: 'text', email: 'text' }, { name: 'user_search' });

export const User: Model<UserDoc> = model<UserDoc>('User', userSchema);
