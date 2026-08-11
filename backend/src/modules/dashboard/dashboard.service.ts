import type { FilterQuery, Model } from 'mongoose';
import {
  areaScopeFilter,
  homecellScopeFilter,
  resolveScopedFilter,
  zoneScopeFilter,
} from '../../middleware/scope';
import {
  ATTENDANCE_TYPE_LABELS,
  AttendanceStatus,
  AttendanceType,
  ExpenseStatus,
  MembershipStatus,
  OrgStatus,
  PaymentStatus,
  RemittanceStatus,
  ScopeLevel,
  TransactionStatus,
  TransactionType,
  TransferStatus,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { dayjs, endOfMonth, startOfMonth } from '../../utils/dates';
import { idString, toObjectId } from '../../utils/ids';
import { toMajor } from '../../utils/money';
import { Area } from '../areas/area.model';
import { Attendance, type AttendanceDoc } from '../attendance/attendance.model';
import { Expense } from '../finance/expense.model';
import { LedgerTransaction, type LedgerTransactionDoc } from '../finance/ledger.model';
import { listPurses } from '../finance/purse.service';
import { Homecell } from '../homecells/homecell.model';
import { Member, type MemberDoc } from '../members/member.model';
import { upcomingCelebrations } from '../members/member.service';
import { Notification } from '../notifications/notification.model';
import { Payment } from '../payments/payment.model';
import { Remittance } from '../remittances/remittance.model';
import { getSettings } from '../settings/settings.service';
import { MemberTransfer } from '../transfers/transfer.model';
import { Zone } from '../zones/zone.model';

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
    attendanceTrend: Record<string, unknown>[];
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

const SCOPE_LABELS: Record<ScopeLevel, string> = {
  CHURCH: 'Church-wide',
  ZONE: 'Zone',
  AREA: 'Area',
  HOMECELL: 'My Homecell',
};

/**
 * Assembles the role-appropriate dashboard.
 *
 * Every figure below is computed from the database under the caller's organisational
 * scope — there are no constants. A Homecell Coordinator and a System Administrator run
 * the same code path and differ only in the scope filter that is applied.
 */
export async function getDashboard(actor: AuthenticatedUser): Promise<DashboardData> {
  const settings = await getSettings();
  const monthStart = startOfMonth();
  const monthEnd = endOfMonth();

  const memberScope = await resolveScopedFilter<MemberDoc>(actor, {});
  const ledgerScope = await resolveScopedFilter<LedgerTransactionDoc>(actor, {});
  const attendanceScope = await resolveScopedFilter<AttendanceDoc>(actor, {});

  const [
    zoneCount,
    areaCount,
    homecellCount,
    membershipRows,
    newThisMonth,
    attendanceRows,
    ledgerRows,
    monthLedgerRows,
    pendingTransfers,
    pendingExpenses,
    pendingRemittances,
    failedPayments,
    unreadNotifications,
    celebrations,
    purses,
  ] = await Promise.all([
    Zone.countDocuments({ ...zoneScopeFilter(actor), status: OrgStatus.ACTIVE }),
    Area.countDocuments({ ...areaScopeFilter(actor), status: OrgStatus.ACTIVE }),
    Homecell.countDocuments({ ...homecellScopeFilter(actor), status: OrgStatus.ACTIVE }),
    Member.aggregate([
      { $match: memberScope },
      { $group: { _id: { status: '$membershipStatus', sex: '$sex' }, count: { $sum: 1 } } },
    ]),
    Member.countDocuments({
      ...memberScope,
      createdAt: { $gte: monthStart, $lte: monthEnd },
    }),
    Attendance.aggregate([
      { $match: { ...attendanceScope, date: { $gte: dayjs.utc().subtract(90, 'day').toDate() } } },
      {
        $group: {
          _id: '$type',
          present: { $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.PRESENT] }, 1, 0] } },
          total: { $sum: 1 },
        },
      },
    ]),
    LedgerTransaction.aggregate([
      { $match: { ...ledgerScope, status: TransactionStatus.POSTED } },
      { $group: { _id: '$type', amount: { $sum: '$amountMinor' }, direction: { $first: '$direction' } } },
    ]),
    LedgerTransaction.aggregate([
      {
        $match: {
          ...ledgerScope,
          status: TransactionStatus.POSTED,
          valueDate: { $gte: monthStart, $lte: monthEnd },
        },
      },
      { $group: { _id: '$type', amount: { $sum: '$amountMinor' } } },
    ]),
    countPendingTransfers(actor),
    Expense.countDocuments({ ...ledgerScope, status: ExpenseStatus.PENDING_APPROVAL }),
    Remittance.countDocuments({
      ...ledgerScope,
      status: { $in: [RemittanceStatus.PENDING_APPROVAL, RemittanceStatus.APPROVED] },
    }),
    Payment.countDocuments({ ...ledgerScope, status: PaymentStatus.FAILED }),
    Notification.countDocuments({ recipient: toObjectId(actor.id), isRead: false }),
    upcomingCelebrations(actor, settings.upcomingCelebrationWindowDays),
    listPurses(actor, {}),
  ]);

  // --- membership -----------------------------------------------------------
  const membership = { total: 0, active: 0, inactive: 0, male: 0, female: 0 };
  for (const row of membershipRows) {
    const { status, sex } = row._id as { status: MembershipStatus; sex: string };
    const count = row.count as number;
    membership.total += count;
    if (status === MembershipStatus.ACTIVE) {
      membership.active += count;
      if (sex === 'MALE') membership.male += count;
      if (sex === 'FEMALE') membership.female += count;
    } else {
      membership.inactive += count;
    }
  }

  // --- attendance -----------------------------------------------------------
  const byType = Object.values(AttendanceType).map((type) => {
    const row = attendanceRows.find((r) => r._id === type);
    const present = (row?.present as number) ?? 0;
    const total = (row?.total as number) ?? 0;
    return {
      type,
      label: ATTENDANCE_TYPE_LABELS[type],
      present,
      total,
      percentage: total > 0 ? Math.round((present / total) * 1000) / 10 : 0,
    };
  });
  const attendanceTotals = byType.reduce(
    (acc, t) => ({ present: acc.present + t.present, total: acc.total + t.total }),
    { present: 0, total: 0 },
  );

  // --- finance --------------------------------------------------------------
  const sumType = (rows: { _id: string; amount: number }[], type: TransactionType) =>
    rows.find((r) => r._id === type)?.amount ?? 0;

  const totalOfferings = sumType(ledgerRows, TransactionType.OFFERING);
  const totalExpenses = sumType(ledgerRows, TransactionType.EXPENSE);
  const totalRemittances =
    sumType(ledgerRows, TransactionType.REMITTANCE) + sumType(ledgerRows, TransactionType.PAYMENT_OUT);

  const currentBalanceMinor = purses.reduce((sum, p) => sum + p.balance.availableMinor, 0);
  const pendingBalanceMinor = purses.reduce((sum, p) => sum + p.balance.pendingMinor, 0);
  const aboveThreshold = purses.filter((p) => p.requiresRemittance);

  // --- charts ---------------------------------------------------------------
  const [attendanceTrend, financeTrend, membersByUnit] = await Promise.all([
    buildAttendanceTrend(attendanceScope),
    buildFinanceTrend(ledgerScope),
    buildMembersByUnit(actor, memberScope),
  ]);

  return {
    scope: {
      level: actor.scopeLevel,
      label: SCOPE_LABELS[actor.scopeLevel],
      zoneId: actor.zoneId,
      areaId: actor.areaId,
      homecellId: actor.homecellId,
    },
    currency: settings.currency,
    structure: { zones: zoneCount, areas: areaCount, homecells: homecellCount },
    membership: { ...membership, newThisMonth },
    attendance: {
      byType,
      overallPercentage:
        attendanceTotals.total > 0
          ? Math.round((attendanceTotals.present / attendanceTotals.total) * 1000) / 10
          : 0,
    },
    finance: {
      currentPurseBalance: toMajor(currentBalanceMinor),
      pendingBalance: toMajor(pendingBalanceMinor),
      offeringsThisMonth: toMajor(sumType(monthLedgerRows, TransactionType.OFFERING)),
      expensesThisMonth: toMajor(sumType(monthLedgerRows, TransactionType.EXPENSE)),
      remittancesThisMonth: toMajor(
        sumType(monthLedgerRows, TransactionType.REMITTANCE) +
          sumType(monthLedgerRows, TransactionType.PAYMENT_OUT),
      ),
      totalOfferings: toMajor(totalOfferings),
      totalExpenses: toMajor(totalExpenses),
      totalRemittances: toMajor(totalRemittances),
      homecellsAboveThreshold: aboveThreshold.length,
    },
    approvals: {
      pendingTransfers,
      pendingExpenses,
      pendingRemittances,
      failedPayments,
      total: pendingTransfers + pendingExpenses + pendingRemittances + failedPayments,
    },
    celebrations: {
      birthdays: celebrations.birthdays.length,
      anniversaries: celebrations.anniversaries.length,
    },
    notifications: { unread: unreadNotifications },
    charts: { attendanceTrend, financeTrend, membersByUnit },
    alerts: {
      homecellsRequiringRemittance: aboveThreshold.slice(0, 10).map((p) => ({
        homecellId: p.homecellId,
        name: p.homecellName,
        balance: p.available,
        threshold: p.threshold,
      })),
    },
  };
}

