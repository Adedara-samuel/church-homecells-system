import type { Request } from 'express';
import type { FilterQuery } from 'mongoose';
import { withTransaction } from '../../db/transaction';
import { buildSort } from '../../middleware/validate';
import { assertHomecellInScope, resolveScopedFilter } from '../../middleware/scope';
import {
  AuditAction,
  AuditModule,
  ExpenseStatus,
  NotificationSeverity,
  NotificationType,
  TransactionStatus,
  TransactionType,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { calendarDateString, dateRange, toCalendarDate } from '../../utils/dates';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { idString, references, toObjectId } from '../../utils/ids';
import { formatMoney, toMinor } from '../../utils/money';
import { paginate } from '../../utils/query';
import { diffValues, recordAudit } from '../audit/audit.service';
import { Homecell } from '../homecells/homecell.model';
import { notify, resolveEscalationRecipients } from '../notifications/notification.service';
import { getSettings } from '../settings/settings.service';
import { Expense, ExpenseCategory, type ExpenseDoc } from './expense.model';
import { LedgerTransaction } from './ledger.model';
import { assertSufficientBalance, postTransaction, reverseTransaction } from './ledger.service';

const SORTABLE = ['date', 'createdAt', 'amountMinor', 'status'];
const POPULATE = [
  { path: 'homecell', select: 'name code' },
  { path: 'category', select: 'name code' },
  { path: 'submittedBy', select: 'firstName lastName' },
  { path: 'approvedBy', select: 'firstName lastName' },
];

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(includeInactive = false) {
  const filter = includeInactive ? {} : { isActive: true };
  return ExpenseCategory.find(filter).sort({ name: 1 }).lean();
}

export async function upsertCategory(
  actor: AuthenticatedUser,
  input: {
    id?: string;
    code: string;
    name: string;
    description?: string;
    approvalThreshold?: number;
    requiresReceipt?: boolean;
    isActive?: boolean;
  },
  req: Request,
) {
  const payload = {
    code: input.code,
    name: input.name,
    description: input.description,
    approvalThresholdMinor:
      input.approvalThreshold !== undefined ? toMinor(input.approvalThreshold) : 0,
    requiresReceipt: input.requiresReceipt ?? false,
    isActive: input.isActive ?? true,
  };

  const category = input.id
    ? await ExpenseCategory.findByIdAndUpdate(input.id, { $set: payload }, { new: true })
    : await ExpenseCategory.create(payload);
  if (!category) throw new NotFoundError('Expense category');

  await recordAudit(
    {
      action: input.id ? AuditAction.UPDATE : AuditAction.CREATE,
      module: AuditModule.SETTINGS,
      description: `${input.id ? 'Updated' : 'Created'} expense category ${category.name}`,
      entityModel: 'ExpenseCategory',
      entityId: category._id,
      entityLabel: category.name,
      newValues: payload,
    },
    req,
  );

  return category;
}

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export interface RecordExpenseInput {
  homecellId: string;
  categoryId: string;
  amount: number;
  date: string;
  description: string;
  receiptUrl?: string;
  receiptPublicId?: string;
}

/**
 * Submits an expense.
 *
 * Nothing is posted to the ledger here: an expense only affects the available balance
 * once approved (BR-015). If the configuration says this expense needs no approval, it
 * is approved and posted in the same call so the workflow stays a single user action.
 */
export async function recordExpense(
  actor: AuthenticatedUser,
  input: RecordExpenseInput,
  req: Request,
) {
  await assertHomecellInScope(actor, input.homecellId);
  const homecell = await Homecell.findById(input.homecellId).select('_id name area zone').lean();
  if (!homecell) throw new NotFoundError('Homecell');

  const category = await ExpenseCategory.findById(input.categoryId).lean();
  if (!category || !category.isActive) {
    throw new ValidationError('The selected expense category is not available.');
  }

  const settings = await getSettings();
  const amountMinor = toMinor(input.amount);

  if (category.requiresReceipt && !input.receiptUrl) {
    throw new ValidationError(
      `A supporting receipt is required for ${category.name} expenses.`,
      [{ field: 'receiptUrl', message: 'A supporting receipt is required.' }],
    );
  }

  const needsApproval =
    settings.expenseApprovalRequired &&
    amountMinor >= Math.max(category.approvalThresholdMinor, settings.expenseApprovalThresholdMinor);

  const expense = await Expense.create({
    reference: references.expense(),
    homecell: homecell._id,
    area: homecell.area,
    zone: homecell.zone,
    date: toCalendarDate(input.date),
    category: category._id,
    description: input.description,
    amountMinor,
    currency: settings.currency,
    status: needsApproval ? ExpenseStatus.PENDING_APPROVAL : ExpenseStatus.APPROVED,
    receiptUrl: input.receiptUrl ?? null,
    receiptPublicId: input.receiptPublicId ?? null,
    submittedBy: actor.id,
    submittedAt: new Date(),
  });

  await recordAudit(
    {
      action: AuditAction.CREATE,
      module: AuditModule.FINANCE,
      description: `Recorded expense ${expense.reference} of ${formatMoney(
        amountMinor,
        settings.currency,
      )} (${category.name}) for ${homecell.name}`,
      entityModel: 'Expense',
      entityId: expense._id,
      entityLabel: expense.reference,
      newValues: {
        amount: input.amount,
        category: category.name,
        status: expense.status,
      },
      zone: homecell.zone,
      area: homecell.area,
      homecell: homecell._id,
    },
    req,
  );

  if (needsApproval) {
    const recipients = await resolveEscalationRecipients({
      areaId: homecell.area,
      zoneId: homecell.zone,
      includeHomecell: false,
      includeArea: true,
      includeZone: true,
    });
    await notify({
      recipients,
      type: NotificationType.EXPENSE_PENDING_APPROVAL,
      severity: NotificationSeverity.INFO,
      title: 'Expense awaiting approval',
      message: `${homecell.name} submitted a ${formatMoney(
        amountMinor,
        settings.currency,
      )} expense (${category.name}) for approval.`,
      entityModel: 'Expense',
      entityId: expense._id,
      actionUrl: `/finance/expenses/${idString(expense._id)}`,
      homecell: homecell._id,
      area: homecell.area,
      zone: homecell.zone,
    });
  } else {
    // Auto-approved: post immediately so the balance is correct straight away.
    await postApprovedExpense(idString(expense._id), actor.id);
  }

  return getExpense(actor, idString(expense._id));
}

/** Creates the DEBIT posting for an approved expense (BR-010). */
async function postApprovedExpense(expenseId: string, actorId: string): Promise<void> {
  await withTransaction(async ({ session, onRollback }) => {
    const expense = await Expense.findById(expenseId).session(session ?? null);
    if (!expense) throw new NotFoundError('Expense');
    if (expense.ledgerTransaction) return; // already posted

    await assertSufficientBalance(expense.homecell, expense.amountMinor, expense.currency);

    const { transaction } = await postTransaction(
      {
        idempotencyKey: `expense:${idString(expense._id)}`,
        homecell: expense.homecell,
        area: expense.area,
        zone: expense.zone,
        type: TransactionType.EXPENSE,
        amountMinor: expense.amountMinor,
        currency: expense.currency,
        valueDate: expense.date,
        description: expense.description,
        reference: expense.reference,
        sourceModel: 'Expense',
        sourceId: expense._id,
        supportingDocumentUrl: expense.receiptUrl,
        createdBy: expense.submittedBy,
        approvedBy: actorId,
        approvedAt: new Date(),
      },
      session,
    );
    onRollback(async () => {
      await LedgerTransaction.deleteOne({ _id: transaction._id });
    });

    expense.ledgerTransaction = transaction._id;
    await expense.save({ session: session ?? undefined });
  });
}

export async function approveExpense(
  actor: AuthenticatedUser,
  id: string,
  req: Request,
) {
  const expense = await Expense.findById(id);
  if (!expense) throw new NotFoundError('Expense');
  await assertHomecellInScope(actor, expense.homecell);

  if (expense.status !== ExpenseStatus.PENDING_APPROVAL) {
    throw new ConflictError(`This expense is already ${expense.status.toLowerCase().replace(/_/g, ' ')}.`);
  }

  const before = expense.toObject();
  expense.status = ExpenseStatus.APPROVED;
  expense.approvedBy = toObjectId(actor.id);
  expense.approvedAt = new Date();
  await expense.save();

  // If the purse cannot cover it, the approval is rolled back rather than
  // leaving an approved expense that never reduced the balance.
  try {
    await postApprovedExpense(id, actor.id);
  } catch (err) {
    expense.status = ExpenseStatus.PENDING_APPROVAL;
    expense.approvedBy = null;
    expense.approvedAt = null;
    await expense.save();
    throw err;
  }

  const { previousValues, newValues } = diffValues(before, expense.toObject());
  await recordAudit(
    {
      action: AuditAction.APPROVE,
      module: AuditModule.FINANCE,
      description: `Approved expense ${expense.reference} of ${formatMoney(
        expense.amountMinor,
        expense.currency,
      )}`,
      entityModel: 'Expense',
      entityId: expense._id,
      entityLabel: expense.reference,
      previousValues,
      newValues,
      zone: expense.zone,
      area: expense.area,
      homecell: expense.homecell,
    },
    req,
  );

  await notify({
    recipients: [idString(expense.submittedBy)],
    type: NotificationType.EXPENSE_APPROVED,
    severity: NotificationSeverity.SUCCESS,
    title: 'Expense approved',
    message: `Your expense ${expense.reference} of ${formatMoney(
      expense.amountMinor,
      expense.currency,
    )} has been approved and deducted from the Homecell purse.`,
    entityModel: 'Expense',
    entityId: expense._id,
    actionUrl: `/finance/expenses/${idString(expense._id)}`,
    homecell: expense.homecell,
    area: expense.area,
    zone: expense.zone,
  });

  return getExpense(actor, id);
}

export async function rejectExpense(
  actor: AuthenticatedUser,
  id: string,
  reason: string,
  req: Request,
) {
  const expense = await Expense.findById(id);
  if (!expense) throw new NotFoundError('Expense');
  await assertHomecellInScope(actor, expense.homecell);

  if (expense.status !== ExpenseStatus.PENDING_APPROVAL) {
    throw new ConflictError('Only an expense awaiting approval can be rejected.');
  }

  expense.status = ExpenseStatus.REJECTED;
  expense.rejectionReason = reason;
  expense.approvedBy = toObjectId(actor.id);
  expense.approvedAt = new Date();
  await expense.save();

  await recordAudit(
    {
      action: AuditAction.REJECT,
      module: AuditModule.FINANCE,
      description: `Rejected expense ${expense.reference} — ${reason}`,
      entityModel: 'Expense',
      entityId: expense._id,
      entityLabel: expense.reference,
      newValues: { status: ExpenseStatus.REJECTED, reason },
      zone: expense.zone,
      area: expense.area,
      homecell: expense.homecell,
    },
    req,
  );

  await notify({
    recipients: [idString(expense.submittedBy)],
    type: NotificationType.EXPENSE_REJECTED,
    severity: NotificationSeverity.WARNING,
    title: 'Expense rejected',
    message: `Your expense ${expense.reference} was rejected. Reason: ${reason}`,
    entityModel: 'Expense',
    entityId: expense._id,
    actionUrl: `/finance/expenses/${idString(expense._id)}`,
    homecell: expense.homecell,
    area: expense.area,
    zone: expense.zone,
  });

  return getExpense(actor, id);
}

export async function reverseExpense(
  actor: AuthenticatedUser,
  id: string,
  reason: string,
  req: Request,
) {
  const expense = await Expense.findById(id);
  if (!expense) throw new NotFoundError('Expense');
  await assertHomecellInScope(actor, expense.homecell);

  if (expense.status !== ExpenseStatus.APPROVED || !expense.ledgerTransaction) {
    throw new ConflictError('Only an approved and posted expense can be reversed.');
  }

  await withTransaction(async ({ session }) => {
    await reverseTransaction(idString(expense.ledgerTransaction), reason, actor.id, session);
    expense.status = ExpenseStatus.REVERSED;
    await expense.save({ session: session ?? undefined });
  });

  await recordAudit(
    {
      action: AuditAction.REVERSE,
      module: AuditModule.FINANCE,
      description: `Reversed expense ${expense.reference} — ${reason}`,
      entityModel: 'Expense',
      entityId: expense._id,
      entityLabel: expense.reference,
      newValues: { status: ExpenseStatus.REVERSED, reason },
      zone: expense.zone,
      area: expense.area,
      homecell: expense.homecell,
    },
    req,
  );

  return getExpense(actor, id);
}

export async function getExpense(actor: AuthenticatedUser, id: string) {
  const expense = await Expense.findById(id).populate(POPULATE).lean();
  if (!expense) throw new NotFoundError('Expense');
  await assertHomecellInScope(actor, expense.homecell);
  return expense;
}

export interface ListExpensesQuery {
  page: number;
  limit: number;
  sort?: string;
  order: 'asc' | 'desc';
  zoneId?: string;
  areaId?: string;
  homecellId?: string;
  categoryId?: string;
  status?: ExpenseStatus;
  from?: string;
  to?: string;
}

export async function listExpenses(actor: AuthenticatedUser, query: ListExpensesQuery) {
  const scoped = await resolveScopedFilter<ExpenseDoc>(actor, query);
  const filter: FilterQuery<ExpenseDoc> = { ...scoped };
  if (query.status) filter.status = query.status;
  if (query.categoryId) filter.category = toObjectId(query.categoryId);
  if (query.from || query.to) filter.date = dateRange(query.from, query.to) as never;

  return paginate(Expense, {
    filter,
    page: query.page,
    limit: query.limit,
    sort: buildSort(query.sort, query.order, SORTABLE, 'date'),
    populate: POPULATE,
  });
}

/** Count of expenses waiting on the caller — drives the "pending approvals" KPI. */
export async function pendingApprovalCount(actor: AuthenticatedUser): Promise<number> {
  const scoped = await resolveScopedFilter<ExpenseDoc>(actor, {});
  return Expense.countDocuments({ ...scoped, status: ExpenseStatus.PENDING_APPROVAL });
}
