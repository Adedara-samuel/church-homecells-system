import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../config/permissions';
import { authenticate, currentUser, requirePermission } from '../../middleware/authenticate';
import { idParamSchema, objectIdSchema, paginationSchema, validate } from '../../middleware/validate';
import { OrgStatus } from '../../types/enums';
import { asyncHandler, created, ok, paginated } from '../../utils/http';
import * as service from './homecell.service';

const orgStatus = z.enum(Object.values(OrgStatus) as [string, ...string[]]);

export const createHomecellSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9-]+$/, 'Use letters, digits and hyphens only'),
  name: z.string().trim().min(2, 'A name is required').max(120),
  areaId: objectIdSchema,
  coordinatorId: objectIdSchema.nullish(),
  assistantCoordinatorId: objectIdSchema.nullish(),
  meetingLocation: z.string().trim().max(160).optional(),
  meetingAddress: z.string().trim().max(300).optional(),
  maxPurseThreshold: z.number().min(0).max(1_000_000_000).nullish(),
  status: orgStatus.optional(),
});

export const updateHomecellSchema = createHomecellSchema.partial();

const listSchema = paginationSchema.extend({
  status: orgStatus.optional(),
  zoneId: objectIdSchema.optional(),
  areaId: objectIdSchema.optional(),
});

export const homecellRouter = Router();
homecellRouter.use(authenticate);

homecellRouter.get(
  '/',
  requirePermission(Permission.HOMECELLS_VIEW),
  validate({ query: listSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    paginated(res, await service.listHomecells(currentUser(req), req.query as never)),
  ),
);

homecellRouter.get(
  '/options',
  requirePermission(Permission.HOMECELLS_VIEW),
  validate({
    query: z.object({ zoneId: objectIdSchema.optional(), areaId: objectIdSchema.optional() }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.homecellOptions(currentUser(req), req.query as never)),
  ),
);

homecellRouter.get(
  '/:id',
  requirePermission(Permission.HOMECELLS_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.getHomecell(currentUser(req), req.params.id)),
  ),
);

homecellRouter.post(
  '/',
  requirePermission(Permission.HOMECELLS_CREATE),
  validate({ body: createHomecellSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await service.createHomecell(currentUser(req), req.body as never, req)),
  ),
);

homecellRouter.patch(
  '/:id',
  requirePermission(Permission.HOMECELLS_UPDATE),
  validate({ params: idParamSchema, body: updateHomecellSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.updateHomecell(currentUser(req), req.params.id, req.body as never, req)),
  ),
);

homecellRouter.patch(
  '/:id/status',
  requirePermission(Permission.HOMECELLS_UPDATE),
  validate({ params: idParamSchema, body: z.object({ status: orgStatus }) }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.setHomecellStatus(
        currentUser(req),
        req.params.id,
        (req.body as { status: OrgStatus }).status,
        req,
      ),
    ),
  ),
);
