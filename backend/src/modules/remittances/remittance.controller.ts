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
import { remittanceReceiptPdf } from '../receipts/receipt.service';
import * as service from './remittance.service';

export const recordRemittanceSchema = z.object({
  homecellId: objectIdSchema,
  amount: amountMajorSchema,
  // Optional: an online payment is stamped by the server, so the client sends neither.
  date: z.string().date('Select the remittance date').optional(),
  time: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter the time as HH:mm')
    .optional(),
  /** ISO 8601 with a UTC offset — the unambiguous form of `date` + `time`. */
  remittedAt: z.string().datetime({ offset: true }).optional(),
  channel: z.enum(Object.values(RemittanceChannel) as [string, ...string[]]).optional(),
  email: z.string().email('Enter a valid email address').optional(),
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

/**
 * What this Homecell must remit right now: the balance, the threshold, and the
 * minimum the rules will accept. The form reads this before it lets anyone type an
 * amount, so the requirement is visible rather than discovered on submit.
 */
remittanceRouter.get(
  '/minimum/:homecellId',
  requirePermission(Permission.REMITTANCE_VIEW),
  validate({ params: z.object({ homecellId: objectIdSchema }) }),
  asyncHandler(async (req: Request, res: Response) => {
    await service.assertCanViewHomecell(currentUser(req), req.params.homecellId);
    return ok(res, await service.remittanceFloor(req.params.homecellId));
  }),
);

remittanceRouter.get(
  '/:id',
  requirePermission(Permission.REMITTANCE_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.getRemittance(currentUser(req), req.params.id)),
  ),
);

/** The receipt for a settled remittance, as a PDF download. */
remittanceRouter.get(
  '/:id/receipt',
  requirePermission(Permission.REMITTANCE_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { buffer, filename } = await remittanceReceiptPdf(currentUser(req), req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    return res.send(buffer);
  }),
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
