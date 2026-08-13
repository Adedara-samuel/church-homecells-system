import { Router, type Request, type Response } from 'express';
import type { FilterQuery } from 'mongoose';
import { z } from 'zod';
import { Permission } from '../../config/permissions';
import { authenticate, currentUser, requirePermission } from '../../middleware/authenticate';
import { resolveScopedFilter } from '../../middleware/scope';
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
import {
  ExpenseStatus,
  TRANSACTION_TYPES,
  TransactionDirection,
  TransactionStatus,
  TransactionType,
} from '../../types/enums';
import { dateRange } from '../../utils/dates';
import { asyncHandler, created, ok, paginated } from '../../utils/http';
import { toMinor } from '../../utils/money';
import { paginate } from '../../utils/query';
import { withTransaction } from '../../db/transaction';
import { recordAudit } from '../audit/audit.service';
import { AuditAction, AuditModule } from '../../types/enums';
import { Homecell } from '../homecells/homecell.model';
import { assertHomecellInScope } from '../../middleware/scope';
import { getSettings } from '../settings/settings.service';
import { LedgerTransaction, type LedgerTransactionDoc } from './ledger.model';
import { postTransaction, reverseTransaction } from './ledger.service';
import {
  checkThresholdAndNotify,
  getAreaPurses,
  getPurse,
  getZonePurse,
  listPurses,
  listZonePurses,
} from './purse.service';
import * as offerings from './offering.service';
import * as expenses from './expense.service';
import { OfferingChannel } from './offering.model';
import { NotFoundError } from '../../utils/errors';
import { idString } from '../../utils/ids';

export const financeRouter = Router();
financeRouter.use(authenticate);

// ---------------------------------------------------------------------------
// Purse
// ---------------------------------------------------------------------------

financeRouter.get(
  '/purses',
  requirePermission(Permission.FINANCE_VIEW),
  validate({
    query: orgFilterSchema.extend({
      aboveThresholdOnly: z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => v === 'true'),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await listPurses(currentUser(req), req.query as never)),
  ),
);

/**
 * The purse hierarchy. Routes are declared before `/purses/:homecellId` so the literal
 * segments are not captured as a Homecell id.
 */
financeRouter.get(
  '/purses/zones',
  requirePermission(Permission.FINANCE_VIEW),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await listZonePurses(currentUser(req))),
  ),
);

/** A Zone's own purse plus a row per Area. */
financeRouter.get(
  '/purses/zones/:zoneId',
  requirePermission(Permission.FINANCE_VIEW),
  validate({ params: z.object({ zoneId: objectIdSchema }) }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await getZonePurse(currentUser(req), req.params.zoneId)),
  ),
);

/** Every Homecell purse under one Area. Areas hold no funds of their own. */
financeRouter.get(
  '/purses/areas/:areaId',
  requirePermission(Permission.FINANCE_VIEW),
  validate({ params: z.object({ areaId: objectIdSchema }) }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await getAreaPurses(currentUser(req), req.params.areaId)),
  ),
);

financeRouter.get(
  '/purses/:homecellId',
  requirePermission(Permission.FINANCE_VIEW),
  validate({ params: z.object({ homecellId: objectIdSchema }) }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await getPurse(currentUser(req), req.params.homecellId)),
  ),
);

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

const ledgerListSchema = paginationSchema
  .merge(orgFilterSchema)
  .merge(dateRangeSchema)
  .extend({
    type: z.enum(TRANSACTION_TYPES as [TransactionType, ...TransactionType[]]).optional(),
    status: z.enum(Object.values(TransactionStatus) as [string, ...string[]]).optional(),
  });

financeRouter.get(
  '/ledger',
  requirePermission(Permission.FINANCE_VIEW),
  validate({ query: ledgerListSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as unknown as z.infer<typeof ledgerListSchema>;
    const scoped = await resolveScopedFilter<LedgerTransactionDoc>(currentUser(req), query);
    const filter: FilterQuery<LedgerTransactionDoc> = { ...scoped };
    if (query.type) filter.type = query.type;
    if (query.status) filter.status = query.status as TransactionStatus;
    if (query.from || query.to) filter.valueDate = dateRange(query.from, query.to) as never;

    const result = await paginate(LedgerTransaction, {
      filter,
      page: query.page,
      limit: query.limit,
      sort: { valueDate: query.order === 'asc' ? 1 : -1, createdAt: -1 },
      populate: [
        { path: 'homecell', select: 'name code' },
        { path: 'createdBy', select: 'firstName lastName' },
        { path: 'approvedBy', select: 'firstName lastName' },
      ],
    });
    return paginated(res, result);
  }),
);

