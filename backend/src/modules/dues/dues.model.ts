import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  DuesFrequency,
  DuesInvoiceStatus,
  OrgStatus,
  PaymentProviderName,
} from '../../types/enums';

/**
 * A charge a Zone levies on its Homecells.
 *
 * Two shapes, one model:
 *   MONTHLY  — the standing monthly due; raises one invoice per Homecell per month,
 *              from the later of the Homecell's creation month and `startDate`.
 *   ONE_OFF  — a named levy (anniversary, building fund…) with a single due date.
 *              It stops raising invoices once that date passes, and the Zone can
 *              re-open it for the following year with a new due date.
 *
 * The amount is stored in minor units, like every other monetary value in the system,
 * and is snapshotted onto each invoice at generation time so that changing the amount
 * never silently rewrites what a Homecell already owes.
 */
export interface DuesDefinitionDoc {
  _id: Types.ObjectId;
  zone: Types.ObjectId;
  name: string;
  description?: string | null;
  frequency: DuesFrequency;

  amountMinor: number;
  currency: string;

  /** MONTHLY: first month charged. ONE_OFF: the day it is announced from. */
  startDate: Date;
  /** MONTHLY: last month charged, if the Zone has scheduled an end. */
  endDate?: Date | null;
  /** ONE_OFF: the day payment is due. Also the day the levy auto-closes. */
  dueDate?: Date | null;
  /** MONTHLY: day of the month each invoice falls due (1–28). */
  dueDayOfMonth: number;

  status: OrgStatus;
  /**
   * Set when the scheduled sweep closed a ONE_OFF levy because its due date passed.
   * Distinguishes "expired on its own" from "a coordinator switched it off", which
   * matters when the Zone re-opens it for the next year.
   */
  autoClosedAt?: Date | null;

  /**
   * The canonical monthly due for the Zone. At most one per Zone, enforced by a
   * partial unique index — a Homecell must never be billed two "monthly dues".
   */
  isPrimaryMonthlyDue: boolean;

  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const duesDefinitionSchema = new Schema<DuesDefinitionDoc>(
  {
    zone: { type: Schema.Types.ObjectId, ref: 'Zone', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, trim: true, maxlength: 400, default: null },
    frequency: { type: String, enum: Object.values(DuesFrequency), required: true },

    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },

    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    dueDate: { type: Date, default: null },
    // Capped at 28 so every month has the day — no "due on the 31st of February".
    dueDayOfMonth: { type: Number, min: 1, max: 28, default: 10 },

    status: { type: String, enum: Object.values(OrgStatus), default: OrgStatus.ACTIVE },
    autoClosedAt: { type: Date, default: null },
    isPrimaryMonthlyDue: { type: Boolean, default: false },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

duesDefinitionSchema.index({ zone: 1, status: 1 });
duesDefinitionSchema.index(
  { zone: 1, isPrimaryMonthlyDue: 1 },
  { unique: true, partialFilterExpression: { isPrimaryMonthlyDue: true } },
);

export const DuesDefinition: Model<DuesDefinitionDoc> = model<DuesDefinitionDoc>(
  'DuesDefinition',
  duesDefinitionSchema,
);
export type DuesDefinitionDocument = HydratedDocument<DuesDefinitionDoc>;

/**
 * One obligation: this Homecell owes this amount for this period.
 *
 * Invoices are generated, never edited into existence by a user, and the ledger debit
 * that clears one is posted only by the payment settlement path. `PROCESSING` is the
 * concurrency guard: an invoice with a checkout open against it cannot be added to a
 * second checkout, so a month can never be paid twice.
 */
export interface DuesInvoiceDoc {
  _id: Types.ObjectId;
  reference: string;

  definition: Types.ObjectId;
  homecell: Types.ObjectId;
  area: Types.ObjectId;
  zone: Types.ObjectId;

  /** Snapshot of the definition at generation time — invoices are historical records. */
  name: string;
  frequency: DuesFrequency;
  /** `2026-08` for a monthly invoice, `ONE_OFF` for a levy. */
  periodKey: string;
  /** Human label: "August 2026" / "Anniversary Levy 2026". */
  periodLabel: string;
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;

  amountMinor: number;
  currency: string;
  status: DuesInvoiceStatus;

  payment?: Types.ObjectId | null;
  paymentProvider?: PaymentProviderName | null;
  providerReference?: string | null;
  ledgerTransaction?: Types.ObjectId | null;

  paidAt?: Date | null;
  paidBy?: Types.ObjectId | null;
  waivedBy?: Types.ObjectId | null;
  waivedAt?: Date | null;
  waiverReason?: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const duesInvoiceSchema = new Schema<DuesInvoiceDoc>(
  {
    reference: { type: String, required: true, trim: true, uppercase: true },

    definition: { type: Schema.Types.ObjectId, ref: 'DuesDefinition', required: true },
    homecell: { type: Schema.Types.ObjectId, ref: 'Homecell', required: true },
    area: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    zone: { type: Schema.Types.ObjectId, ref: 'Zone', required: true },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    frequency: { type: String, enum: Object.values(DuesFrequency), required: true },
    periodKey: { type: String, required: true, trim: true },
    periodLabel: { type: String, required: true, trim: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    dueDate: { type: Date, required: true },

    amountMinor: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
    status: {
      type: String,
      enum: Object.values(DuesInvoiceStatus),
      required: true,
      default: DuesInvoiceStatus.OUTSTANDING,
    },

    payment: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    paymentProvider: {
      type: String,
      enum: [...Object.values(PaymentProviderName), null],
      default: null,
    },
    providerReference: { type: String, trim: true, default: null },
    ledgerTransaction: { type: Schema.Types.ObjectId, ref: 'LedgerTransaction', default: null },

    paidAt: { type: Date, default: null },
    paidBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    waivedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    waivedAt: { type: Date, default: null },
    waiverReason: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

duesInvoiceSchema.index({ reference: 1 }, { unique: true });
/**
 * The rule that makes generation safe to run repeatedly, including concurrently from
 * a request and the scheduled sweep: a second attempt to raise the same period for the
 * same Homecell is refused by the database, not by a read-then-write check.
 */
duesInvoiceSchema.index({ homecell: 1, definition: 1, periodKey: 1 }, { unique: true });
duesInvoiceSchema.index({ homecell: 1, status: 1, dueDate: 1 });
duesInvoiceSchema.index({ zone: 1, status: 1 });
duesInvoiceSchema.index({ area: 1, status: 1 });
duesInvoiceSchema.index({ status: 1, dueDate: 1 });

export const DuesInvoice: Model<DuesInvoiceDoc> = model<DuesInvoiceDoc>(
  'DuesInvoice',
  duesInvoiceSchema,
);
export type DuesInvoiceDocument = HydratedDocument<DuesInvoiceDoc>;
