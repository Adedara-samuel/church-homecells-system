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
  phoneSchema,
  validate,
} from '../../middleware/validate';
import {
  PAYMENT_PROVIDERS,
  PAYMENT_STATUSES,
  PaymentDirection,
  PaymentProviderName,
  PaymentPurpose,
  ReconciliationStatus,
} from '../../types/enums';
import { dayjs } from '../../utils/dates';
import { asyncHandler, created, ok, paginated } from '../../utils/http';
import * as service from './payment.service';
import * as reconciliation from './reconciliation.service';
import { providerStatuses } from './providers';

export const paymentRouter = Router();

// ---------------------------------------------------------------------------
// Webhooks — public, authenticated by provider signature only
// ---------------------------------------------------------------------------

/**
 * Mounted before `authenticate` on purpose: providers cannot present a JWT.
 * Authority comes from the signature over the raw request body, verified in the
 * service layer. The raw buffer is captured by the JSON body parser in `app.ts`.
 */
function webhookHandler(provider: PaymentProviderName) {
  return asyncHandler(async (req: Request, res: Response) => {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const result = await service.handleWebhook(
      provider,
      raw,
      req.headers as Record<string, unknown>,
      (req.body ?? {}) as Record<string, unknown>,
    );
    // 200 for everything understood — duplicates included — so providers stop retrying.
    return res.status(200).json({ success: true, ...result });
  });
}

paymentRouter.post('/webhooks/paystack', webhookHandler(PaymentProviderName.PAYSTACK));
paymentRouter.post('/webhooks/flutterwave', webhookHandler(PaymentProviderName.FLUTTERWAVE));
paymentRouter.post('/webhooks/mock', webhookHandler(PaymentProviderName.MOCK));

/** Public status lookup used by the post-checkout callback page. */
paymentRouter.get(
  '/status/:reference',
  validate({ params: z.object({ reference: z.string().trim().min(6).max(64) }) }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.getPaymentByReference(req.params.reference)),
  ),
);

// ---------------------------------------------------------------------------
// Authenticated routes
// ---------------------------------------------------------------------------

paymentRouter.use(authenticate);

paymentRouter.get(
  '/providers',
  requirePermission(Permission.PAYMENTS_VIEW),
  asyncHandler(async (_req: Request, res: Response) => ok(res, providerStatuses())),
);

paymentRouter.get(
  '/',
  requirePermission(Permission.PAYMENTS_VIEW),
  validate({
    query: paginationSchema
      .merge(orgFilterSchema)
      .merge(dateRangeSchema)
      .extend({
        status: z.enum(PAYMENT_STATUSES as [string, ...string[]]).optional(),
        direction: z.enum(Object.values(PaymentDirection) as [string, ...string[]]).optional(),
        provider: z.enum(PAYMENT_PROVIDERS as [string, ...string[]]).optional(),
        reconciliationStatus: z
          .enum(Object.values(ReconciliationStatus) as [string, ...string[]])
          .optional(),
      }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    paginated(res, await service.listPayments(currentUser(req), req.query as never)),
  ),
);

paymentRouter.post(
  '/initiate',
  financeLimiter,
  requirePermission(Permission.PAYMENTS_INITIATE),
  validate({
    body: z.object({
      homecellId: objectIdSchema,
      purpose: z.enum([PaymentPurpose.OFFERING, PaymentPurpose.OTHER_INCOME]),
      amount: amountMajorSchema,
      email: z.string().trim().toLowerCase().email('A valid email address is required'),
      name: z.string().trim().max(160).optional(),
      phone: phoneSchema.optional(),
      description: z.string().trim().max(400).optional(),
      memberId: objectIdSchema.optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await service.initiatePayment(currentUser(req), req.body as never, req)),
  ),
);

/** Re-asks the provider for the truth. Never trusts the client's claim of success. */
paymentRouter.post(
  '/:reference/verify',
  requirePermission(Permission.PAYMENTS_VIEW),
  validate({ params: z.object({ reference: z.string().trim().min(6).max(64) }) }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.verifyPayment(req.params.reference, req)),
  ),
);

paymentRouter.get(
  '/webhook-events',
  requirePermission(Permission.FINANCE_RECONCILE),
  validate({
    query: paginationSchema.extend({
      provider: z.enum(PAYMENT_PROVIDERS as [string, ...string[]]).optional(),
      processed: z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => (v === undefined ? undefined : v === 'true')),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    paginated(res, await service.listWebhookEvents(req.query as never)),
  ),
);

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

paymentRouter.get(
  '/reconciliation/summary',
  requirePermission(Permission.FINANCE_RECONCILE),
  asyncHandler(async (_req: Request, res: Response) =>
    ok(res, await reconciliation.reconciliationSummary()),
  ),
);

paymentRouter.get(
  '/reconciliation/runs',
  requirePermission(Permission.FINANCE_RECONCILE),
  validate({ query: paginationSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as { page: number; limit: number };
    const { items, total } = await reconciliation.listRuns(query);
    return res.json({
      success: true,
      data: items,
      meta: { pagination: { page: query.page, limit: query.limit, total } },
    });
  }),
);

paymentRouter.get(
  '/reconciliation/runs/:id',
  requirePermission(Permission.FINANCE_RECONCILE),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await reconciliation.getRun(req.params.id)),
  ),
);

paymentRouter.post(
  '/reconciliation/run',
  requirePermission(Permission.FINANCE_RECONCILE),
  validate({
    body: z.object({
      provider: z.enum(PAYMENT_PROVIDERS as [string, ...string[]]).optional(),
      from: z.string().date().optional(),
      to: z.string().date().optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as { provider?: PaymentProviderName; from?: string; to?: string };
    const run = await reconciliation.runReconciliation({
      provider: body.provider,
      from: body.from ? dayjs.utc(body.from).startOf('day').toDate() : dayjs.utc().subtract(7, 'day').toDate(),
      to: body.to ? dayjs.utc(body.to).endOf('day').toDate() : new Date(),
      trigger: 'MANUAL',
      runBy: currentUser(req).id,
    });
    return created(res, run);
  }),
);

paymentRouter.post(
  '/reconciliation/runs/:id/exceptions/:exceptionId/resolve',
  requirePermission(Permission.FINANCE_RECONCILE),
  validate({
    params: z.object({ id: objectIdSchema, exceptionId: objectIdSchema }),
    body: z.object({ note: z.string().trim().min(5, 'Explain the resolution').max(500) }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await reconciliation.resolveException(
        currentUser(req),
        req.params.id,
        req.params.exceptionId,
        (req.body as { note: string }).note,
        req,
      ),
    ),
  ),
);

paymentRouter.post(
  '/:id/settle',
  financeLimiter,
  requirePermission(Permission.FINANCE_RECONCILE),
  validate({
    params: idParamSchema,
    body: z.object({ note: z.string().trim().min(5, 'Explain why this is being settled manually').max(500) }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.manuallySettlePayment(
        currentUser(req),
        req.params.id,
        (req.body as { note: string }).note,
        req,
      ),
    ),
  ),
);

paymentRouter.get(
  '/:id',
  requirePermission(Permission.PAYMENTS_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.getPayment(currentUser(req), req.params.id)),
  ),
);
