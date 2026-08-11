import type { FilterQuery, Model, PipelineStage } from 'mongoose';
import { resolveScopedFilter } from '../../middleware/scope';
import {
  ATTENDANCE_TYPE_LABELS,
  AttendanceStatus,
  AttendanceType,
  ExpenseStatus,
  MEMBERSHIP_STATUSES,
  MembershipStatus,
  RemittanceStatus,
  SEXES,
  TransactionDirection,
  TransactionStatus,
  TransactionType,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { ageFromDob, dateRange, dayjs } from '../../utils/dates';
import { idString, toObjectId } from '../../utils/ids';
import { toMajor } from '../../utils/money';
import { Area } from '../areas/area.model';
import { Zone } from '../zones/zone.model';
import { Attendance, type AttendanceDoc } from '../attendance/attendance.model';
import { Expense } from '../finance/expense.model';
import { LedgerTransaction, type LedgerTransactionDoc } from '../finance/ledger.model';
import { Offering } from '../finance/offering.model';
import { Homecell } from '../homecells/homecell.model';
import { Member, type MemberDoc } from '../members/member.model';
import { Remittance } from '../remittances/remittance.model';
import { getSettings } from '../settings/settings.service';
import { MemberTransfer, type MemberTransferDoc } from '../transfers/transfer.model';

export interface ReportFilters {
  zoneId?: string;
  areaId?: string;
  homecellId?: string;
  from?: string;
  to?: string;
}

/** Column definitions travel with the data so exports stay in step with the UI. */
export interface ReportColumn {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'money' | 'date' | 'percent';
}

export interface ReportResult {
  title: string;
  generatedAt: string;
  filters: ReportFilters;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  summary?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Member reports
// ---------------------------------------------------------------------------

/** SRS 11.1 / 11.3 / 11.5 — one query serves Homecell, Area and Zone member reports. */
export async function memberReport(
  actor: AuthenticatedUser,
  filters: ReportFilters & { membershipStatus?: MembershipStatus },
): Promise<ReportResult> {
  const scoped = await resolveScopedFilter<MemberDoc>(actor, filters);
  const filter: FilterQuery<MemberDoc> = { ...scoped };
  filter.membershipStatus = filters.membershipStatus ?? MembershipStatus.ACTIVE;
  if (filters.from || filters.to) {
    filter.dateJoinedChurch = dateRange(filters.from, filters.to) as never;
  }

  const members = await Member.find(filter)
    .select(
      'memberId firstName middleName lastName sex dateOfBirth phone location dateJoinedChurch membershipStatus membershipCategory homecell area zone',
    )
    .populate([
      { path: 'homecell', select: 'name code' },
      { path: 'area', select: 'name code' },
      { path: 'zone', select: 'name code' },
    ])
    .sort({ lastName: 1, firstName: 1 })
    .limit(10_000)
    .lean();

  const rows = members.map((m) => ({
    memberId: m.memberId,
    name: [m.firstName, m.middleName, m.lastName].filter(Boolean).join(' '),
    sex: m.sex,
    age: m.dateOfBirth ? ageFromDob(m.dateOfBirth) : null,
    phone: m.phone,
    location: [m.location?.city, m.location?.lga, m.location?.state].filter(Boolean).join(', '),
    homecell: (m.homecell as unknown as { name?: string })?.name ?? '',
    area: (m.area as unknown as { name?: string })?.name ?? '',
    zone: (m.zone as unknown as { name?: string })?.name ?? '',
    dateJoined: m.dateJoinedChurch ? dayjs.utc(m.dateJoinedChurch).format('YYYY-MM-DD') : '',
    membershipStatus: m.membershipStatus,
    category: m.membershipCategory,
  }));

  return {
    title: 'Member Report',
    generatedAt: new Date().toISOString(),
    filters,
    columns: [
      { key: 'memberId', label: 'Member ID' },
      { key: 'name', label: 'Name' },
      { key: 'sex', label: 'Sex' },
      { key: 'age', label: 'Age', type: 'number' },
      { key: 'phone', label: 'Phone' },
      { key: 'location', label: 'Location' },
      { key: 'homecell', label: 'Homecell' },
      { key: 'area', label: 'Area' },
      { key: 'zone', label: 'Zone' },
      { key: 'dateJoined', label: 'Date Joined', type: 'date' },
      { key: 'membershipStatus', label: 'Status' },
      { key: 'category', label: 'Category' },
    ],
    rows,
    summary: { totalMembers: rows.length },
  };
}

// ---------------------------------------------------------------------------
// Demographic reports (SRS 11.7 – 11.9)
// ---------------------------------------------------------------------------

export async function ageDemographicReport(
  actor: AuthenticatedUser,
  filters: ReportFilters,
): Promise<ReportResult> {
  const settings = await getSettings();
  const scoped = await resolveScopedFilter<MemberDoc>(actor, filters);

  const members = await Member.find({
    ...scoped,
    membershipStatus: MembershipStatus.ACTIVE,
    dateOfBirth: { $ne: null },
  })
    .select('dateOfBirth sex')
    .lean();

  const bands = settings.ageBands.map((band) => ({
    label: band.label,
    min: band.min,
    max: band.max,
    total: 0,
    male: 0,
    female: 0,
    unspecified: 0,
  }));

  let unknownAge = 0;
  for (const member of members) {
    if (!member.dateOfBirth) {
      unknownAge += 1;
      continue;
    }
    const age = ageFromDob(member.dateOfBirth);
    const band = bands.find((b) => age >= b.min && (b.max === null || age <= b.max));
    if (!band) continue;
    band.total += 1;
    if (member.sex === 'MALE') band.male += 1;
    else if (member.sex === 'FEMALE') band.female += 1;
    else band.unspecified += 1;
  }

  const total = bands.reduce((s, b) => s + b.total, 0);

  return {
    title: 'Age Demographic Report',
    generatedAt: new Date().toISOString(),
    filters,
    columns: [
      { key: 'label', label: 'Age Band' },
      { key: 'total', label: 'Members', type: 'number' },
      { key: 'male', label: 'Male', type: 'number' },
      { key: 'female', label: 'Female', type: 'number' },
      { key: 'unspecified', label: 'Unspecified', type: 'number' },
      { key: 'percentage', label: 'Share', type: 'percent' },
    ],
    rows: bands.map((b) => ({
      ...b,
      percentage: total > 0 ? Math.round((b.total / total) * 1000) / 10 : 0,
    })),
    summary: { total, unknownAge },
  };
}

export async function sexDemographicReport(
  actor: AuthenticatedUser,
  filters: ReportFilters,
): Promise<ReportResult> {
  const scoped = await resolveScopedFilter<MemberDoc>(actor, filters);
  const rows = await Member.aggregate([
    { $match: { ...scoped, membershipStatus: MembershipStatus.ACTIVE } },
    { $group: { _id: '$sex', count: { $sum: 1 } } },
  ]);

  const total = rows.reduce((s, r) => s + (r.count as number), 0);

  return {
    title: 'Sex Demographic Report',
    generatedAt: new Date().toISOString(),
    filters,
    columns: [
      { key: 'sex', label: 'Sex' },
      { key: 'members', label: 'Members', type: 'number' },
      { key: 'percentage', label: 'Share', type: 'percent' },
    ],
    rows: SEXES.map((sex) => {
      const members = rows.find((r) => r._id === sex)?.count ?? 0;
      return {
        sex,
        members,
        percentage: total > 0 ? Math.round((members / total) * 1000) / 10 : 0,
      };
    }),
    summary: { total },
  };
}

export async function locationReport(
  actor: AuthenticatedUser,
  filters: ReportFilters & { groupBy?: 'state' | 'lga' | 'city' | 'community' },
): Promise<ReportResult> {
  const scoped = await resolveScopedFilter<MemberDoc>(actor, filters);
  const groupBy = filters.groupBy ?? 'state';

  const rows = await Member.aggregate([
    { $match: { ...scoped, membershipStatus: MembershipStatus.ACTIVE } },
    {
      $group: {
        _id: { $ifNull: [`$location.${groupBy}`, 'Not recorded'] },
        members: { $sum: 1 },
      },
    },
    { $sort: { members: -1 } },
    { $limit: 200 },
  ]);

  const total = rows.reduce((s, r) => s + (r.members as number), 0);

  return {
    title: `Location Report by ${groupBy}`,
    generatedAt: new Date().toISOString(),
    filters,
    columns: [
      { key: 'location', label: groupBy.toUpperCase() },
      { key: 'members', label: 'Members', type: 'number' },
      { key: 'percentage', label: 'Share', type: 'percent' },
    ],
    rows: rows.map((r) => ({
      location: r._id,
      members: r.members,
      percentage: total > 0 ? Math.round((r.members / total) * 1000) / 10 : 0,
    })),
    summary: { total },
  };
}

// ---------------------------------------------------------------------------
// Attendance report (SRS 11.10)
// ---------------------------------------------------------------------------

export async function attendanceReport(
  actor: AuthenticatedUser,
  filters: ReportFilters & { type?: AttendanceType; groupBy?: 'homecell' | 'area' | 'zone' | 'date' },
): Promise<ReportResult> {
  const scoped = await resolveScopedFilter<AttendanceDoc>(actor, filters);
  const match: FilterQuery<AttendanceDoc> = { ...scoped };
  if (filters.type) match.type = filters.type;
  if (filters.from || filters.to) match.date = dateRange(filters.from, filters.to) as never;

  const groupBy = filters.groupBy ?? 'homecell';
  const groupKey = groupBy === 'date' ? '$date' : `$${groupBy}`;

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $group: {
        _id: groupKey,
        present: { $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.PRESENT] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.ABSENT] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
    { $sort: groupBy === 'date' ? { _id: -1 } : { present: -1 } },
    { $limit: 1000 },
  ];

  const rows = await Attendance.aggregate(pipeline);

  // Resolve organisational ids to names in one extra query rather than per row.
  let labels = new Map<string, string>();
  if (groupBy !== 'date') {
    const ids = rows.map((r) => r._id).filter(Boolean);
    // The three models share the shape this lookup needs; a narrow structural type
    // keeps the union callable without losing the `name` field.
    const model = (
      groupBy === 'homecell' ? Homecell : groupBy === 'area' ? Area : Zone
    ) as unknown as Model<{ _id: unknown; name: string }>;
    const docs = await model.find({ _id: { $in: ids } }).select('name').lean();
    labels = new Map(docs.map((d) => [idString(d._id), d.name]));
  }

  const totals = rows.reduce(
    (acc, r) => ({
      present: acc.present + (r.present as number),
      absent: acc.absent + (r.absent as number),
      total: acc.total + (r.total as number),
    }),
    { present: 0, absent: 0, total: 0 },
  );

  return {
    title: 'Attendance Report',
    generatedAt: new Date().toISOString(),
    filters,
    columns: [
      { key: 'group', label: groupBy === 'date' ? 'Date' : groupBy.toUpperCase() },
      { key: 'present', label: 'Present', type: 'number' },
      { key: 'absent', label: 'Absent', type: 'number' },
      { key: 'total', label: 'Expected', type: 'number' },
      { key: 'percentage', label: 'Attendance', type: 'percent' },
    ],
    rows: rows.map((r) => ({
      group:
        groupBy === 'date'
          ? dayjs.utc(r._id as Date).format('YYYY-MM-DD')
          : (labels.get(idString(r._id)) ?? 'Unassigned'),
      present: r.present,
      absent: r.absent,
      total: r.total,
      percentage: r.total > 0 ? Math.round((r.present / r.total) * 1000) / 10 : 0,
    })),
    summary: {
      ...totals,
      percentage: totals.total > 0 ? Math.round((totals.present / totals.total) * 1000) / 10 : 0,
      typeLabel: filters.type ? ATTENDANCE_TYPE_LABELS[filters.type] : 'All services',
    },
  };
}

// ---------------------------------------------------------------------------
// Financial reports (SRS 11.2 / 11.4 / 11.6 / 11.11)
// ---------------------------------------------------------------------------

/**
 * Financial position per Homecell, with the roll-up totals the Area, Zone and
 * church-wide reports all present. One aggregation covers every level, differing
 * only in the scope filter applied.
 */
export async function financialReport(
  actor: AuthenticatedUser,
  filters: ReportFilters,
): Promise<ReportResult> {
  const settings = await getSettings();
  const scoped = await resolveScopedFilter<LedgerTransactionDoc>(actor, filters);
  const match: FilterQuery<LedgerTransactionDoc> = {
    ...scoped,
    // A reversed entry stays in the arithmetic; its REVERSAL counterpart cancels it.
    status: { $in: [TransactionStatus.POSTED, TransactionStatus.REVERSED] },
  };
  if (filters.from || filters.to) match.valueDate = dateRange(filters.from, filters.to) as never;

  const rows = await LedgerTransaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: { homecell: '$homecell', type: '$type' },
        amount: { $sum: '$amountMinor' },
        direction: { $first: '$direction' },
      },
    },
    {
      $group: {
        _id: '$_id.homecell',
        entries: { $push: { type: '$_id.type', amount: '$amount', direction: '$direction' } },
      },
    },
  ]);

  const homecells = await Homecell.find({
    _id: { $in: rows.map((r) => r._id) },
  })
    .select('name code area zone')
    .populate([
      { path: 'area', select: 'name' },
      { path: 'zone', select: 'name' },
    ])
    .lean();
  const hcMap = new Map(homecells.map((h) => [idString(h._id), h]));

  const data = rows.map((row) => {
    const homecell = hcMap.get(idString(row._id));
    const entries = row.entries as { type: TransactionType; amount: number; direction: string }[];
    const sum = (type: TransactionType) =>
      entries.filter((e) => e.type === type).reduce((s, e) => s + e.amount, 0);
    const signedSum = entries.reduce(
      (s, e) => s + (e.direction === TransactionDirection.CREDIT ? e.amount : -e.amount),
      0,
    );

    return {
      homecell: homecell?.name ?? 'Unknown',
      area: (homecell?.area as unknown as { name?: string })?.name ?? '',
      zone: (homecell?.zone as unknown as { name?: string })?.name ?? '',
      openingBalance: toMajor(sum(TransactionType.OPENING_BALANCE)),
      offerings: toMajor(sum(TransactionType.OFFERING)),
      otherIncome: toMajor(sum(TransactionType.OTHER_INCOME) + sum(TransactionType.PAYMENT_IN)),
      expenses: toMajor(sum(TransactionType.EXPENSE)),
      remittances: toMajor(sum(TransactionType.REMITTANCE) + sum(TransactionType.PAYMENT_OUT)),
      adjustments: toMajor(
        entries
          .filter((e) =>
            (
              [
                TransactionType.ADJUSTMENT,
                TransactionType.REVERSAL,
                TransactionType.REFUND,
              ] as TransactionType[]
            ).includes(e.type),
          )
          .reduce(
            (s, e) => s + (e.direction === TransactionDirection.CREDIT ? e.amount : -e.amount),
            0,
          ),
      ),
      currentBalance: toMajor(signedSum),
    };
  });

  data.sort((a, b) => b.currentBalance - a.currentBalance);

  const totals = data.reduce(
    (acc, r) => ({
      openingBalance: acc.openingBalance + r.openingBalance,
      offerings: acc.offerings + r.offerings,
      otherIncome: acc.otherIncome + r.otherIncome,
      expenses: acc.expenses + r.expenses,
      remittances: acc.remittances + r.remittances,
      adjustments: acc.adjustments + r.adjustments,
      currentBalance: acc.currentBalance + r.currentBalance,
    }),
    {
      openingBalance: 0,
      offerings: 0,
      otherIncome: 0,
      expenses: 0,
      remittances: 0,
      adjustments: 0,
      currentBalance: 0,
    },
  );

  return {
    title: 'Financial Report',
    generatedAt: new Date().toISOString(),
    filters,
    columns: [
      { key: 'homecell', label: 'Homecell' },
      { key: 'area', label: 'Area' },
      { key: 'zone', label: 'Zone' },
      { key: 'openingBalance', label: 'Opening', type: 'money' },
      { key: 'offerings', label: 'Offerings', type: 'money' },
      { key: 'otherIncome', label: 'Other Income', type: 'money' },
      { key: 'expenses', label: 'Expenses', type: 'money' },
      { key: 'remittances', label: 'Remittances', type: 'money' },
      { key: 'adjustments', label: 'Adjustments', type: 'money' },
      { key: 'currentBalance', label: 'Balance', type: 'money' },
    ],
    rows: data,
    summary: { ...totals, currency: settings.currency, homecells: data.length },
  };
}

