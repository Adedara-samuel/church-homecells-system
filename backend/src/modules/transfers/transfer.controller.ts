import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../config/permissions';
import { authenticate, currentUser, requirePermission } from '../../middleware/authenticate';
import { idParamSchema, objectIdSchema, paginationSchema, validate } from '../../middleware/validate';
import { TransferScope, TransferStatus } from '../../types/enums';
import { asyncHandler, created, ok, paginated } from '../../utils/http';
import * as service from './transfer.service';

export const initiateTransferSchema = z.object({
  memberId: objectIdSchema,
  destinationHomecellId: objectIdSchema,
  reason: z.string().trim().min(5, 'Please give a reason for the transfer').max(1000),
});

const listSchema = paginationSchema.extend({
  status: z.enum(Object.values(TransferStatus) as [string, ...string[]]).optional(),
  scope: z.enum(Object.values(TransferScope) as [string, ...string[]]).optional(),
  memberId: objectIdSchema.optional(),
  zoneId: objectIdSchema.optional(),
  areaId: objectIdSchema.optional(),
  homecellId: objectIdSchema.optional(),
});

export const transferRouter = Router();
transferRouter.use(authenticate);

transferRouter.get(
  '/',
  requirePermission(Permission.TRANSFERS_VIEW),
  validate({ query: listSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    paginated(res, await service.listTransfers(currentUser(req), req.query as never)),
  ),
);

transferRouter.get(
  '/member/:memberId',
  requirePermission(Permission.TRANSFERS_VIEW),
  validate({ params: z.object({ memberId: objectIdSchema }) }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.memberTransferHistory(currentUser(req), req.params.memberId)),
  ),
);

transferRouter.get(
  '/:id',
  requirePermission(Permission.TRANSFERS_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.getTransfer(currentUser(req), req.params.id)),
  ),
);

transferRouter.post(
  '/',
  requirePermission(Permission.MEMBERS_TRANSFER),
  validate({ body: initiateTransferSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await service.initiateTransfer(currentUser(req), req.body as never, req)),
  ),
);

transferRouter.post(
  '/:id/approve',
  requirePermission(Permission.TRANSFERS_APPROVE),
  validate({
    params: idParamSchema,
    body: z.object({ comment: z.string().trim().max(500).optional() }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.approveTransfer(
        currentUser(req),
        req.params.id,
        (req.body as { comment?: string }).comment,
        req,
      ),
    ),
  ),
);

transferRouter.post(
  '/:id/reject',
  requirePermission(Permission.TRANSFERS_APPROVE),
  validate({
    params: idParamSchema,
    body: z.object({ reason: z.string().trim().min(5, 'A reason is required').max(500) }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.rejectTransfer(
        currentUser(req),
        req.params.id,
        (req.body as { reason: string }).reason,
        req,
      ),
    ),
  ),
);

transferRouter.post(
  '/:id/cancel',
  requirePermission(Permission.MEMBERS_TRANSFER),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.cancelTransfer(currentUser(req), req.params.id, req)),
  ),
);
