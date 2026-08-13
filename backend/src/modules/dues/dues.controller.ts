import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../config/permissions';
import { authenticate, currentUser, requirePermission } from '../../middleware/authenticate';
import { financeLimiter } from '../../middleware/security';
import {
  amountMajorSchema,
  idParamSchema,
  objectIdSchema,
  orgFilterSchema,
  paginationSchema,
  validate,
} from '../../middleware/validate';
import { DuesFrequency, DuesInvoiceStatus, OrgStatus } from '../../types/enums';
import { asyncHandler, created, ok, paginated } from '../../utils/http';
import { initiateDuesPayment } from '../payments/payment.service';
import { duesReceiptPdf } from '../receipts/receipt.service';
import * as service from './dues.service';

const definitionSchema = z.object({
  zoneId: objectIdSchema,
  name: z.string().trim().min(3, 'Give this charge a name').max(120),
  description: z.string().trim().max(400).optional(),
  frequency: z.enum([DuesFrequency.MONTHLY, DuesFrequency.ONE_OFF]),
  amount: amountMajorSchema,
  startDate: z.string().date('Select the start date'),
  endDate: z.string().date().optional(),
  dueDate: z.string().date().optional(),
  dueDayOfMonth: z.coerce.number().int().min(1).max(28).optional(),
  isPrimaryMonthlyDue: z.boolean().optional(),
});

const updateDefinitionSchema = definitionSchema.partial().omit({ zoneId: true });

export const duesRouter = Router();
duesRouter.use(authenticate);

// ---------------------------------------------------------------------------
// Definitions — what a Zone charges
// ---------------------------------------------------------------------------

duesRouter.get(
  '/definitions',
  requirePermission(Permission.DUES_VIEW),
  validate({ query: z.object({ zoneId: objectIdSchema.optional() }) }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.listDefinitions(currentUser(req), req.query as never)),
  ),
);

duesRouter.post(
  '/definitions',
  requirePermission(Permission.DUES_CONFIGURE),
  validate({ body: definitionSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await service.createDefinition(currentUser(req), req.body as never, req)),
  ),
);

duesRouter.patch(
  '/definitions/:id',
  requirePermission(Permission.DUES_CONFIGURE),
  validate({ params: idParamSchema, body: updateDefinitionSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.updateDefinition(currentUser(req), req.params.id, req.body as never, req)),
  ),
);

/**
 * Closes a charge, or re-opens it for another year. Re-opening a one-off levy needs a
 * fresh due date — the old one has already passed.
 */
duesRouter.post(
  '/definitions/:id/status',
  requirePermission(Permission.DUES_CONFIGURE),
  validate({
    params: idParamSchema,
    body: z.object({
      status: z.enum([OrgStatus.ACTIVE, OrgStatus.INACTIVE]),
      dueDate: z.string().date().optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { status, dueDate } = req.body as { status: OrgStatus; dueDate?: string };
    return ok(
      res,
      await service.setDefinitionStatus(currentUser(req), req.params.id, status, dueDate, req),
    );
  }),
);

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/** Everything a Homecell currently owes, generated up to the current month on read. */
duesRouter.get(
  '/statement/:homecellId',
  requirePermission(Permission.DUES_VIEW),
  validate({ params: z.object({ homecellId: objectIdSchema }) }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.getDuesStatement(currentUser(req), req.params.homecellId)),
  ),
);

duesRouter.get(
  '/invoices',
  requirePermission(Permission.DUES_VIEW),
  validate({
    query: paginationSchema.merge(orgFilterSchema).extend({
      status: z.enum(Object.values(DuesInvoiceStatus) as [string, ...string[]]).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    paginated(res, await service.listInvoices(currentUser(req), req.query as never)),
  ),
);

duesRouter.post(
  '/invoices/:id/waive',
  requirePermission(Permission.DUES_WAIVE),
  validate({
    params: idParamSchema,
    body: z.object({ reason: z.string().trim().min(5, 'A reason is required').max(500) }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.waiveInvoice(
        currentUser(req),
        req.params.id,
        (req.body as { reason: string }).reason,
        req,
      ),
    ),
  ),
);

// ---------------------------------------------------------------------------
// Payment
// ---------------------------------------------------------------------------

/**
 * Opens a provider checkout for the selected charges. Omitting `invoiceIds` pays
 * everything outstanding.
 */
duesRouter.post(
  '/pay',
  financeLimiter,
  requirePermission(Permission.DUES_PAY),
  validate({
    body: z.object({
      homecellId: objectIdSchema,
      invoiceIds: z.array(objectIdSchema).min(1).max(120).optional(),
      email: z.string().email('Enter a valid email address').optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await initiateDuesPayment(currentUser(req), req.body as never, req)),
  ),
);

/** The receipt for a settled dues payment, as a PDF download. */
duesRouter.get(
  '/payments/:reference/receipt',
  requirePermission(Permission.DUES_VIEW),
  validate({ params: z.object({ reference: z.string().trim().min(6).max(64) }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const { buffer, filename } = await duesReceiptPdf(currentUser(req), req.params.reference);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    return res.send(buffer);
  }),
);
