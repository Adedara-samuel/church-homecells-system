import crypto from 'node:crypto';
import type { Request } from 'express';
import { logger } from '../../config/logger';
import { effectivePermissions } from '../../config/permissions';
import { AuditAction, AuditModule, ROLE_SCOPE_LEVEL, UserStatus } from '../../types/enums';
import {
  AccountDisabledError,
  InvalidCredentialsError,
  NotFoundError,
  ValidationError,
} from '../../utils/errors';
import { idString, sha256 } from '../../utils/ids';
import { recordAudit } from '../audit/audit.service';
import { User, type UserDoc } from '../users/user.model';
import { hashPassword, verifyPassword } from './password';
import {
  issueRefreshToken,
  revokeAllUserSessions,
  signAccessToken,
} from './token.service';

const MAX_FAILED_ATTEMPTS = 8;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  role: string;
  status: string;
  scopeLevel: string;
  zone: string | null;
  area: string | null;
  homecell: string | null;
  permissions: string[];
  mustChangePassword: boolean;
  lastLoginAt: Date | null;
}

export function toSessionUser(user: UserDoc): SessionUser {
  return {
    id: idString(user._id),
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    scopeLevel: ROLE_SCOPE_LEVEL[user.role],
    zone: user.zone ? idString(user.zone) : null,
    area: user.area ? idString(user.area) : null,
    homecell: user.homecell ? idString(user.homecell) : null,
    permissions: [
      ...effectivePermissions(user.role, user.extraPermissions ?? [], user.revokedPermissions ?? []),
    ],
    mustChangePassword: user.mustChangePassword,
    lastLoginAt: user.lastLoginAt ?? null,
  };
}

function normalisePhone(value: string): string {
  return value.replace(/[\s-]/g, '');
}

/** Looks a user up by email or phone number (SRS FR-AUTH-001). */
async function findByIdentifier(identifier: string) {
  const value = identifier.trim();
  return User.findOne({
    $or: [{ email: value.toLowerCase() }, { phone: value }, { phone: normalisePhone(value) }],
  }).select('+passwordHash');
}

export interface LoginResult {
  user: SessionUser;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export async function login(
  identifier: string,
  password: string,
  req: Request,
): Promise<LoginResult> {
  const user = await findByIdentifier(identifier);

  // Uniform failure: never disclose whether the account exists.
  if (!user) {
    await recordAudit(
      {
        action: AuditAction.LOGIN_FAILED,
        module: AuditModule.AUTH,
        description: `Failed sign-in attempt for unknown identifier "${identifier}"`,
        success: false,
        actor: { name: 'Anonymous', role: 'ANONYMOUS' },
      },
      req,
    );
    throw new InvalidCredentialsError();
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw new AccountDisabledError(
      'This account is temporarily locked after repeated failed sign-in attempts. Please try again later.',
    );
  }

  const passwordValid = await verifyPassword(user.passwordHash, password);

  if (!passwordValid) {
    user.failedLoginAttempts += 1;
    if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
      user.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
      user.failedLoginAttempts = 0;
    }
    await user.save();
    await recordAudit(
      {
        action: AuditAction.LOGIN_FAILED,
        module: AuditModule.AUTH,
        description: `Failed sign-in attempt for ${user.email}`,
        entityModel: 'User',
        entityId: user._id,
        success: false,
        actor: { id: idString(user._id), name: `${user.firstName} ${user.lastName}`, role: user.role },
      },
      req,
    );
    throw new InvalidCredentialsError();
  }

