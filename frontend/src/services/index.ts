'use client';

import { api, type ApiResponse, type PaginationMeta } from '@/lib/api-client';
import type {
  AppNotification,
  AppUser,
  Area,
  AttendanceRecord,
  AttendanceRegister,
  AttendanceSummary,
  AuditEntry,
  Celebrations,
  DashboardData,
  Expense,
  ExpenseCategory,
  Homecell,
  IntegrationStatus,
  LedgerTransaction,
  Member,
  MemberTransfer,
  Offering,
  Payment,
  Purse,
  ReconciliationRun,
  Remittance,
  ReportDefinition,
  ReportResult,
  SmsLog,
  SystemSettings,
  Zone,
} from '@/types';

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface Page<T> {
  items: T[];
  pagination?: PaginationMeta;
}

/** Normalises the API envelope into the `{ items, pagination }` shape hooks expect. */
function toPage<T>(response: ApiResponse<T[]>): Page<T> {
  return { items: response.data ?? [], pagination: response.meta?.pagination };
}

/* -------------------------------------------------------------------------- */
/* Structure                                                                   */
/* -------------------------------------------------------------------------- */

export const zonesService = {
  list: (query: Query) => api.get<Zone[]>('/zones', { query }).then(toPage),
  options: () => api.get<Zone[]>('/zones/options').then((r) => r.data),
  get: (id: string) => api.get<Zone>(`/zones/${id}`).then((r) => r.data),
  create: (body: unknown) => api.post<Zone>('/zones', body).then((r) => r.data),
  update: (id: string, body: unknown) => api.patch<Zone>(`/zones/${id}`, body).then((r) => r.data),
  setStatus: (id: string, status: string) =>
    api.patch<Zone>(`/zones/${id}/status`, { status }).then((r) => r.data),
};

export const areasService = {
  list: (query: Query) => api.get<Area[]>('/areas', { query }).then(toPage),
  options: (zoneId?: string) => api.get<Area[]>('/areas/options', { query: { zoneId } }).then((r) => r.data),
  get: (id: string) => api.get<Area>(`/areas/${id}`).then((r) => r.data),
  create: (body: unknown) => api.post<Area>('/areas', body).then((r) => r.data),
  update: (id: string, body: unknown) => api.patch<Area>(`/areas/${id}`, body).then((r) => r.data),
  setStatus: (id: string, status: string) =>
    api.patch<Area>(`/areas/${id}/status`, { status }).then((r) => r.data),
};

export const homecellsService = {
  list: (query: Query) => api.get<Homecell[]>('/homecells', { query }).then(toPage),
  options: (query: Query = {}) =>
    api.get<Homecell[]>('/homecells/options', { query }).then((r) => r.data),
  get: (id: string) => api.get<Homecell>(`/homecells/${id}`).then((r) => r.data),
  create: (body: unknown) => api.post<Homecell>('/homecells', body).then((r) => r.data),
  update: (id: string, body: unknown) => api.patch<Homecell>(`/homecells/${id}`, body).then((r) => r.data),
  setStatus: (id: string, status: string) =>
    api.patch<Homecell>(`/homecells/${id}/status`, { status }).then((r) => r.data),
};

/* -------------------------------------------------------------------------- */
/* People                                                                      */
/* -------------------------------------------------------------------------- */

export const membersService = {
  list: (query: Query) => api.get<Member[]>('/members', { query }).then(toPage),
  get: (id: string) => api.get<Member>(`/members/${id}`).then((r) => r.data),
  create: (body: unknown) => api.post<Member>('/members', body).then((r) => r.data),
  update: (id: string, body: unknown) => api.patch<Member>(`/members/${id}`, body).then((r) => r.data),
  setStatus: (id: string, membershipStatus: string, reason?: string) =>
    api.patch<Member>(`/members/${id}/status`, { membershipStatus, reason }).then((r) => r.data),
  roster: (homecellId: string) => api.get<Member[]>(`/members/roster/${homecellId}`).then((r) => r.data),
  celebrations: (days = 30) =>
    api.get<Celebrations>('/members/celebrations', { query: { days } }).then((r) => r.data),
};

