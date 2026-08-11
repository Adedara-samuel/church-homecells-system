import { Schema, model, type Model, type Types } from 'mongoose';
import { ExpenseStatus } from '../../types/enums';

// ---------------------------------------------------------------------------
// Expense categories (SRS 7.4 — configurable by the System Administrator)
// ---------------------------------------------------------------------------

export interface ExpenseCategoryDoc {
  _id: Types.ObjectId;
  code: string;
  name: string;
  description?: string;
  /** Expenses in this category above this amount always need approval. `0` = always. */
  approvalThresholdMinor: number;
  requiresReceipt: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<ExpenseCategoryDoc>(
  {
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 32 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 400 },
    approvalThresholdMinor: { type: Number, default: 0, min: 0 },
    requiresReceipt: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

categorySchema.index({ code: 1 }, { unique: true });
categorySchema.index({ isActive: 1 });

export const ExpenseCategory: Model<ExpenseCategoryDoc> = model<ExpenseCategoryDoc>(
  'ExpenseCategory',
  categorySchema,
);

// ---------------------------------------------------------------------------
// Expenses (SRS 7.3 / 7.5, BR-010, BR-015)
// ---------------------------------------------------------------------------

export interface ExpenseDoc {
  _id: Types.ObjectId;
  reference: string;
  homecell: Types.ObjectId;
  area: Types.ObjectId;
  zone: Types.ObjectId;

  date: Date;
  category: Types.ObjectId;
  description: string;
  amountMinor: number;
  currency: string;

  status: ExpenseStatus;
  /** Only set once the expense is APPROVED — BR-015. */
  ledgerTransaction?: Types.ObjectId | null;

  receiptUrl?: string | null;
  receiptPublicId?: string | null;

  submittedBy: Types.ObjectId;
  submittedAt: Date;
  approvedBy?: Types.ObjectId | null;
  approvedAt?: Date | null;
  rejectionReason?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const expenseSchema = new Schema<ExpenseDoc>(
  {
    reference: { type: String, required: true, trim: true, uppercase: true },
    homecell: { type: Schema.Types.ObjectId, ref: 'Homecell', required: true },
    area: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    zone: { type: Schema.Types.ObjectId, ref: 'Zone', required: true },

    date: { type: Date, required: true },
    category: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },

    status: {
      type: String,
      enum: Object.values(ExpenseStatus),
      required: true,
      default: ExpenseStatus.PENDING_APPROVAL,
    },
    ledgerTransaction: { type: Schema.Types.ObjectId, ref: 'LedgerTransaction', default: null },

    receiptUrl: { type: String, trim: true, default: null },
    receiptPublicId: { type: String, trim: true, default: null },

    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    submittedAt: { type: Date, required: true, default: () => new Date() },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: null, maxlength: 500 },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

expenseSchema.index({ reference: 1 }, { unique: true });
expenseSchema.index({ homecell: 1, date: -1 });
expenseSchema.index({ area: 1, status: 1 });
expenseSchema.index({ zone: 1, status: 1 });
expenseSchema.index({ status: 1, submittedAt: -1 });
expenseSchema.index({ category: 1 });

export const Expense: Model<ExpenseDoc> = model<ExpenseDoc>('Expense', expenseSchema);