/** Detailed ledger listing — the drill-down behind any summary figure (SRS 11.11). */
export async function transactionReport(
  actor: AuthenticatedUser,
  filters: ReportFilters & { type?: TransactionType },
): Promise<ReportResult> {
  const scoped = await resolveScopedFilter<LedgerTransactionDoc>(actor, filters);
  const match: FilterQuery<LedgerTransactionDoc> = { ...scoped };
  if (filters.type) match.type = filters.type;
  if (filters.from || filters.to) match.valueDate = dateRange(filters.from, filters.to) as never;

  const transactions = await LedgerTransaction.find(match)
    .populate({ path: 'homecell', select: 'name' })
    .sort({ valueDate: -1 })
    .limit(10_000)
    .lean();

  return {
    title: 'Transaction Report',
    generatedAt: new Date().toISOString(),
    filters,
    columns: [
      { key: 'transactionRef', label: 'Reference' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'homecell', label: 'Homecell' },
      { key: 'type', label: 'Type' },
      { key: 'direction', label: 'Direction' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'status', label: 'Status' },
      { key: 'description', label: 'Description' },
    ],
    rows: transactions.map((t) => ({
      transactionRef: t.transactionRef,
      date: dayjs.utc(t.valueDate).format('YYYY-MM-DD'),
      homecell: (t.homecell as unknown as { name?: string })?.name ?? '',
      type: t.type,
      direction: t.direction,
      amount: toMajor(t.amountMinor),
      status: t.status,
      description: t.description,
    })),
    summary: { transactions: transactions.length },
  };
}