async function countPendingTransfers(actor: AuthenticatedUser): Promise<number> {
  const filter: FilterQuery<unknown> = { status: TransferStatus.PENDING };
  if (!actor.isChurchWide) {
    if (actor.homecellId) {
      filter.$or = [
        { previousHomecell: toObjectId(actor.homecellId) },
        { newHomecell: toObjectId(actor.homecellId) },
      ];
    } else if (actor.areaId) {
      filter.$or = [
        { previousArea: toObjectId(actor.areaId) },
        { newArea: toObjectId(actor.areaId) },
      ];
    } else if (actor.zoneId) {
      filter.$or = [
        { previousZone: toObjectId(actor.zoneId) },
        { newZone: toObjectId(actor.zoneId) },
      ];
    }
  }
  return MemberTransfer.countDocuments(filter);
}

/** Twelve weeks of present-counts per service type. */
async function buildAttendanceTrend(scope: FilterQuery<AttendanceDoc>) {
  const from = dayjs.utc().subtract(12, 'week').startOf('day').toDate();
  const rows = await Attendance.aggregate([
    { $match: { ...scope, date: { $gte: from }, status: AttendanceStatus.PRESENT } },
    { $group: { _id: { date: '$date', type: '$type' }, present: { $sum: 1 } } },
    { $sort: { '_id.date': 1 } },
  ]);

  const byDate = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = dayjs.utc(row._id.date as Date).format('YYYY-MM-DD');
    if (!byDate.has(key)) byDate.set(key, { date: key });
    byDate.get(key)![row._id.type as string] = row.present;
  }
  return [...byDate.values()];
}

