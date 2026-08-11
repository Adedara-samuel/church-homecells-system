import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../config/permissions';
import { authenticate, currentUser, requirePermission } from '../../middleware/authenticate';
import { idParamSchema, objectIdSchema, validate } from '../../middleware/validate';
import { MEMBERSHIP_STATUSES, type MembershipStatus } from '../../types/enums';
import { asyncHandler, created, ok, paginated } from '../../utils/http';
import * as service from './member.service';
import { createMemberSchema, listMembersSchema, updateMemberSchema } from './member.schemas';

export const memberRouter = Router();
memberRouter.use(authenticate);

memberRouter.get(
  '/',
  requirePermission(Permission.MEMBERS_VIEW),
  validate({ query: listMembersSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    paginated(res, await service.listMembers(currentUser(req), req.query as never)),
  ),
);

memberRouter.get(
  '/celebrations',
  requirePermission(Permission.MEMBERS_VIEW),
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.upcomingCelebrations(
        currentUser(req),
        (req.query as unknown as { days: number }).days,
      ),
    ),
  ),
);

memberRouter.get(
  '/roster/:homecellId',
  requirePermission(Permission.MEMBERS_VIEW),
  validate({ params: z.object({ homecellId: objectIdSchema }) }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.listHomecellRoster(currentUser(req), req.params.homecellId)),
  ),
);

memberRouter.get(
  '/:id',
  requirePermission(Permission.MEMBERS_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.getMember(currentUser(req), req.params.id)),
  ),
);

memberRouter.post(
  '/',
  requirePermission(Permission.MEMBERS_CREATE),
  validate({ body: createMemberSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await service.createMember(currentUser(req), req.body as never, req)),
  ),
);

memberRouter.patch(
  '/:id',
  requirePermission(Permission.MEMBERS_UPDATE),
  validate({ params: idParamSchema, body: updateMemberSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.updateMember(currentUser(req), req.params.id, req.body as never, req)),
  ),
);

memberRouter.patch(
  '/:id/status',
  requirePermission(Permission.MEMBERS_UPDATE),
  validate({
    params: idParamSchema,
    body: z.object({
      membershipStatus: z.enum(MEMBERSHIP_STATUSES as [string, ...string[]]),
      reason: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { membershipStatus, reason } = req.body as {
      membershipStatus: MembershipStatus;
      reason?: string;
    };
    return ok(
      res,
      await service.setMembershipStatus(currentUser(req), req.params.id, membershipStatus, reason, req),
    );
  }),
);
