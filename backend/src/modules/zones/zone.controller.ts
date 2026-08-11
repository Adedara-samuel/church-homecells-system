import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../config/permissions';
import { authenticate, currentUser, requirePermission } from '../../middleware/authenticate';
import { idParamSchema, paginationSchema, objectIdSchema, validate } from '../../middleware/validate';
import { OrgStatus } from '../../types/enums';
import { asyncHandler, created, ok, paginated } from '../../utils/http';
import * as service from './zone.service';

const orgStatus = z.enum(Object.values(OrgStatus) as [string, ...string[]]);

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'A code is required')
  .max(16)
  .regex(/^[A-Z0-9-]+$/, 'Use letters, digits and hyphens only');

export const createZoneSchema = z.object({
  code: codeSchema,
  name: z.string().trim().min(2, 'A name is required').max(120),
  description: z.string().trim().max(500).optional(),
  coordinatorId: objectIdSchema.nullish(),
  status: orgStatus.optional(),
});

export const updateZoneSchema = createZoneSchema.partial();

const listSchema = paginationSchema.extend({ status: orgStatus.optional() });

export const zoneRouter = Router();
zoneRouter.use(authenticate);

zoneRouter.get(
  '/',
  requirePermission(Permission.ZONES_VIEW),
  validate({ query: listSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    paginated(res, await service.listZones(currentUser(req), req.query as never)),
  ),
);

zoneRouter.get(
  '/options',
  requirePermission(Permission.ZONES_VIEW),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.zoneOptions(currentUser(req))),
  ),
);

zoneRouter.get(
  '/:id',
  requirePermission(Permission.ZONES_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.getZone(currentUser(req), req.params.id)),
  ),
);

zoneRouter.post(
  '/',
  requirePermission(Permission.ZONES_CREATE),
  validate({ body: createZoneSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await service.createZone(currentUser(req), req.body as never, req)),
  ),
);

zoneRouter.patch(
  '/:id',
  requirePermission(Permission.ZONES_UPDATE),
  validate({ params: idParamSchema, body: updateZoneSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.updateZone(currentUser(req), req.params.id, req.body as never, req)),
  ),
);

zoneRouter.patch(
  '/:id/status',
  requirePermission(Permission.ZONES_UPDATE),
  validate({ params: idParamSchema, body: z.object({ status: orgStatus }) }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.setZoneStatus(
        currentUser(req),
        req.params.id,
        (req.body as { status: OrgStatus }).status,
        req,
      ),
    ),
  ),
);