  // SRS FR-AUTH-004: inactive users may not sign in.
  if (user.status !== UserStatus.ACTIVE) {
    await recordAudit(
      {
        action: AuditAction.LOGIN_FAILED,
        module: AuditModule.AUTH,
        description: `Sign-in blocked for ${user.status.toLowerCase()} account ${user.email}`,
        entityModel: 'User',
        entityId: user._id,
        success: false,
        actor: { id: idString(user._id), name: `${user.firstName} ${user.lastName}`, role: user.role },
      },
      req,
    );
    throw new AccountDisabledError(
      user.status === UserStatus.SUSPENDED
        ? 'This account is suspended. Please contact an administrator.'
        : 'This account is inactive. Please contact an administrator.',
    );
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  user.lastLoginAt = new Date();
  await user.save();

  const accessToken = signAccessToken({
    sub: idString(user._id),
    email: user.email,
    role: user.role,
  });
  const refresh = await issueRefreshToken(idString(user._id), req);

  await recordAudit(
    {
      action: AuditAction.LOGIN,
      module: AuditModule.AUTH,
      description: `${user.firstName} ${user.lastName} signed in`,
      entityModel: 'User',
      entityId: user._id,
      actor: { id: idString(user._id), name: `${user.firstName} ${user.lastName}`, role: user.role },
    },
    req,
  );

  return {
    user: toSessionUser(user),
    accessToken,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
}

export async function issueAccessTokenFor(userId: string): Promise<{
  accessToken: string;
  user: SessionUser;
}> {
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError('Account');
  if (user.status !== UserStatus.ACTIVE) {
    throw new AccountDisabledError('This account is no longer active.');
  }
  return {
    accessToken: signAccessToken({
      sub: idString(user._id),
      email: user.email,
      role: user.role,
    }),
    user: toSessionUser(user),
  };
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  req: Request,
): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw new NotFoundError('Account');

  if (!(await verifyPassword(user.passwordHash, currentPassword))) {
    throw new ValidationError('Your current password is incorrect.', [
      { field: 'currentPassword', message: 'Your current password is incorrect.' },
    ]);
  }

  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.mustChangePassword = false;
  await user.save();

  // Every other device is signed out; the caller receives a fresh session.
  await revokeAllUserSessions(userId, 'PASSWORD_CHANGED');

  await recordAudit(
    {
      action: AuditAction.PASSWORD_CHANGE,
      module: AuditModule.AUTH,
      description: `${user.firstName} ${user.lastName} changed their password`,
      entityModel: 'User',
      entityId: user._id,
    },
    req,
  );
}

/**
 * Issues a password reset token.
 *
 * The token is returned to the caller only outside production so the flow is
 * demonstrable without an email provider; in production it is logged for the
 * delivery worker and never included in the HTTP response.
 */
export async function requestPasswordReset(
  identifier: string,
  req: Request,
): Promise<{ token?: string }> {
  const user = await findByIdentifier(identifier);
  if (!user || user.status !== UserStatus.ACTIVE) {
    // Always succeed: the response must not reveal which accounts exist.
    return {};
  }

  const token = crypto.randomBytes(32).toString('base64url');
  user.passwordResetTokenHash = sha256(token);
  user.passwordResetExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await user.save();

  await recordAudit(
    {
      action: AuditAction.PASSWORD_RESET,
      module: AuditModule.AUTH,
      description: `Password reset requested for ${user.email}`,
      entityModel: 'User',
      entityId: user._id,
      actor: { name: 'Anonymous', role: 'ANONYMOUS' },
    },
    req,
  );

  logger.info({ userId: idString(user._id) }, 'Password reset token issued');
  return process.env.NODE_ENV === 'production' ? {} : { token };
}

export async function resetPassword(
  token: string,
  newPassword: string,
  req: Request,
): Promise<void> {
  const user = await User.findOne({
    passwordResetTokenHash: sha256(token),
    passwordResetExpiresAt: { $gt: new Date() },
  }).select('+passwordHash +passwordResetTokenHash +passwordResetExpiresAt');

  if (!user) {
    throw new ValidationError('This password reset link is invalid or has expired.');
  }

  user.passwordHash = await hashPassword(newPassword);
  user.passwordResetTokenHash = null;
  user.passwordResetExpiresAt = null;
  user.passwordChangedAt = new Date();
  user.mustChangePassword = false;
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  await revokeAllUserSessions(idString(user._id), 'PASSWORD_RESET');

  await recordAudit(
    {
      action: AuditAction.PASSWORD_RESET,
      module: AuditModule.AUTH,
      description: `Password reset completed for ${user.email}`,
      entityModel: 'User',
      entityId: user._id,
      actor: { id: idString(user._id), name: `${user.firstName} ${user.lastName}`, role: user.role },
    },
    req,
  );
}

export async function getSession(userId: string): Promise<SessionUser> {
  const user = await User.findById(userId);
  if (!user) throw new NotFoundError('Account');
  return toSessionUser(user);
}