export const usersService = {
  list: (query: Query) => api.get<AppUser[]>('/users', { query }).then(toPage),
  get: (id: string) => api.get<AppUser>(`/users/${id}`).then((r) => r.data),
  assignable: (role: string) => api.get<AppUser[]>('/users/assignable', { query: { role } }).then((r) => r.data),
  create: (body: unknown) =>
    api.post<AppUser>('/users', body).then((r) => ({
      user: r.data,
      temporaryPassword: r.meta?.temporaryPassword as string | undefined,
    })),
  update: (id: string, body: unknown) => api.patch<AppUser>(`/users/${id}`, body).then((r) => r.data),
  setStatus: (id: string, status: string, reason?: string) =>
    api.patch<AppUser>(`/users/${id}/status`, { status, reason }).then((r) => r.data),
  updatePermissions: (id: string, extraPermissions: string[], revokedPermissions: string[]) =>
    api
      .patch<AppUser>(`/users/${id}/permissions`, { extraPermissions, revokedPermissions })
      .then((r) => r.data),
  resetPassword: (id: string, newPassword: string, mustChangePassword = true) =>
    api.post(`/users/${id}/reset-password`, { newPassword, mustChangePassword }).then((r) => r.data),
};

export const transfersService = {
  list: (query: Query) => api.get<MemberTransfer[]>('/transfers', { query }).then(toPage),
  get: (id: string) => api.get<MemberTransfer>(`/transfers/${id}`).then((r) => r.data),
  history: (memberId: string) =>
    api.get<MemberTransfer[]>(`/transfers/member/${memberId}`).then((r) => r.data),
  initiate: (body: unknown) => api.post<MemberTransfer>('/transfers', body).then((r) => r.data),
  approve: (id: string, comment?: string) =>
    api.post<MemberTransfer>(`/transfers/${id}/approve`, { comment }).then((r) => r.data),
  reject: (id: string, reason: string) =>
    api.post<MemberTransfer>(`/transfers/${id}/reject`, { reason }).then((r) => r.data),
  cancel: (id: string) => api.post<MemberTransfer>(`/transfers/${id}/cancel`).then((r) => r.data),
};

/* -------------------------------------------------------------------------- */
/* Attendance                                                                  */
/* -------------------------------------------------------------------------- */

export const attendanceService = {
  list: (query: Query) => api.get<AttendanceRecord[]>('/attendance', { query }).then(toPage),
  register: (homecellId: string, type: string, date: string) =>
    api
      .get<AttendanceRegister>('/attendance/register', { query: { homecellId, type, date } })
      .then((r) => r.data),
  record: (body: unknown) => api.post('/attendance', body).then((r) => r.data),
  update: (id: string, status: string, note?: string) =>
    api.patch(`/attendance/${id}`, { status, note }).then((r) => r.data),
  summary: (query: Query) =>
    api.get<AttendanceSummary>('/attendance/summary', { query }).then((r) => r.data),
  trend: (query: Query) =>
    api.get<Record<string, number | string>[]>('/attendance/trend', { query }).then((r) => r.data),
  memberHistory: (memberId: string, query: Query = {}) =>
    api.get(`/attendance/member/${memberId}`, { query }).then((r) => r.data),
};

/* -------------------------------------------------------------------------- */
/* Finance                                                                     */
/* -------------------------------------------------------------------------- */