export async function remittanceReport(
  actor: AuthenticatedUser,
  filters: ReportFilters & { status?: RemittanceStatus },
): Promise<ReportResult> {
  const scoped = await resolveScopedFilter(actor, filters);
  const match: FilterQuery<unknown> = { ...scoped };
  if (filters.status) match.status = filters.status;
  if (filters.from || filters.to) match.date = dateRange(filters.from, filters.to) as never;

  const remittances = await Remittance.find(match)
    .populate({ path: 'homecell', select: 'name' })
    .sort({ date: -1 })
    .limit(10_000)
    .lean();

  const totalRemitted = remittances
    .filter((r) => r.status === RemittanceStatus.SUCCESSFUL)
    .reduce((s, r) => s + r.amountMinor, 0);

  return {
    title: 'Remittance Report',
    generatedAt: new Date().toISOString(),
    filters,
    columns: [
      { key: 'reference', label: 'Reference' },
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'homecell', label: 'Homecell' },
      { key: 'amount', label: 'Amount', type: 'money' },
      { key: 'channel', label: 'Channel' },
      { key: 'status', label: 'Status' },
      { key: 'receivingAccount', label: 'Destination' },
      { key: 'hasReceipt', label: 'Receipt' },
    ],
    rows: remittances.map((r) => ({
      reference: r.reference,
      date: dayjs.utc(r.date).format('YYYY-MM-DD'),
      homecell: (r.homecell as unknown as { name?: string })?.name ?? '',
      amount: toMajor(r.amountMinor),
      channel: r.channel,
      status: r.status,
      receivingAccount: r.receivingAccount,
      hasReceipt: r.receiptUrl ? 'Yes' : 'No',
    })),
    summary: { count: remittances.length, totalRemitted: toMajor(totalRemitted) },
  };
}

