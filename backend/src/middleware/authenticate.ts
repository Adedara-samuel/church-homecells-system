import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { effectivePermissions, type Permission } from '../config/permissions';
import { verifyAccessToken } from '../modules/auth/token.service';
import { User } from '../modules/users/user.model';
import { ROLE_SCOPE_LEVEL, UserStatus } from '../types/enums';
import type { AuthenticatedUser } from '../types/express';
import {
  AccountDisabledError,
  ForbiddenError,
  UnauthenticatedError,
} from '../utils/errors';
import { idString } from '../utils/ids';

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/**
 * Verifies the access token and loads the live user record.
 *
 * The database read on each request is deliberate: deactivating a user, changing their
 * role, or moving them to another Homecell takes effect on the very next request rather
 * than whenever their token happens to expire.
 */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = bearerToken(req);
    if (!token) throw new UnauthenticatedError('Authentication is required.');

    const payload = verifyAccessToken(token);
    const user = await User.findById(payload.sub).lean();
    if (!user) throw new UnauthenticatedError('Your account could not be found.');

    if (user.status !== UserStatus.ACTIVE) {
      throw new AccountDisabledError(
        user.status === UserStatus.SUSPENDED
          ? 'This account is suspended. Please contact an administrator.'
          : 'This account is inactive. Please contact an administrator.',
      );
    }

    // A password change invalidates every access token issued before it.
    if (user.passwordChangedAt && payload.iat) {
      const changedAtSeconds = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
      if (payload.iat < changedAtSeconds) {
        throw new UnauthenticatedError('Your password was changed. Please sign in again.');
      }
    }

    const permissions = effectivePermissions(
      user.role,
      user.extraPermissions ?? [],
      user.revokedPermissions ?? [],
    );

    const scopeLevel = ROLE_SCOPE_LEVEL[user.role];
    const authUser: AuthenticatedUser = {
      id: idString(user._id),
      email: user.email,
      fullName: `${user.firstName} ${user.lastName}`.trim(),
      role: user.role,
      scopeLevel,
      zoneId: user.zone ? idString(user.zone) : null,
      areaId: user.area ? idString(user.area) : null,
      homecellId: user.homecell ? idString(user.homecell) : null,
      permissions,
      isChurchWide: scopeLevel === 'CHURCH',
      can: (permission: Permission) => permissions.has(permission),
    };

    req.user = authUser;
    next();
  } catch (err) {
    next(err);
  }
};

/** Attaches the user when a token is present but never rejects. */
export const optionalAuthenticate: RequestHandler = (req, res, next) => {
  if (!bearerToken(req)) return next();
  authenticate(req, res, (err) => (err ? next() : next()));
};

export function currentUser(req: Request): AuthenticatedUser {
  if (!req.user) throw new UnauthenticatedError();
  return req.user;
}

/** Requires every listed permission. */
export function requirePermission(...required: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(new UnauthenticatedError());
    const missing = required.filter((p) => !user.permissions.has(p));
    if (missing.length) {
      return next(
        new ForbiddenError('You do not have permission to perform this action.', {
          required: missing,
        }),
      );
    }
    next();
  };
}

/** Requires at least one of the listed permissions. */
export function requireAnyPermission(...allowed: Permission[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return next(new UnauthenticatedError());
    if (allowed.some((p) => user.permissions.has(p))) return next();
    next(
      new ForbiddenError('You do not have permission to perform this action.', {
        requiredAnyOf: allowed,
      }),
    );
  };
}