export const financeService = {
  purses: (query: Query = {}) => api.get<Purse[]>('/finance/purses', { query }).then((r) => r.data),
  purse: (homecellId: string) => api.get<Purse>(`/finance/purses/${homecellId}`).then((r) => r.data),

  ledger: (query: Query) => api.get<LedgerTransaction[]>('/finance/ledger', { query }).then(toPage),
  transaction: (id: string) => api.get<LedgerTransaction>(`/finance/ledger/${id}`).then((r) => r.data),
  adjust: (body: unknown) => api.post<LedgerTransaction>('/finance/ledger/adjustments', body).then((r) => r.data),
  reverseTransaction: (id: string, reason: string) =>
    api.post<LedgerTransaction>(`/finance/ledger/${id}/reverse`, { reason }).then((r) => r.data),

  offerings: (query: Query) => api.get<Offering[]>('/finance/offerings', { query }).then(toPage),
  offering: (id: string) => api.get<Offering>(`/finance/offerings/${id}`).then((r) => r.data),
  recordOffering: (body: unknown) => api.post<Offering>('/finance/offerings', body).then((r) => r.data),
  reverseOffering: (id: string, reason: string) =>
    api.post<Offering>(`/finance/offerings/${id}/reverse`, { reason }).then((r) => r.data),

  categories: (includeInactive = false) =>
    api
      .get<ExpenseCategory[]>('/finance/expense-categories', { query: { includeInactive } })
      .then((r) => r.data),
  upsertCategory: (body: unknown) =>
    api.post<ExpenseCategory>('/finance/expense-categories', body).then((r) => r.data),

  expenses: (query: Query) => api.get<Expense[]>('/finance/expenses', { query }).then(toPage),
  expense: (id: string) => api.get<Expense>(`/finance/expenses/${id}`).then((r) => r.data),
  recordExpense: (body: unknown) => api.post<Expense>('/finance/expenses', body).then((r) => r.data),
  approveExpense: (id: string) => api.post<Expense>(`/finance/expenses/${id}/approve`).then((r) => r.data),
  rejectExpense: (id: string, reason: string) =>
    api.post<Expense>(`/finance/expenses/${id}/reject`, { reason }).then((r) => r.data),
  reverseExpense: (id: string, reason: string) =>
    api.post<Expense>(`/finance/expenses/${id}/reverse`, { reason }).then((r) => r.data),
};

export const remittancesService = {
  list: (query: Query) => api.get<Remittance[]>('/remittances', { query }).then(toPage),
  get: (id: string) => api.get<Remittance>(`/remittances/${id}`).then((r) => r.data),
  create: (body: unknown) => api.post<Remittance>('/remittances', body).then((r) => r.data),
  approve: (id: string) => api.post<Remittance>(`/remittances/${id}/approve`).then((r) => r.data),
  verify: (id: string) => api.post<Remittance>(`/remittances/${id}/verify`).then((r) => r.data),
  disburse: (id: string, body: unknown) =>
    api.post<Remittance>(`/remittances/${id}/disburse`, body).then((r) => r.data),
  reject: (id: string, reason: string) =>
    api.post<Remittance>(`/remittances/${id}/reject`, { reason }).then((r) => r.data),
  reverse: (id: string, reason: string) =>
    api.post<Remittance>(`/remittances/${id}/reverse`, { reason }).then((r) => r.data),
  attachReceipt: (id: string, receiptUrl: string, receiptPublicId?: string) =>
    api.post<Remittance>(`/remittances/${id}/receipt`, { receiptUrl, receiptPublicId }).then((r) => r.data),
};

export const paymentsService = {
  list: (query: Query) => api.get<Payment[]>('/payments', { query }).then(toPage),
  get: (id: string) => api.get<Payment>(`/payments/${id}`).then((r) => r.data),
  status: (reference: string) =>
    api.get<Payment>(`/payments/status/${reference}`, { anonymous: true }).then((r) => r.data),
  providers: () =>
    api
      .get<{ name: string; isConfigured: boolean; supportsPayouts: boolean }[]>('/payments/providers')
      .then((r) => r.data),
  initiate: (body: unknown) =>
    api
      .post<{
        reference: string;
        provider: string;
        authorizationUrl: string | null;
        amount: number;
        currency: string;
        status: string;
      }>('/payments/initiate', body)
      .then((r) => r.data),
  verify: (reference: string) => api.post<Payment>(`/payments/${reference}/verify`).then((r) => r.data),
  settle: (id: string, note: string) => api.post<Payment>(`/payments/${id}/settle`, { note }).then((r) => r.data),
  webhookEvents: (query: Query) => api.get<unknown[]>('/payments/webhook-events', { query }).then(toPage),

  reconciliationSummary: () =>
    api
      .get<{ counts: Record<string, number>; latestRun: ReconciliationRun | null }>(
        '/payments/reconciliation/summary',
      )
      .then((r) => r.data),
  reconciliationRuns: (query: Query) =>
    api.get<ReconciliationRun[]>('/payments/reconciliation/runs', { query }).then(toPage),
  reconciliationRun: (id: string) =>
    api.get<ReconciliationRun>(`/payments/reconciliation/runs/${id}`).then((r) => r.data),
  runReconciliation: (body: unknown) =>
    api.post<ReconciliationRun>('/payments/reconciliation/run', body).then((r) => r.data),
  resolveException: (runId: string, exceptionId: string, note: string) =>
    api
      .post<ReconciliationRun>(
        `/payments/reconciliation/runs/${runId}/exceptions/${exceptionId}/resolve`,
        { note },
      )
      .then((r) => r.data),
};

