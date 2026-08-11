/**
 * Domain types mirroring the backend contract.
 *
 * The API is the source of truth; these declarations keep the client honest about
 * the shapes it receives, and every enum value here matches `backend/src/types/enums.ts`.
 */

export type Role =
  | 'SYSTEM_ADMIN'
  | 'CHURCH_ADMIN'
  | 'ZONAL_COORDINATOR'
  | 'AREA_COORDINATOR'
  | 'HOMECELL_COORDINATOR';

export type ScopeLevel = 'CHURCH' | 'ZONE' | 'AREA' | 'HOMECELL';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
export type OrgStatus = 'ACTIVE' | 'INACTIVE';

export type MembershipStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'TRANSFERRED_OUT'
  | 'RELOCATED'
  | 'DECEASED';

export type MembershipCategory = 'NEW_CONVERT' | 'MEMBER' | 'WORKER' | 'LEADER' | 'MINISTER';
export type Sex = 'MALE' | 'FEMALE' | 'UNSPECIFIED';
export type MaritalStatus = 'SINGLE' | 'MARRIED' | 'WIDOWED' | 'DIVORCED' | 'SEPARATED';
export type BaptismStatus = 'NOT_BAPTISED' | 'WATER_BAPTISED' | 'SPIRIT_BAPTISED' | 'BOTH';

export type AttendanceType =
  | 'SUNDAY_HOMECELL'
  | 'TUESDAY_MIRACLE_SERVICE'
  | 'THURSDAY_HOUR_OF_EMPHASIS';
export type AttendanceStatus = 'PRESENT' | 'ABSENT';

export type TransferStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type TransferScope = 'SAME_AREA' | 'CROSS_AREA' | 'CROSS_ZONE';

export type TransactionType =
  | 'OPENING_BALANCE'
  | 'OFFERING'
  | 'OTHER_INCOME'
  | 'EXPENSE'
  | 'REMITTANCE'
  | 'PAYMENT_IN'
  | 'PAYMENT_OUT'
  | 'ADJUSTMENT'
  | 'REFUND'
  | 'REVERSAL';

export type TransactionDirection = 'CREDIT' | 'DEBIT';
export type TransactionStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'POSTED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REVERSED';

export type ExpenseStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'REVERSED';

export type RemittanceStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'PROCESSING'
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'CANCELLED'
  | 'REVERSED';

export type RemittanceChannel = 'MANUAL' | 'PROVIDER_TRANSFER';
export type PaymentProviderName = 'PAYSTACK' | 'FLUTTERWAVE' | 'MOCK';
export type PaymentDirection = 'INBOUND' | 'OUTBOUND';
export type PaymentStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'CANCELLED'
  | 'REVERSED'
  | 'REFUNDED';
export type PaymentPurpose = 'OFFERING' | 'OTHER_INCOME' | 'REMITTANCE';
export type ReconciliationStatus =
  | 'UNRECONCILED'
  | 'MATCHED'
  | 'MISMATCHED'
  | 'ORPHANED'
  | 'MANUALLY_RESOLVED';

export type SmsType = 'BIRTHDAY' | 'WEDDING_ANNIVERSARY' | 'TRANSACTIONAL';
export type SmsDeliveryStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED';
export type NotificationSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Reference {
  id: string;
  _id?: string;
  name: string;
  code?: string;
}

