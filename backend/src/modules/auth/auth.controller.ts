import type { Request, Response } from 'express';
import { AuditAction, AuditModule } from '../../types/enums';
import { UnauthenticatedError } from '../../utils/errors';
import { asyncHandler, ok } from '../../utils/http';
import { recordAudit } from '../audit/audit.service';
import { currentUser } from '../../middleware/authenticate';
import * as authService from './auth.service';
import {
  clearRefreshCookie,
  readRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  setRefreshCookie,
} from './token.service';

export const loginController = asyncHandler(async (req: Request, res: Response) => {
  const { identifier, password } = req.body as { identifier: string; password: string };
  const result = await authService.login(identifier, password, req);
  setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
  return ok(res, {
    user: result.user,
    accessToken: result.accessToken,
    // Also returned in the body for non-browser clients that cannot use cookies.
    refreshToken: result.refreshToken,
  });
});

export const refreshController = asyncHandler(async (req: Request, res: Response) => {
  const presented = readRefreshToken(req);
  if (!presented) throw new UnauthenticatedError('No active session was found.');

  const rotated = await rotateRefreshToken(presented, req);
  const { accessToken, user } = await authService.issueAccessTokenFor(rotated.userId);
  setRefreshCookie(res, rotated.token, rotated.expiresAt);

  return ok(res, { user, accessToken, refreshToken: rotated.token });
});

export const logoutController = asyncHandler(async (req: Request, res: Response) => {
  const presented = readRefreshToken(req);
  if (presented) await revokeRefreshToken(presented, 'LOGOUT');
  clearRefreshCookie(res);

  if (req.user) {
    await recordAudit(
      {
        action: AuditAction.LOGOUT,
        module: AuditModule.AUTH,
        description: `${req.user.fullName} signed out`,
        entityModel: 'User',
        entityId: req.user.id,
      },
      req,
    );
  }
  return ok(res, { message: 'Signed out successfully.' });
});

export const sessionController = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getSession(currentUser(req).id);
  return ok(res, { user });
});

export const changePasswordController = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };
  await authService.changePassword(currentUser(req).id, currentPassword, newPassword, req);
  clearRefreshCookie(res);
  return ok(res, {
    message: 'Your password has been changed. Please sign in again.',
  });
});

export const forgotPasswordController = asyncHandler(async (req: Request, res: Response) => {
  const { identifier } = req.body as { identifier: string };
  const result = await authService.requestPasswordReset(identifier, req);
  return ok(res, {
    message:
      'If an account matches those details, password reset instructions have been sent.',
    ...(result.token ? { developmentToken: result.token } : {}),
  });
});

export const resetPasswordController = asyncHandler(async (req: Request, res: Response) => {
  const { token, newPassword } = req.body as { token: string; newPassword: string };
  await authService.resetPassword(token, newPassword, req);
  return ok(res, { message: 'Your password has been reset. You can now sign in.' });
});