/* -------------------------------------------------------------------------- */
/* Platform                                                                    */
/* -------------------------------------------------------------------------- */

export const dashboardService = {
  get: () => api.get<DashboardData>('/dashboard').then((r) => r.data),
  celebrations: (days = 30) =>
    api.get<Celebrations>('/dashboard/celebrations', { query: { days } }).then((r) => r.data),
};

export const notificationsService = {
  list: (query: Query) =>
    api.get<AppNotification[]>('/notifications', { query }).then((response) => ({
      items: response.data ?? [],
      pagination: response.meta?.pagination,
      unreadCount: (response.meta?.unreadCount as number) ?? 0,
    })),
  unreadCount: () =>
    api.get<{ unreadCount: number }>('/notifications/unread-count').then((r) => r.data.unreadCount),
  markRead: (id: string) => api.patch(`/notifications/${id}/read`).then((r) => r.data),
  markAllRead: () => api.patch('/notifications/read-all').then((r) => r.data),
};

export const reportsService = {
  definitions: () => api.get<ReportDefinition[]>('/reports').then((r) => r.data),
  run: (key: string, query: Query) => api.get<ReportResult>(`/reports/${key}`, { query }).then((r) => r.data),
  summary: (query: Query) => api.get('/reports/summary', { query }).then((r) => r.data),
  export: (key: string, format: 'csv' | 'xlsx' | 'pdf', query: Query) =>
    api.download(
      `/reports/${key}/export`,
      { ...(query as Record<string, string | number | undefined>), format },
      `${key}-${new Date().toISOString().slice(0, 10)}.${format}`,
    ),
};

export const smsService = {
  list: (query: Query) => api.get<SmsLog[]>('/sms', { query }).then(toPage),
  statistics: () => api.get('/sms/statistics').then((r) => r.data),
  providers: () => api.get<{ name: string; isConfigured: boolean }[]>('/sms/providers').then((r) => r.data),
  sendTest: (phone: string, message: string) =>
    api.post<{ outcome: string }>('/sms/test', { phone, message }).then((r) => r.data),
  dispatchCelebrations: (date?: string) =>
    api.post('/sms/dispatch-celebrations', { date }).then((r) => r.data),
};

export const auditService = {
  list: (query: Query) => api.get<AuditEntry[]>('/audit-logs', { query }).then(toPage),
  forEntity: (entityModel: string, entityId: string) =>
    api.get<AuditEntry[]>(`/audit-logs/entity/${entityModel}/${entityId}`).then((r) => r.data),
  statistics: () => api.get('/audit-logs/statistics').then((r) => r.data),
};

export const settingsService = {
  get: () => api.get<SystemSettings>('/settings').then((r) => r.data),
  integrations: () => api.get<IntegrationStatus>('/settings/integrations').then((r) => r.data),
  update: (body: unknown) => api.patch<SystemSettings>('/settings', body).then((r) => r.data),
};

export const uploadsService = {
  config: () =>
    api
      .get<{ provider: string; maxFileSizeMb: number; acceptedTypes: string[] }>('/uploads/config')
      .then((r) => r.data),
  upload: (file: File, folder: 'members' | 'receipts' | 'documents') => api.upload(file, folder),
  remove: (publicId: string) => api.delete('/uploads', { publicId }).then((r) => r.data),
};
