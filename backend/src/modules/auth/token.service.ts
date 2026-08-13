import crypto from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { UnauthenticatedError } from '../../utils/errors';
import { ErrorCode } from '../../utils/errors';
import { sha256 } from '../../utils/ids';
import { RefreshToken } from './refreshToken.model';
import type { Role } from '../../types/enums';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: Role;
  /** Issued-at, populated by `jsonwebtoken`. Compared against `passwordChangedAt`. */
  iat?: number;
  exp?: number;
}

export const REFRESH_COOKIE_NAME = 'chms_refresh';

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
    issuer: 'chms',
    audience: 'chms-api',
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'chms',
      audience: 'chms-api',
    }) as AccessTokenPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthenticatedError('Your session has expired. Please sign in again.', ErrorCode.TOKEN_EXPIRED);
    }
    throw new UnauthenticatedError('Invalid authentication token.');
  }
}

/**
 * Refresh tokens are opaque random strings, not JWTs: they are only ever validated
 * by hash lookup, so revocation is immediate and a leaked database row is useless.
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

const DEFAULT_REFRESH_TTL_MS = 2 * 24 * 60 * 60 * 1000;

function refreshTtlMs(): number {
  const raw = env.JWT_REFRESH_TTL;
  const match = /^(\d+)([smhd])$/.exec(raw);
  // A malformed value must not silently grant a longer session than intended.
  if (!match) return DEFAULT_REFRESH_TTL_MS;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * (multipliers[unit] ?? 86_400_000);
}

export async function issueRefreshToken(
  userId: string,
  req: Request,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateRefreshToken();
  const expiresAt = new Date(Date.now() + refreshTtlMs());
  await RefreshToken.create({
    user: userId,
    tokenHash: sha256(token),
    expiresAt,
    userAgent: (req.headers['user-agent'] as string) ?? null,
    ipAddress: req.ip ?? null,
  });
  return { token, expiresAt };
}

/**
 * Validates and rotates a refresh token in one step.
 *
 * Reuse of an already-rotated token is treated as theft: every session belonging to
 * that user is revoked immediately.
 */
export async function rotateRefreshToken(
  presented: string,
  req: Request,
): Promise<{ userId: string; token: string; expiresAt: Date }> {
  const hash = sha256(presented);
  const existing = await RefreshToken.findOne({ tokenHash: hash });

  if (!existing) throw new UnauthenticatedError('Invalid session. Please sign in again.');

  if (existing.revokedAt || existing.replacedByTokenHash) {
    await RefreshToken.updateMany(
      { user: existing.user, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'REUSE_DETECTED' } },
    );
    throw new UnauthenticatedError('Your session is no longer valid. Please sign in again.');
  }

  if (existing.expiresAt.getTime() < Date.now()) {
    throw new UnauthenticatedError('Your session has expired. Please sign in again.', ErrorCode.TOKEN_EXPIRED);
  }

  const userId = String(existing.user);
  const next = await issueRefreshToken(userId, req);
  existing.revokedAt = new Date();
  existing.revokedReason = 'ROTATED';
  existing.replacedByTokenHash = sha256(next.token);
  await existing.save();

  return { userId, ...next };
}

export async function revokeRefreshToken(presented: string, reason = 'LOGOUT'): Promise<void> {
  await RefreshToken.updateOne(
    { tokenHash: sha256(presented), revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
}

export async function revokeAllUserSessions(userId: string, reason: string): Promise<void> {
  await RefreshToken.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
}

export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE || env.isProduction,
    sameSite: env.isProduction ? 'none' : 'lax',
    domain: env.COOKIE_DOMAIN,
    path: '/',
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE || env.isProduction,
    sameSite: env.isProduction ? 'none' : 'lax',
    domain: env.COOKIE_DOMAIN,
    path: '/',
  });
}

/**
 * Reads the refresh token from the httpOnly cookie, falling back to the request body
 * so that non-browser clients (mobile shells, integration tests) work identically.
 */
export function readRefreshToken(req: Request): string | null {
  const fromCookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE_NAME];
  if (fromCookie) return fromCookie;
  const fromBody = (req.body as { refreshToken?: string } | undefined)?.refreshToken;
  return fromBody ?? null;
}
