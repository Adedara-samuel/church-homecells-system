import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';
import {
  PaymentProviderName,
  SmsProviderName,
  TransferApprovalStage,
} from '../../types/enums';

export interface AgeBand {
  label: string;
  min: number;
  /** `null` means open-ended, e.g. "66+". */
  max: number | null;
}

/**
 * Single-document configuration store (`key: 'SYSTEM'`).
 *
 * Everything an administrator can tune at runtime lives here — never in code.
 * Provider *credentials* stay in environment variables; only the choice of which
 * provider is active is stored in the database.
 */
export interface SystemSettingsDoc {
  _id: Types.ObjectId;
  key: 'SYSTEM';

  churchName: string;
  currency: string;

  // --- Finance ------------------------------------------------------------
  /** SRS 8.2 — church-wide default; a Homecell may override it. */
  maxPurseThresholdMinor: number;
  expenseApprovalRequired: boolean;
  /** Expenses at or above this amount always require approval. */
  expenseApprovalThresholdMinor: number;
  remittanceRequiresApproval: boolean;
  remittanceRequiresReceipt: boolean;
  generalPurseAccountName: string;
  generalPurseAccountNumber?: string;
  generalPurseBankName?: string;

  // --- Payments -----------------------------------------------------------
  activePaymentProvider: PaymentProviderName;
  paymentsEnabled: boolean;
  payoutsEnabled: boolean;

  // --- Transfers ----------------------------------------------------------
  /** SRS FR-TRANS-005 — configurable approval chains. */
  transferApprovalChainSameArea: TransferApprovalStage[];
  transferApprovalChainCrossArea: TransferApprovalStage[];
  transferApprovalChainCrossZone: TransferApprovalStage[];

  // --- SMS ----------------------------------------------------------------
  activeSmsProvider: SmsProviderName;
  smsSenderId: string;
  birthdaySmsEnabled: boolean;
  anniversarySmsEnabled: boolean;
  /** `{{name}}` and `{{church}}` are substituted at send time. */
  birthdayMessageTemplate: string;
  anniversaryMessageTemplate: string;

  // --- Reporting ----------------------------------------------------------
  ageBands: AgeBand[];
  upcomingCelebrationWindowDays: number;

  // --- Uploads ------------------------------------------------------------
  maxUploadSizeMb: number;
  allowedUploadMimeTypes: string[];

  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_AGE_BANDS: AgeBand[] = [
  { label: '0–12', min: 0, max: 12 },
  { label: '13–17', min: 13, max: 17 },
  { label: '18–25', min: 18, max: 25 },
  { label: '26–35', min: 26, max: 35 },
  { label: '36–45', min: 36, max: 45 },
  { label: '46–55', min: 46, max: 55 },
  { label: '56–65', min: 56, max: 65 },
  { label: '66+', min: 66, max: null },
];

export const DEFAULT_BIRTHDAY_TEMPLATE =
  'Happy Birthday {{name}}! We celebrate you and pray that this new year of your life will ' +
  "be filled with God's blessings, joy and fulfilment. Happy Birthday from your church family at {{church}}.";

export const DEFAULT_ANNIVERSARY_TEMPLATE =
  'Happy Wedding Anniversary {{name}}! We rejoice with you and pray for continued love, ' +
  'peace and grace in your home. With love from your church family at {{church}}.';

const ageBandSchema = new Schema<AgeBand>(
  {
    label: { type: String, required: true, trim: true, maxlength: 24 },
    min: { type: Number, required: true, min: 0 },
    max: { type: Number, default: null },
  },
  { _id: false },
);

const settingsSchema = new Schema<SystemSettingsDoc>(
  {
    key: { type: String, required: true, enum: ['SYSTEM'], default: 'SYSTEM' },

    churchName: { type: String, required: true, trim: true, default: 'The Church' },
    currency: { type: String, required: true, uppercase: true, default: 'NGN' },

    maxPurseThresholdMinor: { type: Number, required: true, default: 10_000_000, min: 0 },
    expenseApprovalRequired: { type: Boolean, default: true },
    expenseApprovalThresholdMinor: { type: Number, default: 0, min: 0 },
    remittanceRequiresApproval: { type: Boolean, default: true },
    remittanceRequiresReceipt: { type: Boolean, default: true },
    generalPurseAccountName: {
      type: String,
      default: 'General Homecell Purse',
      trim: true,
    },
    generalPurseAccountNumber: { type: String, trim: true },
    generalPurseBankName: { type: String, trim: true },

    activePaymentProvider: {
      type: String,
      enum: Object.values(PaymentProviderName),
      default: PaymentProviderName.MOCK,
    },
    paymentsEnabled: { type: Boolean, default: true },
    payoutsEnabled: { type: Boolean, default: true },

    transferApprovalChainSameArea: {
      type: [String],
      enum: Object.values(TransferApprovalStage),
      default: [TransferApprovalStage.AREA_COORDINATOR],
    },
    transferApprovalChainCrossArea: {
      type: [String],
      enum: Object.values(TransferApprovalStage),
      default: [TransferApprovalStage.AREA_COORDINATOR, TransferApprovalStage.ZONAL_COORDINATOR],
    },
    transferApprovalChainCrossZone: {
      type: [String],
      enum: Object.values(TransferApprovalStage),
      default: [
        TransferApprovalStage.AREA_COORDINATOR,
        TransferApprovalStage.ZONAL_COORDINATOR,
        TransferApprovalStage.CHURCH_ADMIN,
      ],
    },

    activeSmsProvider: {
      type: String,
      enum: Object.values(SmsProviderName),
      default: SmsProviderName.MOCK,
    },
    smsSenderId: { type: String, default: 'ChurchHC', trim: true, maxlength: 11 },
    birthdaySmsEnabled: { type: Boolean, default: true },
    anniversarySmsEnabled: { type: Boolean, default: true },
    birthdayMessageTemplate: { type: String, default: DEFAULT_BIRTHDAY_TEMPLATE, maxlength: 640 },
    anniversaryMessageTemplate: {
      type: String,
      default: DEFAULT_ANNIVERSARY_TEMPLATE,
      maxlength: 640,
    },

    ageBands: { type: [ageBandSchema], default: DEFAULT_AGE_BANDS },
    upcomingCelebrationWindowDays: { type: Number, default: 30, min: 1, max: 365 },

    maxUploadSizeMb: { type: Number, default: 5, min: 1, max: 50 },
    allowedUploadMimeTypes: {
      type: [String],
      default: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
    },

    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

settingsSchema.index({ key: 1 }, { unique: true });

export const SystemSettings: Model<SystemSettingsDoc> = model<SystemSettingsDoc>(
  'SystemSettings',
  settingsSchema,
);

/** A live document with Mongoose instance methods (`save`, `toObject`, …). */
export type SystemSettingsDocument = HydratedDocument<SystemSettingsDoc>;