export async function transferReport(
  actor: AuthenticatedUser,
  filters: ReportFilters,
): Promise<ReportResult> {
  const clauses: FilterQuery<MemberTransferDoc>[] = [];
  if (!actor.isChurchWide) {
    if (actor.homecellId) {
      clauses.push({
        $or: [
          { previousHomecell: toObjectId(actor.homecellId) },
          { newHomecell: toObjectId(actor.homecellId) },
        ],
      });
    } else if (actor.areaId) {
      clauses.push({
        $or: [{ previousArea: toObjectId(actor.areaId) }, { newArea: toObjectId(actor.areaId) }],
      });
    } else if (actor.zoneId) {
      clauses.push({
        $or: [{ previousZone: toObjectId(actor.zoneId) }, { newZone: toObjectId(actor.zoneId) }],
      });
    }
  }

  const match: FilterQuery<MemberTransferDoc> = {};
  if (clauses.length) match.$and = clauses;
  if (filters.from || filters.to) match.requestedAt = dateRange(filters.from, filters.to) as never;

  const transfers = await MemberTransfer.find(match)
    .populate([
      { path: 'member', select: 'memberId firstName lastName' },
      { path: 'previousHomecell', select: 'name' },
      { path: 'newHomecell', select: 'name' },
    ])
    .sort({ requestedAt: -1 })
    .limit(10_000)
    .lean();

  return {
    title: 'Member Transfer Report',
    generatedAt: new Date().toISOString(),
    filters,
    columns: [
      { key: 'reference', label: 'Reference' },
      { key: 'member', label: 'Member' },
      { key: 'from', label: 'From' },
      { key: 'to', label: 'To' },
      { key: 'scope', label: 'Scope' },
      { key: 'status', label: 'Status' },
      { key: 'requestedAt', label: 'Requested', type: 'date' },
      { key: 'completedAt', label: 'Completed', type: 'date' },
    ],
    rows: transfers.map((t) => {
      const member = t.member as unknown as { memberId?: string; firstName?: string; lastName?: string };
      return {
        reference: t.reference,
        member: `${member?.firstName ?? ''} ${member?.lastName ?? ''} (${member?.memberId ?? ''})`.trim(),
        from: (t.previousHomecell as unknown as { name?: string })?.name ?? '',
        to: (t.newHomecell as unknown as { name?: string })?.name ?? '',
        scope: t.scope,
        status: t.status,
        requestedAt: dayjs.utc(t.requestedAt).format('YYYY-MM-DD'),
        completedAt: t.completedAt ? dayjs.utc(t.completedAt).format('YYYY-MM-DD') : '',
      };
    }),
    summary: { count: transfers.length },
  };
}