/** Six months of offerings, expenses and remittances. */
async function buildFinanceTrend(scope: FilterQuery<LedgerTransactionDoc>) {
  const from = dayjs.utc().subtract(5, 'month').startOf('month').toDate();
  const rows = await LedgerTransaction.aggregate([
    {
      $match: {
        ...scope,
        status: TransactionStatus.POSTED,
        valueDate: { $gte: from },
        type: {
          $in: [TransactionType.OFFERING, TransactionType.EXPENSE, TransactionType.REMITTANCE],
        },
      },
    },
    {
      $group: {
        _id: {
          month: { $dateToString: { format: '%Y-%m', date: '$valueDate' } },
          type: '$type',
        },
        amount: { $sum: '$amountMinor' },
      },
    },
    { $sort: { '_id.month': 1 } },
  ]);

  // Every month in the window appears, even with no activity, so the chart has no gaps.
  const months: { month: string; offerings: number; expenses: number; remittances: number }[] = [];
  for (let i = 5; i >= 0; i -= 1) {
    const month = dayjs.utc().subtract(i, 'month').format('YYYY-MM');
    const pick = (type: TransactionType) =>
      toMajor(
        (rows.find((r) => r._id.month === month && r._id.type === type)?.amount as number) ?? 0,
      );
    months.push({
      month: dayjs.utc(`${month}-01`).format('MMM YY'),
      offerings: pick(TransactionType.OFFERING),
      expenses: pick(TransactionType.EXPENSE),
      remittances: pick(TransactionType.REMITTANCE),
    });
  }
  return months;
}

/** Member distribution across the level immediately below the caller's scope. */
async function buildMembersByUnit(actor: AuthenticatedUser, scope: FilterQuery<MemberDoc>) {
  const groupField =
    actor.scopeLevel === ScopeLevel.CHURCH
      ? 'zone'
      : actor.scopeLevel === ScopeLevel.ZONE
        ? 'area'
        : 'homecell';

  const rows = await Member.aggregate([
    { $match: { ...scope, membershipStatus: MembershipStatus.ACTIVE } },
    { $group: { _id: `$${groupField}`, members: { $sum: 1 } } },
    { $sort: { members: -1 } },
    { $limit: 12 },
  ]);

  // The three models share the shape this lookup needs; a narrow structural type
  // keeps the union callable without losing the `name` field.
  const model = (
    groupField === 'zone' ? Zone : groupField === 'area' ? Area : Homecell
  ) as unknown as Model<{ _id: unknown; name: string }>;
  const docs = await model
    .find({ _id: { $in: rows.map((r) => r._id) } })
    .select('name')
    .lean();
  const names = new Map(docs.map((d) => [idString(d._id), d.name]));

  return rows.map((r) => ({
    name: names.get(idString(r._id)) ?? 'Unassigned',
    members: r.members as number,
  }));
}
