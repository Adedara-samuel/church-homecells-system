import {
  Activity,
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Bell,
  Building2,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  CreditCard,
  FileText,
  Landmark,
  LayoutDashboard,
  MessageSquare,
  Radio,
  Receipt,
  ScrollText,
  Tags,
  Settings,
  Shield,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Any one of these permissions reveals the item. */
  permissions?: string[];
  /** Marks the item as matching only on an exact path. */
  exact?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

/**
 * Navigation mirrors the SRS §22 menu.
 *
 * Items are filtered by permission for presentation only — the API enforces the same
 * rules independently, so a hand-typed URL gains nothing.
 */
export const NAVIGATION: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, exact: true },
      { label: 'Notifications', href: '/notifications', icon: Bell, permissions: ['notifications.view'] },
    ],
  },
  {
    label: 'Church structure',
    items: [
      { label: 'Zones', href: '/structure/zones', icon: Landmark, permissions: ['zones.view'] },
      { label: 'Areas', href: '/structure/areas', icon: Building2, permissions: ['areas.view'] },
      { label: 'Homecells', href: '/structure/homecells', icon: Users, permissions: ['homecells.view'] },
    ],
  },
  {
    label: 'People',
    items: [
      { label: 'Members', href: '/members', icon: Users, permissions: ['members.view'] },
      { label: 'Transfers', href: '/transfers', icon: ArrowLeftRight, permissions: ['transfers.view'] },
      { label: 'Attendance', href: '/attendance', icon: CalendarCheck, permissions: ['attendance.view'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { label: 'Homecell purses', href: '/finance/purses', icon: Wallet, permissions: ['finance.view'] },
      { label: 'Offerings', href: '/finance/offerings', icon: Banknote, permissions: ['finance.view'] },
      { label: 'Expenses', href: '/finance/expenses', icon: Receipt, permissions: ['finance.view'] },
      { label: 'Remittances', href: '/finance/remittances', icon: ClipboardList, permissions: ['remittances.view'] },
      {
        label: 'Dues & levies',
        href: '/finance/dues',
        icon: CalendarClock,
        permissions: ['dues.view'],
      },
      { label: 'Payments', href: '/finance/payments', icon: CreditCard, permissions: ['payments.view'] },
      {
        label: 'Reconciliation',
        href: '/finance/reconciliation',
        icon: Activity,
        permissions: ['finance.reconcile'],
      },
      {
        label: 'Webhooks',
        href: '/finance/webhooks',
        icon: Radio,
        permissions: ['finance.reconcile'],
      },
      { label: 'Ledger', href: '/finance/ledger', icon: FileText, permissions: ['finance.view'] },
      {
        label: 'Expense categories',
        href: '/finance/expense-categories',
        icon: Tags,
        permissions: ['finance.view'],
      },
    ],
  },
  {
    label: 'Insight',
    items: [{ label: 'Reports', href: '/reports', icon: BarChart3, permissions: ['reports.view'] }],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Users', href: '/admin/users', icon: UserCog, permissions: ['users.view'] },
      { label: 'SMS', href: '/admin/sms', icon: MessageSquare, permissions: ['sms.view'] },
      { label: 'Audit logs', href: '/admin/audit', icon: ScrollText, permissions: ['audit.view'] },
      { label: 'Settings', href: '/admin/settings', icon: Settings, permissions: ['settings.view'] },
    ],
  },
];

export const ROLE_LABELS: Record<string, string> = {
  SYSTEM_ADMIN: 'System Administrator',
  CHURCH_ADMIN: 'Church Administrator',
  ZONAL_COORDINATOR: 'Zonal Coordinator',
  AREA_COORDINATOR: 'Area Coordinator',
  HOMECELL_COORDINATOR: 'Homecell Coordinator',
};

export const ROLE_ICON = Shield;
