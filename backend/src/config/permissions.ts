import { Role } from '../types/enums';

/**
 * Centralised permission catalogue.
 *
 * Authorisation is a two-factor check performed entirely server-side:
 *   1. **Permission** — does this role have the verb at all?  (this file)
 *   2. **Organisational scope** — is the target record inside the user's Zone /
 *      Area / Homecell?  (see `middleware/scope.ts` + `services/scope.ts`)
 *
 * Both must pass. Hiding navigation in the frontend is presentation only.
 */
export const Permission = {
  // Users & settings
  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_DELETE: 'users.delete',
  USERS_MANAGE_PERMISSIONS: 'users.manage_permissions',

  // Church structure
  ZONES_VIEW: 'zones.view',
  ZONES_CREATE: 'zones.create',
  ZONES_UPDATE: 'zones.update',
  AREAS_VIEW: 'areas.view',
  AREAS_CREATE: 'areas.create',
  AREAS_UPDATE: 'areas.update',
  HOMECELLS_VIEW: 'homecells.view',
  HOMECELLS_CREATE: 'homecells.create',
  HOMECELLS_UPDATE: 'homecells.update',

  // Members
  MEMBERS_VIEW: 'members.view',
  MEMBERS_VIEW_SENSITIVE: 'members.view_sensitive',
  MEMBERS_CREATE: 'members.create',
  MEMBERS_UPDATE: 'members.update',
  MEMBERS_TRANSFER: 'members.transfer',
  TRANSFERS_VIEW: 'transfers.view',
  TRANSFERS_APPROVE: 'transfers.approve',

  // Attendance
  ATTENDANCE_VIEW: 'attendance.view',
  ATTENDANCE_CREATE: 'attendance.create',
  ATTENDANCE_UPDATE: 'attendance.update',

  // Finance
  FINANCE_VIEW: 'finance.view',
  FINANCE_CREATE: 'finance.create',
  FINANCE_APPROVE: 'finance.approve',
  FINANCE_REVERSE: 'finance.reverse',
  FINANCE_RECONCILE: 'finance.reconcile',
  REMITTANCE_VIEW: 'remittances.view',
  REMITTANCE_CREATE: 'remittances.create',
  REMITTANCE_APPROVE: 'remittances.approve',
  REMITTANCE_VERIFY: 'remittances.verify',
  DUES_VIEW: 'dues.view',
  DUES_PAY: 'dues.pay',
  /** Create and edit the dues and levies a Zone charges its Homecells. */
  DUES_CONFIGURE: 'dues.configure',
  DUES_WAIVE: 'dues.waive',

  // Payments
  PAYMENTS_VIEW: 'payments.view',
  PAYMENTS_INITIATE: 'payments.initiate',
  PAYMENTS_DISBURSE: 'payments.disburse',

  // Reporting & analytics
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',

  // Platform
  NOTIFICATIONS_VIEW: 'notifications.view',
  SMS_VIEW: 'sms.view',
  SMS_CONFIGURE: 'sms.configure',
  SMS_SEND: 'sms.send',
  AUDIT_VIEW: 'audit.view',
  AUDIT_VIEW_ALL: 'audit.view_all',
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_UPDATE: 'settings.update',
  UPLOADS_CREATE: 'uploads.create',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
export const ALL_PERMISSIONS = Object.values(Permission) as Permission[];

const P = Permission;

/**
 * Base permission grants per role, derived from SRS §5 and the §21 access matrix.
 * Individual users may be granted extra permissions or have specific ones revoked
 * (`user.extraPermissions` / `user.revokedPermissions`) without changing their role.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.SYSTEM_ADMIN]: [...ALL_PERMISSIONS],

  [Role.CHURCH_ADMIN]: [
    P.USERS_VIEW,
    P.USERS_CREATE,
    P.USERS_UPDATE,
    P.ZONES_VIEW,
    P.AREAS_VIEW,
    P.HOMECELLS_VIEW,
    P.MEMBERS_VIEW,
    P.MEMBERS_VIEW_SENSITIVE,
    P.MEMBERS_CREATE,
    P.MEMBERS_UPDATE,
    P.MEMBERS_TRANSFER,
    P.TRANSFERS_VIEW,
    P.TRANSFERS_APPROVE,
    P.ATTENDANCE_VIEW,
    P.FINANCE_VIEW,
    P.FINANCE_APPROVE,
    P.FINANCE_RECONCILE,
    P.REMITTANCE_VIEW,
    P.REMITTANCE_APPROVE,
    P.REMITTANCE_VERIFY,
    P.DUES_VIEW,
    P.DUES_CONFIGURE,
    P.DUES_WAIVE,
    P.PAYMENTS_VIEW,
    P.PAYMENTS_DISBURSE,
    P.REPORTS_VIEW,
    P.REPORTS_EXPORT,
    P.NOTIFICATIONS_VIEW,
    P.SMS_VIEW,
    P.AUDIT_VIEW,
    P.SETTINGS_VIEW,
    P.UPLOADS_CREATE,
  ],

  [Role.ZONAL_COORDINATOR]: [
    P.ZONES_VIEW,
    P.AREAS_VIEW,
    P.HOMECELLS_VIEW,
    P.MEMBERS_VIEW,
    P.MEMBERS_VIEW_SENSITIVE,
    P.TRANSFERS_VIEW,
    P.TRANSFERS_APPROVE,
    P.ATTENDANCE_VIEW,
    P.FINANCE_VIEW,
    P.FINANCE_APPROVE,
    P.REMITTANCE_VIEW,
    P.REMITTANCE_APPROVE,
    // A Zonal Coordinator owns the dues and levies their Homecells are charged.
    P.DUES_VIEW,
    P.DUES_CONFIGURE,
    P.DUES_WAIVE,
    P.PAYMENTS_VIEW,
    P.REPORTS_VIEW,
    P.REPORTS_EXPORT,
    P.NOTIFICATIONS_VIEW,
    P.UPLOADS_CREATE,
  ],

  [Role.AREA_COORDINATOR]: [
    P.AREAS_VIEW,
    P.HOMECELLS_VIEW,
    P.MEMBERS_VIEW,
    P.MEMBERS_VIEW_SENSITIVE,
    P.MEMBERS_UPDATE,
    P.TRANSFERS_VIEW,
    P.TRANSFERS_APPROVE,
    P.ATTENDANCE_VIEW,
    P.FINANCE_VIEW,
    P.FINANCE_APPROVE,
    P.REMITTANCE_VIEW,
    P.REMITTANCE_APPROVE,
    P.DUES_VIEW,
    P.PAYMENTS_VIEW,
    P.REPORTS_VIEW,
    P.REPORTS_EXPORT,
    P.NOTIFICATIONS_VIEW,
    P.UPLOADS_CREATE,
  ],

  [Role.HOMECELL_COORDINATOR]: [
    P.HOMECELLS_VIEW,
    P.MEMBERS_VIEW,
    P.MEMBERS_CREATE,
    P.MEMBERS_UPDATE,
    P.MEMBERS_TRANSFER,
    P.TRANSFERS_VIEW,
    P.ATTENDANCE_VIEW,
    P.ATTENDANCE_CREATE,
    P.ATTENDANCE_UPDATE,
    P.FINANCE_VIEW,
    P.FINANCE_CREATE,
    P.REMITTANCE_VIEW,
    P.REMITTANCE_CREATE,
    P.DUES_VIEW,
    P.DUES_PAY,
    P.PAYMENTS_VIEW,
    P.PAYMENTS_INITIATE,
    P.REPORTS_VIEW,
    P.REPORTS_EXPORT,
    P.NOTIFICATIONS_VIEW,
    P.UPLOADS_CREATE,
  ],
};

/** Effective permission set = role grants + per-user extras − per-user revocations. */
export function effectivePermissions(
  role: Role,
  extra: string[] = [],
  revoked: string[] = [],
): Set<Permission> {
  const set = new Set<Permission>(ROLE_PERMISSIONS[role] ?? []);
  for (const p of extra) {
    if ((ALL_PERMISSIONS as string[]).includes(p)) set.add(p as Permission);
  }
  for (const p of revoked) set.delete(p as Permission);
  return set;
}
