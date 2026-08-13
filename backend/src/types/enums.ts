/**
 * Centralised domain enums.
 *
 * Every status / type string used across the system is declared here exactly once.
 * Nothing in the codebase should compare against an inline string literal.
 */

// ---------------------------------------------------------------------------
// Users & access control
// ---------------------------------------------------------------------------

export const Role = {
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  CHURCH_ADMIN: 'CHURCH_ADMIN',
  ZONAL_COORDINATOR: 'ZONAL_COORDINATOR',
  AREA_COORDINATOR: 'AREA_COORDINATOR',
  HOMECELL_COORDINATOR: 'HOMECELL_COORDINATOR',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = Object.values(Role) as Role[];

/** Human readable labels used in UI, reports and audit output. */
export const ROLE_LABELS: Record<Role, string> = {
  SYSTEM_ADMIN: 'System Administrator',
  CHURCH_ADMIN: 'Church Administrator',
  ZONAL_COORDINATOR: 'Zonal Coordinator',
  AREA_COORDINATOR: 'Area Coordinator',
  HOMECELL_COORDINATOR: 'Homecell Coordinator',
};

export const UserStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export const USER_STATUSES = Object.values(UserStatus) as UserStatus[];

/** The organisational level a role operates at. Drives scope enforcement. */
export const ScopeLevel = {
  CHURCH: 'CHURCH',
  ZONE: 'ZONE',
  AREA: 'AREA',
  HOMECELL: 'HOMECELL',
} as const;
export type ScopeLevel = (typeof ScopeLevel)[keyof typeof ScopeLevel];

export const ROLE_SCOPE_LEVEL: Record<Role, ScopeLevel> = {
  SYSTEM_ADMIN: ScopeLevel.CHURCH,
  CHURCH_ADMIN: ScopeLevel.CHURCH,
  ZONAL_COORDINATOR: ScopeLevel.ZONE,
  AREA_COORDINATOR: ScopeLevel.AREA,
  HOMECELL_COORDINATOR: ScopeLevel.HOMECELL,
};

// ---------------------------------------------------------------------------
// Organisation & membership
// ---------------------------------------------------------------------------

export const OrgStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
} as const;
export type OrgStatus = (typeof OrgStatus)[keyof typeof OrgStatus];

export const MembershipStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  TRANSFERRED_OUT: 'TRANSFERRED_OUT',
  RELOCATED: 'RELOCATED',
  DECEASED: 'DECEASED',
} as const;
export type MembershipStatus = (typeof MembershipStatus)[keyof typeof MembershipStatus];
export const MEMBERSHIP_STATUSES = Object.values(MembershipStatus) as MembershipStatus[];

export const MembershipCategory = {
  NEW_CONVERT: 'NEW_CONVERT',
  MEMBER: 'MEMBER',
  WORKER: 'WORKER',
  LEADER: 'LEADER',
  MINISTER: 'MINISTER',
} as const;
export type MembershipCategory = (typeof MembershipCategory)[keyof typeof MembershipCategory];
export const MEMBERSHIP_CATEGORIES = Object.values(MembershipCategory) as MembershipCategory[];

/**
 * SRS 11.8: the available values should be configurable according to the church's
 * approved member-data policy. The stored set is deliberately small and neutral.
 */
export const Sex = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  UNSPECIFIED: 'UNSPECIFIED',
} as const;
export type Sex = (typeof Sex)[keyof typeof Sex];
export const SEXES = Object.values(Sex) as Sex[];

export const MaritalStatus = {
  SINGLE: 'SINGLE',
  MARRIED: 'MARRIED',
  WIDOWED: 'WIDOWED',
  DIVORCED: 'DIVORCED',
  SEPARATED: 'SEPARATED',
} as const;
export type MaritalStatus = (typeof MaritalStatus)[keyof typeof MaritalStatus];
export const MARITAL_STATUSES = Object.values(MaritalStatus) as MaritalStatus[];

export const BaptismStatus = {
  NOT_BAPTISED: 'NOT_BAPTISED',
  WATER_BAPTISED: 'WATER_BAPTISED',
  SPIRIT_BAPTISED: 'SPIRIT_BAPTISED',
  BOTH: 'BOTH',
} as const;
export type BaptismStatus = (typeof BaptismStatus)[keyof typeof BaptismStatus];

