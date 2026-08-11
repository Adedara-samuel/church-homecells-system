import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../config/permissions';
import { authenticate, currentUser, requirePermission } from '../../middleware/authenticate';
import { idParamSchema, objectIdSchema, paginationSchema, validate } from '../../middleware/validate';
import { OrgStatus } from '../../types/enums';
import { asyncHandler, created, ok, paginated } from '../../utils/http';
import * as service from './area.service';

const orgStatus = z.enum(Object.values(OrgStatus) as [string, ...string[]]);

export const createAreaSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(16)
    .regex(/^[A-Z0-9-]+$/, 'Use letters, digits and hyphens only'),
  name: z.string().trim().min(2, 'A name is required').max(120),
  description: z.string().trim().max(500).optional(),
  zoneId: objectIdSchema,
  coordinatorId: objectIdSchema.nullish(),
  status: orgStatus.optional(),
});

export const updateAreaSchema = createAreaSchema.partial();

const listSchema = paginationSchema.extend({
  status: orgStatus.optional(),
  zoneId: objectIdSchema.optional(),
});

export const areaRouter = Router();
areaRouter.use(authenticate);

areaRouter.get(
  '/',
  requirePermission(Permission.AREAS_VIEW),
  validate({ query: listSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    paginated(res, await service.listAreas(currentUser(req), req.query as never)),
  ),
);

areaRouter.get(
  '/options',
  requirePermission(Permission.AREAS_VIEW),
  validate({ query: z.object({ zoneId: objectIdSchema.optional() }) }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.areaOptions(currentUser(req), (req.query as { zoneId?: string }).zoneId)),
  ),
);

areaRouter.get(
  '/:id',
  requirePermission(Permission.AREAS_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.getArea(currentUser(req), req.params.id)),
  ),
);

areaRouter.post(
  '/',
  requirePermission(Permission.AREAS_CREATE),
  validate({ body: createAreaSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await service.createArea(currentUser(req), req.body as never, req)),
  ),
);

areaRouter.patch(
  '/:id',
  requirePermission(Permission.AREAS_UPDATE),
  validate({ params: idParamSchema, body: updateAreaSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.updateArea(currentUser(req), req.params.id, req.body as never, req)),
  ),
);

areaRouter.patch(
  '/:id/status',
  requirePermission(Permission.AREAS_UPDATE),
  validate({ params: idParamSchema, body: z.object({ status: orgStatus }) }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.setAreaStatus(
        currentUser(req),
        req.params.id,
        (req.body as { status: OrgStatus }).status,
        req,
      ),
    ),
  ),
);
