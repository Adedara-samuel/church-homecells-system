import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../config/permissions';
import { authenticate, currentUser, requirePermission } from '../../middleware/authenticate';
import { financeLimiter } from '../../middleware/security';
import {
  amountMajorSchema,
  dateRangeSchema,
  idParamSchema,
  objectIdSchema,
  orgFilterSchema,
  paginationSchema,
  validate,
} from '../../middleware/validate';
import { RemittanceChannel, RemittanceStatus } from '../../types/enums';
import { asyncHandler, created, ok, paginated } from '../../utils/http';
import * as service from './remittance.service';

export const recordRemittanceSchema = z.object({
  homecellId: objectIdSchema,
  amount: amountMajorSchema,
  date: z.string().date('Select the remittance date'),
  channel: z.enum(Object.values(RemittanceChannel) as [string, ...string[]]).optional(),
  paymentReference: z.string().trim().max(120).optional(),
  receivingAccount: z.string().trim().max(160).optional(),
  description: z.string().trim().max(400).optional(),
  receiptUrl: z.string().url('Upload a valid receipt').optional(),
  receiptPublicId: z.string().max(200).optional(),
});

const disburseSchema = z.object({
  accountNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Enter the 10-digit account number'),
  bankCode: z.string().trim().min(3, 'Select the destination bank').max(10),
  accountName: z.string().trim().min(3, 'Enter the account name').max(160),
});

const reasonSchema = z.object({
  reason: z.string().trim().min(5, 'A reason is required').max(500),
});

export const remittanceRouter = Router();
remittanceRouter.use(authenticate);

remittanceRouter.get(
  '/',
  requirePermission(Permission.REMITTANCE_VIEW),
  validate({
    query: paginationSchema.merge(orgFilterSchema).merge(dateRangeSchema).extend({
      status: z.enum(Object.values(RemittanceStatus) as [string, ...string[]]).optional(),
      channel: z.enum(Object.values(RemittanceChannel) as [string, ...string[]]).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    paginated(res, await service.listRemittances(currentUser(req), req.query as never)),
  ),
);

remittanceRouter.get(
  '/:id',
  requirePermission(Permission.REMITTANCE_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.getRemittance(currentUser(req), req.params.id)),
  ),
);

remittanceRouter.post(
  '/',
  financeLimiter,
  requirePermission(Permission.REMITTANCE_CREATE),
  validate({ body: recordRemittanceSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await service.recordRemittance(currentUser(req), req.body as never, req)),
  ),
);

remittanceRouter.post(
  '/:id/approve',
  financeLimiter,
  requirePermission(Permission.REMITTANCE_APPROVE),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.approveRemittance(currentUser(req), req.params.id, req)),
  ),
);

/** Confirms a manual remittance against its receipt and posts the ledger debit. */
remittanceRouter.post(
  '/:id/verify',
  financeLimiter,
  requirePermission(Permission.REMITTANCE_VERIFY),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.verifyRemittance(currentUser(req), req.params.id, req)),
  ),
);

/** Sends an approved remittance to the active payment provider as a payout. */
remittanceRouter.post(
  '/:id/disburse',
  financeLimiter,
  requirePermission(Permission.PAYMENTS_DISBURSE),
  validate({ params: idParamSchema, body: disburseSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.disburseRemittance(
        currentUser(req),
        req.params.id,
        req.body as never,
        req,
      ),
    ),
  ),
);

remittanceRouter.post(
  '/:id/reject',
  requirePermission(Permission.REMITTANCE_APPROVE),
  validate({ params: idParamSchema, body: reasonSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.rejectRemittance(
        currentUser(req),
        req.params.id,
        (req.body as { reason: string }).reason,
        req,
      ),
    ),
  ),
);

remittanceRouter.post(
  '/:id/reverse',
  financeLimiter,
  requirePermission(Permission.FINANCE_REVERSE),
  validate({ params: idParamSchema, body: reasonSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.reverseRemittance(
        currentUser(req),
        req.params.id,
        (req.body as { reason: string }).reason,
        req,
      ),
    ),
  ),
);

remittanceRouter.post(
  '/:id/receipt',
  requirePermission(Permission.REMITTANCE_CREATE),
  validate({
    params: idParamSchema,
    body: z.object({
      receiptUrl: z.string().url('A valid receipt URL is required'),
      receiptPublicId: z.string().max(200).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { receiptUrl, receiptPublicId } = req.body as {
      receiptUrl: string;
      receiptPublicId?: string;
    };
    return ok(
      res,
      await service.attachReceipt(currentUser(req), req.params.id, receiptUrl, receiptPublicId, req),
    );
  }),
);
