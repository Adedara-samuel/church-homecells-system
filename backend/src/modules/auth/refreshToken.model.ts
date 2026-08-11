import { Schema, model, type Model, type Types } from 'mongoose';

/**
 * Refresh tokens are stored **hashed**, one document per active session, so that a
 * database leak cannot be replayed and an administrator can revoke a single device
 * (or every device) without invalidating the signing secret.
 */
export interface RefreshTokenDoc {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  tokenHash: string;
  /** Rotation chain — set when this token is exchanged for a new one. */
  replacedByTokenHash?: string | null;
  revokedAt?: Date | null;
  revokedReason?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  expiresAt: Date;
  createdAt: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenDoc>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true },
    replacedByTokenHash: { type: String, default: null },
    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, default: null },
    userAgent: { type: String, default: null },
    ipAddress: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
refreshTokenSchema.index({ user: 1, revokedAt: 1 });
/** Mongo reclaims expired sessions automatically. */
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken: Model<RefreshTokenDoc> = model<RefreshTokenDoc>(
  'RefreshToken',
  refreshTokenSchema,
);