// ---------------------------------------------------------------------------
// Transfers
// ---------------------------------------------------------------------------

export const TransferStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type TransferStatus = (typeof TransferStatus)[keyof typeof TransferStatus];

/** Which role must sign off on the current step of a transfer. */
export const TransferApprovalStage = {
  AREA_COORDINATOR: 'AREA_COORDINATOR',
  ZONAL_COORDINATOR: 'ZONAL_COORDINATOR',
  CHURCH_ADMIN: 'CHURCH_ADMIN',
} as const;
export type TransferApprovalStage =
  (typeof TransferApprovalStage)[keyof typeof TransferApprovalStage];

export const TransferScope = {
  SAME_AREA: 'SAME_AREA',
  CROSS_AREA: 'CROSS_AREA',
  CROSS_ZONE: 'CROSS_ZONE',
} as const;
export type TransferScope = (typeof TransferScope)[keyof typeof TransferScope];

// ---------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------

export const AttendanceType = {
  SUNDAY_HOMECELL: 'SUNDAY_HOMECELL',
  TUESDAY_MIRACLE_SERVICE: 'TUESDAY_MIRACLE_SERVICE',
  THURSDAY_HOUR_OF_EMPHASIS: 'THURSDAY_HOUR_OF_EMPHASIS',
} as const;
export type AttendanceType = (typeof AttendanceType)[keyof typeof AttendanceType];
export const ATTENDANCE_TYPES = Object.values(AttendanceType) as AttendanceType[];

/** BR-005 / BR-006 / BR-007: day-of-week each attendance type is locked to (0 = Sunday). */
export const ATTENDANCE_TYPE_WEEKDAY: Record<AttendanceType, number> = {
  SUNDAY_HOMECELL: 0,
  TUESDAY_MIRACLE_SERVICE: 2,
  THURSDAY_HOUR_OF_EMPHASIS: 4,
};

export const ATTENDANCE_TYPE_LABELS: Record<AttendanceType, string> = {
  SUNDAY_HOMECELL: 'Sunday Homecell',
  TUESDAY_MIRACLE_SERVICE: 'Tuesday Miracle Service',
  THURSDAY_HOUR_OF_EMPHASIS: 'Thursday Hour of Emphasis',
};

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export const AttendanceStatus = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
} as const;
export type AttendanceStatus = (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export const TransactionType = {
  OPENING_BALANCE: 'OPENING_BALANCE',
  OFFERING: 'OFFERING',
  OTHER_INCOME: 'OTHER_INCOME',
  EXPENSE: 'EXPENSE',
  REMITTANCE: 'REMITTANCE',
  PAYMENT_IN: 'PAYMENT_IN',
  PAYMENT_OUT: 'PAYMENT_OUT',
  ADJUSTMENT: 'ADJUSTMENT',
  REFUND: 'REFUND',
  REVERSAL: 'REVERSAL',
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];
export const TRANSACTION_TYPES = Object.values(TransactionType) as TransactionType[];

export const TransactionDirection = {
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT',
} as const;
export type TransactionDirection =
  (typeof TransactionDirection)[keyof typeof TransactionDirection];

/**
 * The natural direction of each transaction type against the Homecell purse.
 * REVERSAL / ADJUSTMENT are signed explicitly at creation time, so they are absent here.
 */
export const TRANSACTION_TYPE_DIRECTION: Partial<
  Record<TransactionType, TransactionDirection>
> = {
  OPENING_BALANCE: TransactionDirection.CREDIT,
  OFFERING: TransactionDirection.CREDIT,
  OTHER_INCOME: TransactionDirection.CREDIT,
  PAYMENT_IN: TransactionDirection.CREDIT,
  REFUND: TransactionDirection.CREDIT,
  EXPENSE: TransactionDirection.DEBIT,
  REMITTANCE: TransactionDirection.DEBIT,
  PAYMENT_OUT: TransactionDirection.DEBIT,
};

/**
 * Ledger entry lifecycle.
 *
 * Only POSTED entries affect the available balance (BR-010, BR-015).
 * PENDING entries are surfaced separately as "pending" in the purse summary.
 */
export const TransactionStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  POSTED: 'POSTED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REVERSED: 'REVERSED',
} as const;
export type TransactionStatus = (typeof TransactionStatus)[keyof typeof TransactionStatus];