financeRouter.get(
  '/ledger/:id',
  requirePermission(Permission.FINANCE_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const transaction = await LedgerTransaction.findById(req.params.id)
      .populate([
        { path: 'homecell', select: 'name code' },
        { path: 'createdBy', select: 'firstName lastName' },
        { path: 'approvedBy', select: 'firstName lastName' },
      ])
      .lean();
    if (!transaction) throw new NotFoundError('Transaction');
    await assertHomecellInScope(currentUser(req), transaction.homecell);
    return ok(res, transaction);
  }),
);

/** Manual correction path — always a new signed entry, never an edit (BR-012, BR-016). */
financeRouter.post(
  '/ledger/adjustments',
  financeLimiter,
  requirePermission(Permission.FINANCE_REVERSE),
  validate({
    body: z.object({
      homecellId: objectIdSchema,
      direction: z.enum([TransactionDirection.CREDIT, TransactionDirection.DEBIT]),
      amount: amountMajorSchema,
      valueDate: z.string().date(),
      description: z.string().trim().min(5, 'Explain the adjustment').max(500),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = currentUser(req);
    const body = req.body as {
      homecellId: string;
      direction: TransactionDirection;
      amount: number;
      valueDate: string;
      description: string;
    };
    await assertHomecellInScope(actor, body.homecellId);
    const homecell = await Homecell.findById(body.homecellId).select('_id name area zone').lean();
    if (!homecell) throw new NotFoundError('Homecell');
    const settings = await getSettings();

    const transaction = await withTransaction(async ({ session }) => {
      const { transaction: txn } = await postTransaction(
        {
          idempotencyKey: `adjustment:${idString(homecell._id)}:${Date.now()}:${actor.id}`,
          homecell: homecell._id,
          area: homecell.area,
          zone: homecell.zone,
          type: TransactionType.ADJUSTMENT,
          direction: body.direction,
          amountMinor: toMinor(body.amount),
          currency: settings.currency,
          valueDate: new Date(body.valueDate),
          description: body.description,
          createdBy: actor.id,
          approvedBy: actor.id,
          approvedAt: new Date(),
        },
        session,
      );
      return txn;
    });

    await recordAudit(
      {
        action: AuditAction.CREATE,
        module: AuditModule.FINANCE,
        description: `Posted ${body.direction} adjustment of ${body.amount} to ${homecell.name} — ${body.description}`,
        entityModel: 'LedgerTransaction',
        entityId: transaction._id,
        entityLabel: transaction.transactionRef,
        newValues: { direction: body.direction, amount: body.amount },
        zone: homecell.zone,
        area: homecell.area,
        homecell: homecell._id,
      },
      req,
    );

    await checkThresholdAndNotify(idString(homecell._id));
    return created(res, transaction);
  }),
);

financeRouter.post(
  '/ledger/:id/reverse',
  financeLimiter,
  requirePermission(Permission.FINANCE_REVERSE),
  validate({
    params: idParamSchema,
    body: z.object({ reason: z.string().trim().min(5, 'A reason is required').max(500) }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = currentUser(req);
    const original = await LedgerTransaction.findById(req.params.id).lean();
    if (!original) throw new NotFoundError('Transaction');
    await assertHomecellInScope(actor, original.homecell);

    const reason = (req.body as { reason: string }).reason;
    const reversal = await withTransaction(({ session }) =>
      reverseTransaction(req.params.id, reason, actor.id, session),
    );

    await recordAudit(
      {
        action: AuditAction.REVERSE,
        module: AuditModule.FINANCE,
        description: `Reversed transaction ${original.transactionRef} — ${reason}`,
        entityModel: 'LedgerTransaction',
        entityId: original._id,
        entityLabel: original.transactionRef,
        newValues: { reversalRef: reversal.transactionRef, reason },
        zone: original.zone,
        area: original.area,
        homecell: original.homecell,
      },
      req,
    );
    return created(res, reversal);
  }),
);

// ---------------------------------------------------------------------------
// Offerings
// ---------------------------------------------------------------------------

export const recordOfferingSchema = z.object({
  homecellId: objectIdSchema,
  amount: amountMajorSchema,
  date: z.string().date('Select the Sunday the offering was collected'),
  channel: z.enum(Object.values(OfferingChannel) as [string, ...string[]]).optional(),
  description: z.string().trim().max(400).optional(),
  receiptUrl: z.string().url().optional(),
  receiptPublicId: z.string().max(200).optional(),
});

financeRouter.get(
  '/offerings',
  requirePermission(Permission.FINANCE_VIEW),
  validate({
    query: paginationSchema.merge(orgFilterSchema).merge(dateRangeSchema).extend({
      status: z.enum(Object.values(TransactionStatus) as [string, ...string[]]).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    paginated(res, await offerings.listOfferings(currentUser(req), req.query as never)),
  ),
);

financeRouter.get(
  '/offerings/:id',
  requirePermission(Permission.FINANCE_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await offerings.getOffering(currentUser(req), req.params.id)),
  ),
);

financeRouter.post(
  '/offerings',
  financeLimiter,
  requirePermission(Permission.FINANCE_CREATE),
  validate({ body: recordOfferingSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await offerings.recordOffering(currentUser(req), req.body as never, req)),
  ),
);

financeRouter.post(
  '/offerings/:id/reverse',
  financeLimiter,
  requirePermission(Permission.FINANCE_REVERSE),
  validate({
    params: idParamSchema,
    body: z.object({ reason: z.string().trim().min(5, 'A reason is required').max(500) }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await offerings.reverseOffering(
        currentUser(req),
        req.params.id,
        (req.body as { reason: string }).reason,
        req,
      ),
    ),
  ),
);

// ---------------------------------------------------------------------------
// Expense categories
// ---------------------------------------------------------------------------

financeRouter.get(
  '/expense-categories',
  requirePermission(Permission.FINANCE_VIEW),
  validate({
    query: z.object({
      includeInactive: z
        .enum(['true', 'false'])
        .optional()
        .transform((v) => v === 'true'),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await expenses.listCategories((req.query as { includeInactive?: boolean }).includeInactive),
    ),
  ),
);

financeRouter.post(
  '/expense-categories',
  requirePermission(Permission.SETTINGS_UPDATE),
  validate({
    body: z.object({
      id: objectIdSchema.optional(),
      code: z.string().trim().toUpperCase().min(2).max(32),
      name: z.string().trim().min(2).max(120),
      description: z.string().trim().max(400).optional(),
      approvalThreshold: z.number().min(0).optional(),
      requiresReceipt: z.boolean().optional(),
      isActive: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await expenses.upsertCategory(currentUser(req), req.body as never, req)),
  ),
);

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const recordExpenseSchema = z.object({
  homecellId: objectIdSchema,
  categoryId: objectIdSchema,
  amount: amountMajorSchema,
  date: z.string().date('Select the date of the expense'),
  description: z.string().trim().min(3, 'Describe the expense').max(500),
  receiptUrl: z.string().url().optional(),
  receiptPublicId: z.string().max(200).optional(),
});

financeRouter.get(
  '/expenses',
  requirePermission(Permission.FINANCE_VIEW),
  validate({
    query: paginationSchema.merge(orgFilterSchema).merge(dateRangeSchema).extend({
      status: z.enum(Object.values(ExpenseStatus) as [string, ...string[]]).optional(),
      categoryId: objectIdSchema.optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    paginated(res, await expenses.listExpenses(currentUser(req), req.query as never)),
  ),
);

financeRouter.get(
  '/expenses/:id',
  requirePermission(Permission.FINANCE_VIEW),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await expenses.getExpense(currentUser(req), req.params.id)),
  ),
);

financeRouter.post(
  '/expenses',
  financeLimiter,
  requirePermission(Permission.FINANCE_CREATE),
  validate({ body: recordExpenseSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await expenses.recordExpense(currentUser(req), req.body as never, req)),
  ),
);

financeRouter.post(
  '/expenses/:id/approve',
  financeLimiter,
  requirePermission(Permission.FINANCE_APPROVE),
  validate({ params: idParamSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await expenses.approveExpense(currentUser(req), req.params.id, req)),
  ),
);

financeRouter.post(
  '/expenses/:id/reject',
  requirePermission(Permission.FINANCE_APPROVE),
  validate({
    params: idParamSchema,
    body: z.object({ reason: z.string().trim().min(5, 'A reason is required').max(500) }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await expenses.rejectExpense(
        currentUser(req),
        req.params.id,
        (req.body as { reason: string }).reason,
        req,
      ),
    ),
  ),
);

financeRouter.post(
  '/expenses/:id/reverse',
  financeLimiter,
  requirePermission(Permission.FINANCE_REVERSE),
  validate({
    params: idParamSchema,
    body: z.object({ reason: z.string().trim().min(5, 'A reason is required').max(500) }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await expenses.reverseExpense(
        currentUser(req),
        req.params.id,
        (req.body as { reason: string }).reason,
        req,
      ),
    ),
  ),
);