export interface SessionUser {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  role: Role;
  status: UserStatus;
  scopeLevel: ScopeLevel;
  zone: string | null;
  area: string | null;
  homecell: string | null;
  permissions: string[];
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

export interface AppUser {
  _id: string;
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  role: Role;
  status: UserStatus;
  zone?: Reference | null;
  area?: Reference | null;
  homecell?: Reference | null;
  extraPermissions: string[];
  revokedPermissions: string[];
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  createdAt: string;
}

export interface Zone {
  _id: string;
  id: string;
  code: string;
  name: string;
  description?: string;
  coordinator?: AppUser | null;
  status: OrgStatus;
  areaCount?: number;
  homecellCount?: number;
  memberCount?: number;
  createdAt: string;
}

export interface Area {
  _id: string;
  id: string;
  code: string;
  name: string;
  description?: string;
  zone: Reference;
  coordinator?: AppUser | null;
  status: OrgStatus;
  homecellCount?: number;
  memberCount?: number;
  createdAt: string;
}

export interface Homecell {
  _id: string;
  id: string;
  code: string;
  name: string;
  area: Reference;
  zone: Reference;
  coordinator?: AppUser | null;
  assistantCoordinator?: AppUser | null;
  meetingLocation?: string;
  meetingAddress?: string;
  maxPurseThresholdOverride?: number | null;
  status: OrgStatus;
  memberCount?: number;
  createdAt: string;
}

export interface MemberLocation {
  state?: string;
  lga?: string;
  city?: string;
  community?: string;
  street?: string;
}

export interface Member {
  _id: string;
  id: string;
  memberId: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  preferredName?: string;
  fullName: string;
  sex: Sex;
  dateOfBirth?: string | null;
  phone?: string;
  alternatePhone?: string;
  email?: string;
  maritalStatus: MaritalStatus;
  weddingAnniversary?: string | null;
  photoUrl?: string;
  photoPublicId?: string;
  residentialAddress?: string;
  location?: MemberLocation;
  occupation?: string;
  emergencyContact?: { name?: string; relationship?: string; phone?: string };
  dateJoinedChurch?: string | null;
  membershipStatus: MembershipStatus;
  membershipCategory: MembershipCategory;
  zone: Reference;
  area: Reference;
  homecell: Reference;
  previousHomecell?: Reference | null;
  baptismStatus: BaptismStatus;
  department?: string;
  membershipClassCompleted: boolean;
  notes?: string;
  /** Set when the viewer lacks `members.view_sensitive`. */
  sensitiveRedacted?: boolean;
  createdAt: string;
}

export interface AttendanceRecord {
  _id: string;
  member: Member;
  homecell: Reference;
  type: AttendanceType;
  date: string;
  status: AttendanceStatus;
  recordedBy?: { firstName: string; lastName: string };
  note?: string;
  createdAt: string;
}

export interface AttendanceRegister {
  homecellId: string;
  type: AttendanceType;
  date: string;
  dayName: string;
  requiredDayName: string;
  isValidDate: boolean;
  alreadyRecorded: boolean;
  entries: {
    member: Pick<
      Member,
      '_id' | 'memberId' | 'firstName' | 'middleName' | 'lastName' | 'preferredName' | 'sex' | 'phone' | 'photoUrl'
    >;
    status: AttendanceStatus;
    note: string | null;
    attendanceId: string | null;
  }[];
}

export interface AttendanceSummary {
  byType: {
    type: AttendanceType;
    label: string;
    present: number;
    absent: number;
    total: number;
    meetings: number;
    percentage: number;
  }[];
  overall: { present: number; absent: number; total: number; percentage: number };
}

export interface MemberTransfer {
  _id: string;
  reference: string;
  member: Member;
  previousZone: Reference;
  previousArea: Reference;
  previousHomecell: Reference;
  newZone: Reference;
  newArea: Reference;
  newHomecell: Reference;
  scope: TransferScope;
  reason: string;
  status: TransferStatus;
  approvalChain: {
    stage: string;
    approver?: { firstName: string; lastName: string; role: Role } | null;
    decidedAt?: string | null;
    decision?: 'APPROVED' | 'REJECTED' | null;
    comment?: string;
  }[];
  currentStageIndex: number;
  requestedBy: { firstName: string; lastName: string; role: Role };
  requestedAt: string;
  completedAt?: string | null;
  rejectionReason?: string;
}

export interface BalanceSummary {
  currency: string;
  availableMinor: number;
  pendingMinor: number;
  openingBalanceMinor: number;
  totalIncomingMinor: number;
  totalOfferingsMinor: number;
  totalOtherIncomeMinor: number;
  totalExpensesMinor: number;
  totalRemittedMinor: number;
  totalAdjustmentsMinor: number;
  transactionCount: number;
}

export interface Purse {
  homecellId: string;
  homecellName: string;
  homecellCode: string;
  areaId: string;
  zoneId: string;
  currency: string;
  balance: BalanceSummary;
  available: number;
  pending: number;
  thresholdMinor: number;
  threshold: number;
  thresholdSource: 'HOMECELL_OVERRIDE' | 'SYSTEM_DEFAULT';
  requiresRemittance: boolean;
  utilisationPercent: number;
  suggestedRemittanceMinor: number;
}

export interface LedgerTransaction {
  _id: string;
  transactionRef: string;
  homecell: Reference;
  type: TransactionType;
  direction: TransactionDirection;
  amountMinor: number;
  currency: string;
  status: TransactionStatus;
  valueDate: string;
  description: string;
  reference?: string;
  providerReference?: string | null;
  supportingDocumentUrl?: string | null;
  createdBy?: { firstName: string; lastName: string };
  approvedBy?: { firstName: string; lastName: string };
  reversedAt?: string | null;
  reversalReason?: string | null;
  createdAt: string;
}

export interface Offering {
  _id: string;
  reference: string;
  homecell: Reference;
  date: string;
  amountMinor: number;
  currency: string;
  channel: 'CASH' | 'BANK_TRANSFER' | 'ONLINE_PAYMENT';
  description?: string;
  status: TransactionStatus;
  receiptUrl?: string | null;
  recordedBy?: { firstName: string; lastName: string };
  createdAt: string;
}

export interface ExpenseCategory {
  _id: string;
  code: string;
  name: string;
  description?: string;
  approvalThresholdMinor: number;
  requiresReceipt: boolean;
  isActive: boolean;
}

export interface Expense {
  _id: string;
  reference: string;
  homecell: Reference;
  date: string;
  category: ExpenseCategory;
  description: string;
  amountMinor: number;
  currency: string;
  status: ExpenseStatus;
  receiptUrl?: string | null;
  submittedBy?: { firstName: string; lastName: string };
  approvedBy?: { firstName: string; lastName: string } | null;
  approvedAt?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
}

export interface Remittance {
  _id: string;
  reference: string;
  homecell: Reference;
  date: string;
  amountMinor: number;
  currency: string;
  channel: RemittanceChannel;
  status: RemittanceStatus;
  paymentReference?: string | null;
  receivingAccount: string;
  description?: string;
  receiptUrl?: string | null;
  providerReference?: string | null;
  recordedBy?: { firstName: string; lastName: string };
  approvedBy?: { firstName: string; lastName: string } | null;
  verifiedBy?: { firstName: string; lastName: string } | null;
  failureReason?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
}

export interface Payment {
  _id: string;
  reference: string;
  direction: PaymentDirection;
  purpose: PaymentPurpose;
  provider: PaymentProviderName;
  homecell: Reference;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  customerEmail?: string;
  customerName?: string;
  description?: string;
  providerReference?: string | null;
  authorizationUrl?: string | null;
  providerAmountMinor?: number | null;
  failureReason?: string | null;
  reconciliationStatus: ReconciliationStatus;
  reconciliationNote?: string | null;
  ledgerTransaction?: string | null;
  statusHistory: { status: PaymentStatus; at: string; source: string; note?: string }[];
  createdAt: string;
  completedAt?: string | null;
}

export interface ReconciliationException {
  _id: string;
  payment?: string | null;
  reference?: string | null;
  providerReference?: string | null;
  status: ReconciliationStatus;
  reason: string;
  internalAmountMinor?: number | null;
  providerAmountMinor?: number | null;
  internalStatus?: string | null;
  providerStatus?: string | null;
  resolved: boolean;
  resolutionNote?: string | null;
}

export interface ReconciliationRun {
  _id: string;
  provider: PaymentProviderName;
  from: string;
  to: string;
  trigger: 'SCHEDULED' | 'MANUAL';
  startedAt: string;
  completedAt?: string | null;
  totalChecked: number;
  matched: number;
  mismatched: number;
  orphaned: number;
  unresolved: number;
  exceptions?: ReconciliationException[];
  error?: string | null;
}

export interface AppNotification {
  _id: string;
  type: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  actionUrl?: string | null;
  isRead: boolean;
  readAt?: string | null;
  createdAt: string;
}

export interface SmsLog {
  _id: string;
  member?: { memberId: string; firstName: string; lastName: string } | null;
  recipientName?: string;
  phone: string;
  type: SmsType;
  message: string;
  provider: string;
  status: SmsDeliveryStatus;
  providerReference?: string | null;
  error?: string | null;
  segments: number;
  sentAt?: string | null;
  createdAt: string;
}

export interface AuditEntry {
  _id: string;
  user?: { firstName: string; lastName: string; email: string; role: Role } | null;
  userName?: string;
  userRole?: string;
  action: string;
  module: string;
  entityModel?: string | null;
  entityId?: string | null;
  entityLabel?: string | null;
  previousValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
  description: string;
  ipAddress?: string | null;
  success: boolean;
  createdAt: string;
}

export interface AgeBand {
  label: string;
  min: number;
  max: number | null;
}

export interface SystemSettings {
  _id: string;
  churchName: string;
  currency: string;
  maxPurseThreshold: number;
  maxPurseThresholdMinor: number;
  expenseApprovalRequired: boolean;
  expenseApprovalThreshold: number;
  remittanceRequiresApproval: boolean;
  remittanceRequiresReceipt: boolean;
  generalPurseAccountName: string;
  generalPurseAccountNumber?: string;
  generalPurseBankName?: string;
  activePaymentProvider: PaymentProviderName;
  paymentsEnabled: boolean;
  payoutsEnabled: boolean;
  transferApprovalChainSameArea: string[];
  transferApprovalChainCrossArea: string[];
  transferApprovalChainCrossZone: string[];
  activeSmsProvider: string;
  smsSenderId: string;
  birthdaySmsEnabled: boolean;
  anniversarySmsEnabled: boolean;
  birthdayMessageTemplate: string;
  anniversaryMessageTemplate: string;
  ageBands: AgeBand[];
  upcomingCelebrationWindowDays: number;
  maxUploadSizeMb: number;
  allowedUploadMimeTypes: string[];
}

export interface IntegrationStatus {
  payments: {
    active: PaymentProviderName;
    providers: { name: PaymentProviderName; isConfigured: boolean; supportsPayouts: boolean }[];
    paymentsEnabled: boolean;
    payoutsEnabled: boolean;
  };
  sms: {
    active: string;
    providers: { name: string; isConfigured: boolean }[];
    birthdayEnabled: boolean;
    anniversaryEnabled: boolean;
  };
  uploads: { provider: 'cloudinary' | 'local'; maxSizeMb: number };
}

export interface DashboardData {
  scope: {
    level: ScopeLevel;
    label: string;
    zoneId: string | null;
    areaId: string | null;
    homecellId: string | null;
  };
  currency: string;
  structure: { zones: number; areas: number; homecells: number };
  membership: {
    total: number;
    active: number;
    inactive: number;
    male: number;
    female: number;
    newThisMonth: number;
  };
  attendance: {
    byType: { type: AttendanceType; label: string; present: number; total: number; percentage: number }[];
    overallPercentage: number;
  };
  finance: {
    currentPurseBalance: number;
    pendingBalance: number;
    offeringsThisMonth: number;
    expensesThisMonth: number;
    remittancesThisMonth: number;
    totalOfferings: number;
    totalExpenses: number;
    totalRemittances: number;
    homecellsAboveThreshold: number;
  };
  approvals: {
    pendingTransfers: number;
    pendingExpenses: number;
    pendingRemittances: number;
    failedPayments: number;
    total: number;
  };
  celebrations: { birthdays: number; anniversaries: number };
  notifications: { unread: number };
  charts: {
    attendanceTrend: Record<string, number | string>[];
    financeTrend: { month: string; offerings: number; expenses: number; remittances: number }[];
    membersByUnit: { name: string; members: number }[];
  };
  alerts: {
    homecellsRequiringRemittance: {
      homecellId: string;
      name: string;
      balance: number;
      threshold: number;
    }[];
  };
}

export interface Celebrations {
  birthdays: (Member & { birthMonthDay: string })[];
  anniversaries: (Member & { anniversaryMonthDay: string })[];
}

export interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'money' | 'date' | 'percent';
}

export interface ReportResult {
  title: string;
  generatedAt: string;
  filters: Record<string, unknown>;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  summary?: Record<string, unknown>;
}

export interface ReportDefinition {
  key: string;
  label: string;
  description: string;
  group: string;
}