export const ApprovalStatus = {
  NOT_REQUIRED: 'NOT_REQUIRED',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const ExpenseStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  REVERSED: 'REVERSED',
} as const;
export type ExpenseStatus = (typeof ExpenseStatus)[keyof typeof ExpenseStatus];

/**
 * A dues obligation for one Homecell for one period.
 *
 * PROCESSING means a provider checkout is open against it — the guard that stops the
 * same month being paid twice while the first payment is still in flight.
 */
export const DuesInvoiceStatus = {
  OUTSTANDING: 'OUTSTANDING',
  PROCESSING: 'PROCESSING',
  PAID: 'PAID',
  WAIVED: 'WAIVED',
  CANCELLED: 'CANCELLED',
} as const;
export type DuesInvoiceStatus = (typeof DuesInvoiceStatus)[keyof typeof DuesInvoiceStatus];

/** How often a dues definition raises an invoice. */
export const DuesFrequency = {
  MONTHLY: 'MONTHLY',
  ONE_OFF: 'ONE_OFF',
} as const;
export type DuesFrequency = (typeof DuesFrequency)[keyof typeof DuesFrequency];

export const RemittanceStatus = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  PROCESSING: 'PROCESSING',
  SUCCESSFUL: 'SUCCESSFUL',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REVERSED: 'REVERSED',
} as const;
export type RemittanceStatus = (typeof RemittanceStatus)[keyof typeof RemittanceStatus];

export const RemittanceChannel = {
  /** Coordinator paid offline (bank transfer / cash) and uploaded proof. */
  MANUAL: 'MANUAL',
  /** Disbursed through the configured payment provider. */
  PROVIDER_TRANSFER: 'PROVIDER_TRANSFER',
  /**
   * Coordinator paid online through the provider's hosted checkout. The purse is
   * debited by the payment webhook, never by the browser returning from checkout.
   */
  PROVIDER_CHECKOUT: 'PROVIDER_CHECKOUT',
} as const;
export type RemittanceChannel = (typeof RemittanceChannel)[keyof typeof RemittanceChannel];

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const PaymentProviderName = {
  PAYSTACK: 'PAYSTACK',
  FLUTTERWAVE: 'FLUTTERWAVE',
  MOCK: 'MOCK',
} as const;
export type PaymentProviderName =
  (typeof PaymentProviderName)[keyof typeof PaymentProviderName];
export const PAYMENT_PROVIDERS = Object.values(PaymentProviderName) as PaymentProviderName[];

export const PaymentDirection = {
  INBOUND: 'INBOUND',
  OUTBOUND: 'OUTBOUND',
} as const;
export type PaymentDirection = (typeof PaymentDirection)[keyof typeof PaymentDirection];

export const PaymentStatus = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  SUCCESSFUL: 'SUCCESSFUL',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REVERSED: 'REVERSED',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];
export const PAYMENT_STATUSES = Object.values(PaymentStatus) as PaymentStatus[];

/** Statuses that can never change again — guards against late/duplicate webhooks. */
export const TERMINAL_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.SUCCESSFUL,
  PaymentStatus.FAILED,
  PaymentStatus.CANCELLED,
  PaymentStatus.REVERSED,
  PaymentStatus.REFUNDED,
];

export const PaymentPurpose = {
  OFFERING: 'OFFERING',
  OTHER_INCOME: 'OTHER_INCOME',
  REMITTANCE: 'REMITTANCE',
  /** Monthly dues and zone levies settled through the provider. */
  DUES: 'DUES',
} as const;
export type PaymentPurpose = (typeof PaymentPurpose)[keyof typeof PaymentPurpose];

export const ReconciliationStatus = {
  UNRECONCILED: 'UNRECONCILED',
  MATCHED: 'MATCHED',
  MISMATCHED: 'MISMATCHED',
  ORPHANED: 'ORPHANED',
  MANUALLY_RESOLVED: 'MANUALLY_RESOLVED',
} as const;
export type ReconciliationStatus =
  (typeof ReconciliationStatus)[keyof typeof ReconciliationStatus];