/** Combined operational snapshot used by the "church overview" report. */
export async function churchSummary(actor: AuthenticatedUser, filters: ReportFilters) {
  const [memberScope, ledgerScope] = await Promise.all([
    resolveScopedFilter<MemberDoc>(actor, filters),
    resolveScopedFilter<LedgerTransactionDoc>(actor, filters),
  ]);

  const [membersByStatus, offeringTotal, expenseTotal, remittanceTotal] = await Promise.all([
    Member.aggregate([
      { $match: memberScope },
      { $group: { _id: '$membershipStatus', count: { $sum: 1 } } },
    ]),
    Offering.aggregate([
      { $match: { ...ledgerScope, status: TransactionStatus.POSTED } },
      { $group: { _id: null, total: { $sum: '$amountMinor' } } },
    ]),
    Expense.aggregate([
      { $match: { ...ledgerScope, status: ExpenseStatus.APPROVED } },
      { $group: { _id: null, total: { $sum: '$amountMinor' } } },
    ]),
    Remittance.aggregate([
      { $match: { ...ledgerScope, status: RemittanceStatus.SUCCESSFUL } },
      { $group: { _id: null, total: { $sum: '$amountMinor' } } },
    ]),
  ]);

  return {
    members: Object.fromEntries(
      MEMBERSHIP_STATUSES.map((status) => [
        status,
        membersByStatus.find((r) => r._id === status)?.count ?? 0,
      ]),
    ),
    offerings: toMajor(offeringTotal[0]?.total ?? 0),
    expenses: toMajor(expenseTotal[0]?.total ?? 0),
    remittances: toMajor(remittanceTotal[0]?.total ?? 0),
  };
}
