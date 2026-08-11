import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../config/permissions';
import { authenticate, currentUser, requirePermission } from '../../middleware/authenticate';
import { idParamSchema, paginationSchema, validate } from '../../middleware/validate';
import { NotificationType } from '../../types/enums';
import { asyncHandler, ok } from '../../utils/http';
import * as service from './notification.service';

export const notificationRouter = Router();
notificationRouter.use(authenticate, requirePermission(Permission.NOTIFICATIONS_VIEW));

const listSchema = paginationSchema.extend({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  type: z.enum(Object.values(NotificationType) as [string, ...string[]]).optional(),
});

notificationRouter.get(
  '/',
  validate({ query: listSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await service.listNotifications(currentUser(req), req.query as never);
    return res.json({
      success: true,
      data: result.items,
      meta: { pagination: result.pagination, unreadCount: result.unreadCount },
    });
  }),
);

notificationRouter.get(
  '/unread-count',
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, { unreadCount: await service.unreadCount(currentUser(req)) }),
  ),
);

notificationRouter.patch(
  '/:id/read',
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.markRead(currentUser(req), req.params.id)),
  ),
);

notificationRouter.patch(
  '/read-all',
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, { updated: await service.markAllRead(currentUser(req)) }),
  ),
);