// ---------------------------------------------------------------------------
// SMS & notifications
// ---------------------------------------------------------------------------

export const SmsProviderName = {
  TERMII: 'TERMII',
  TWILIO: 'TWILIO',
  MOCK: 'MOCK',
} as const;
export type SmsProviderName = (typeof SmsProviderName)[keyof typeof SmsProviderName];

export const SmsType = {
  BIRTHDAY: 'BIRTHDAY',
  WEDDING_ANNIVERSARY: 'WEDDING_ANNIVERSARY',
  TRANSACTIONAL: 'TRANSACTIONAL',
} as const;
export type SmsType = (typeof SmsType)[keyof typeof SmsType];

export const SmsDeliveryStatus = {
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  FAILED: 'FAILED',
} as const;
export type SmsDeliveryStatus = (typeof SmsDeliveryStatus)[keyof typeof SmsDeliveryStatus];

export const NotificationType = {
  PURSE_THRESHOLD_REACHED: 'PURSE_THRESHOLD_REACHED',
  REMITTANCE_PENDING: 'REMITTANCE_PENDING',
  REMITTANCE_SUBMITTED: 'REMITTANCE_SUBMITTED',
  REMITTANCE_APPROVED: 'REMITTANCE_APPROVED',
  REMITTANCE_FAILED: 'REMITTANCE_FAILED',
  TRANSFER_INITIATED: 'TRANSFER_INITIATED',
  TRANSFER_APPROVED: 'TRANSFER_APPROVED',
  TRANSFER_REJECTED: 'TRANSFER_REJECTED',
  EXPENSE_PENDING_APPROVAL: 'EXPENSE_PENDING_APPROVAL',
  EXPENSE_APPROVED: 'EXPENSE_APPROVED',
  EXPENSE_REJECTED: 'EXPENSE_REJECTED',
  PAYMENT_SUCCESSFUL: 'PAYMENT_SUCCESSFUL',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  BIRTHDAY_TODAY: 'BIRTHDAY_TODAY',
  ANNIVERSARY_TODAY: 'ANNIVERSARY_TODAY',
  ATTENDANCE_NOT_SUBMITTED: 'ATTENDANCE_NOT_SUBMITTED',
  RECONCILIATION_EXCEPTION: 'RECONCILIATION_EXCEPTION',
  DUES_ISSUED: 'DUES_ISSUED',
  DUES_DUE: 'DUES_DUE',
  DUES_OVERDUE: 'DUES_OVERDUE',
  DUES_PAID: 'DUES_PAID',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const NotificationSeverity = {
  INFO: 'INFO',
  SUCCESS: 'SUCCESS',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
} as const;
export type NotificationSeverity =
  (typeof NotificationSeverity)[keyof typeof NotificationSeverity];

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export const AuditAction = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  PASSWORD_CHANGE: 'PASSWORD_CHANGE',
  PASSWORD_RESET: 'PASSWORD_RESET',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  REVERSE: 'REVERSE',
  TRANSFER: 'TRANSFER',
  UPLOAD: 'UPLOAD',
  EXPORT: 'EXPORT',
  PAYMENT_INIT: 'PAYMENT_INIT',
  PAYMENT_WEBHOOK: 'PAYMENT_WEBHOOK',
  RECONCILE: 'RECONCILE',
  PERMISSION_CHANGE: 'PERMISSION_CHANGE',
  SMS_DISPATCH: 'SMS_DISPATCH',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export const AuditModule = {
  AUTH: 'AUTH',
  USERS: 'USERS',
  ZONES: 'ZONES',
  AREAS: 'AREAS',
  HOMECELLS: 'HOMECELLS',
  MEMBERS: 'MEMBERS',
  TRANSFERS: 'TRANSFERS',
  ATTENDANCE: 'ATTENDANCE',
  FINANCE: 'FINANCE',
  PAYMENTS: 'PAYMENTS',
  REMITTANCES: 'REMITTANCES',
  NOTIFICATIONS: 'NOTIFICATIONS',
  SMS: 'SMS',
  REPORTS: 'REPORTS',
  SETTINGS: 'SETTINGS',
  UPLOADS: 'UPLOADS',
} as const;
export type AuditModule = (typeof AuditModule)[keyof typeof AuditModule];
