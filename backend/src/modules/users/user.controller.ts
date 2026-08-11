import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, currentUser, requirePermission } from '../../middleware/authenticate';
import { idParamSchema, validate } from '../../middleware/validate';
import { Permission } from '../../config/permissions';
import { ROLES, type Role, type UserStatus } from '../../types/enums';
import { asyncHandler, created, ok, paginated } from '../../utils/http';
import * as service from './user.service';
import {
  createUserSchema,
  listUsersSchema,
  resetUserPasswordSchema,
  updatePermissionsSchema,
  updateUserSchema,
  updateUserStatusSchema,
} from './user.schemas';

export const userRouter = Router();

userRouter.use(authenticate);

userRouter.get(
  '/',
  requirePermission(Permission.USERS_VIEW),
  validate({ query: listUsersSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.listUsers(currentUser(req), req.query as never);
    return paginated(res, result);
  }),
);

userRouter.get(
  '/assignable',
  requirePermission(Permission.USERS_VIEW),
  validate({ query: z.object({ role: z.enum(ROLES as [Role, ...Role[]]) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const users = await service.listAssignableCoordinators((req.query as { role: Role }).role);
    return ok(res, users);
  }),
);

userRouter.get(
  '/:id',
  requirePermission(Permission.USERS_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    return ok(res, await service.getUser(req.params.id));
  }),
);

userRouter.post(
  '/',
  requirePermission(Permission.USERS_CREATE),
  validate({ body: createUserSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { user, generatedPassword } = await service.createUser(
      currentUser(req),
      req.body as never,
      req,
    );
    // The temporary password is shown once, to the creating administrator only.
    return created(res, user, generatedPassword ? { temporaryPassword: generatedPassword } : undefined);
  }),
);

userRouter.patch(
  '/:id',
  requirePermission(Permission.USERS_UPDATE),
  validate({ params: idParamSchema, body: updateUserSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    return ok(res, await service.updateUser(currentUser(req), req.params.id, req.body as never, req));
  }),
);

userRouter.patch(
  '/:id/status',
  requirePermission(Permission.USERS_UPDATE),
  validate({ params: idParamSchema, body: updateUserStatusSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { status, reason } = req.body as { status: UserStatus; reason?: string };
    return ok(res, await service.setUserStatus(currentUser(req), req.params.id, status, reason, req));
  }),
);

userRouter.patch(
  '/:id/permissions',
  requirePermission(Permission.USERS_MANAGE_PERMISSIONS),
  validate({ params: idParamSchema, body: updatePermissionsSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { extraPermissions, revokedPermissions } = req.body as {
      extraPermissions: string[];
      revokedPermissions: string[];
    };
    return ok(
      res,
      await service.updatePermissions(
        currentUser(req),
        req.params.id,
        extraPermissions,
        revokedPermissions,
        req,
      ),
    );
  }),
);

userRouter.post(
  '/:id/reset-password',
  requirePermission(Permission.USERS_UPDATE),
  validate({ params: idParamSchema, body: resetUserPasswordSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { newPassword, mustChangePassword } = req.body as {
      newPassword: string;
      mustChangePassword: boolean;
    };
    await service.adminResetPassword(
      currentUser(req),
      req.params.id,
      newPassword,
      mustChangePassword,
      req,
    );
    return ok(res, { message: 'The password has been reset.' });
  }),
);
