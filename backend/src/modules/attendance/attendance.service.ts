import type { Request } from 'express';
import type { FilterQuery } from 'mongoose';
import { buildSort } from '../../middleware/validate';
import { assertHomecellInScope, resolveScopedFilter } from '../../middleware/scope';
import {
  ATTENDANCE_TYPE_LABELS,
  AttendanceStatus,
  AttendanceType,
  AuditAction,
  AuditModule,
  MembershipStatus,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import {
  calendarDateString,
  dateRange,
  isValidAttendanceDate,
  requiredWeekdayName,
  toCalendarDate,
  weekdayName,
} from '../../utils/dates';
import { BusinessRuleError, NotFoundError } from '../../utils/errors';
import { idString, toObjectId } from '../../utils/ids';
import { paginate } from '../../utils/query';
import { recordAudit } from '../audit/audit.service';
import { Homecell } from '../homecells/homecell.model';
import { Member } from '../members/member.model';
import { Attendance, type AttendanceDoc } from './attendance.model';

const SORTABLE = ['date', 'createdAt', 'status'];
const POPULATE = [
  { path: 'member', select: 'memberId firstName lastName photoUrl' },
  { path: 'homecell', select: 'name code' },
  { path: 'recordedBy', select: 'firstName lastName' },
];

/**
 * SRS 6.8 / BR-005..BR-007.
 *
 * The single place the day-of-week rule is enforced. Every write path funnels through
 * it, and the error message names both the day supplied and the day required so the
 * UI can show something actionable rather than "invalid date".
 */
export function assertAttendanceDateValid(type: AttendanceType, date: string | Date): void {
  if (isValidAttendanceDate(type, date)) return;
  const rule =
    type === AttendanceType.SUNDAY_HOMECELL
      ? 'BR-005'
      : type === AttendanceType.TUESDAY_MIRACLE_SERVICE
        ? 'BR-006'
        : 'BR-007';
  throw new BusinessRuleError(
    `${ATTENDANCE_TYPE_LABELS[type]} attendance can only be recorded on a ${requiredWeekdayName(
      type,
    )}. ${calendarDateString(date)} is a ${weekdayName(date)}.`,
    rule,
  );
}

export interface AttendanceEntryInput {
  memberId: string;
  status: AttendanceStatus;
  note?: string;
}

export interface RecordAttendanceInput {
  homecellId: string;
  type: AttendanceType;
  date: string;
  entries: AttendanceEntryInput[];
}

export interface RecordAttendanceResult {
  date: string;
  type: AttendanceType;
  homecellId: string;
  created: number;
  updated: number;
  skipped: number;
  present: number;
  absent: number;
  total: number;
}

/**
 * Records a whole register in one call.
 *
 * Uses `bulkWrite` with upserts keyed on the BR-009 unique index, so a resubmitted
 * register updates the existing rows instead of failing, and two coordinators saving
 * concurrently cannot produce duplicates.
 */
export async function recordAttendance(
  actor: AuthenticatedUser,
  input: RecordAttendanceInput,
  req: Request,
): Promise<RecordAttendanceResult> {
  assertAttendanceDateValid(input.type, input.date);
  await assertHomecellInScope(actor, input.homecellId);

  const homecell = await Homecell.findById(input.homecellId).select('_id name area zone').lean();
  if (!homecell) throw new NotFoundError('Homecell');

  const date = toCalendarDate(input.date);

  // Only active members of *this* Homecell may appear on its register.
  const memberIds = [...new Set(input.entries.map((e) => e.memberId))];
  const members = await Member.find({
    _id: { $in: memberIds.map(toObjectId) },
    homecell: homecell._id,
    membershipStatus: MembershipStatus.ACTIVE,
  })
    .select('_id')
    .lean();
  const validIds = new Set(members.map((m) => idString(m._id)));

  const accepted = input.entries.filter((e) => validIds.has(e.memberId));
  const skipped = input.entries.length - accepted.length;

  if (accepted.length === 0) {
    throw new NotFoundError('Active members for this Homecell');
  }

  const operations = accepted.map((entry) => ({
    updateOne: {
      filter: {
        member: toObjectId(entry.memberId),
        homecell: homecell._id,
        type: input.type,
        date,
      },
      update: {
        $set: {
          status: entry.status,
          note: entry.note,
          updatedBy: toObjectId(actor.id),
          area: homecell.area,
          zone: homecell.zone,
        },
        $setOnInsert: {
          member: toObjectId(entry.memberId),
          homecell: homecell._id,
          type: input.type,
          date,
          recordedBy: toObjectId(actor.id),
        },
      },
      upsert: true,
    },
  }));

  const result = await Attendance.bulkWrite(operations, { ordered: false });
  const created = result.upsertedCount ?? 0;
  const updated = result.modifiedCount ?? 0;

  const present = accepted.filter((e) => e.status === AttendanceStatus.PRESENT).length;

  await recordAudit(
    {
      action: created > 0 && updated === 0 ? AuditAction.CREATE : AuditAction.UPDATE,
      module: AuditModule.ATTENDANCE,
      description:
        `Recorded ${ATTENDANCE_TYPE_LABELS[input.type]} attendance for ${homecell.name} on ` +
        `${calendarDateString(date)} — ${present} present, ${accepted.length - present} absent`,
      entityModel: 'Attendance',
      entityLabel: `${input.type}:${calendarDateString(date)}`,
      newValues: { created, updated, present, absent: accepted.length - present },
      zone: homecell.zone,
      area: homecell.area,
      homecell: homecell._id,
    },
    req,
  );

  return {
    date: calendarDateString(date),
    type: input.type,
    homecellId: idString(homecell._id),
    created,
    updated,
    skipped,
    present,
    absent: accepted.length - present,
    total: accepted.length,
  };
}

/**
 * The register for one Homecell/type/date: every active member, with any existing
 * record already applied. This is what the attendance screen loads.
 */
export async function getRegister(
  actor: AuthenticatedUser,
  homecellId: string,
  type: AttendanceType,
  date: string,
) {
  await assertHomecellInScope(actor, homecellId);
  const valid = isValidAttendanceDate(type, date);

  const [members, existing] = await Promise.all([
    Member.find({ homecell: toObjectId(homecellId), membershipStatus: MembershipStatus.ACTIVE })
      .select('memberId firstName middleName lastName preferredName sex phone photoUrl')
      .sort({ firstName: 1, lastName: 1 })
      .lean(),
    Attendance.find({
      homecell: toObjectId(homecellId),
      type,
      date: toCalendarDate(date),
    }).lean(),
  ]);

  const byMember = new Map(existing.map((a) => [idString(a.member), a]));

  return {
    homecellId,
    type,
    date: calendarDateString(date),
    dayName: weekdayName(date),
    requiredDayName: requiredWeekdayName(type),
    isValidDate: valid,
    alreadyRecorded: existing.length > 0,
    entries: members.map((member) => {
      const record = byMember.get(idString(member._id));
      return {
        member,
        status: record?.status ?? AttendanceStatus.ABSENT,
        note: record?.note ?? null,
        attendanceId: record ? idString(record._id) : null,
      };
    }),
  };
}

export interface ListAttendanceQuery {
  page: number;
  limit: number;
  sort?: string;
  order: 'asc' | 'desc';
  type?: AttendanceType;
  status?: AttendanceStatus;
  memberId?: string;
  zoneId?: string;
  areaId?: string;
  homecellId?: string;
  from?: string;
  to?: string;
}

export async function listAttendance(actor: AuthenticatedUser, query: ListAttendanceQuery) {
  const scoped = await resolveScopedFilter<AttendanceDoc>(actor, query);
  const filter: FilterQuery<AttendanceDoc> = { ...scoped };
  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;
  if (query.memberId) filter.member = toObjectId(query.memberId);
  if (query.from || query.to) filter.date = dateRange(query.from, query.to) as never;

  return paginate(Attendance, {
    filter,
    page: query.page,
    limit: query.limit,
    sort: buildSort(query.sort, query.order, SORTABLE, 'date'),
    populate: POPULATE,
  });
}

export async function updateAttendanceRecord(
  actor: AuthenticatedUser,
  id: string,
  status: AttendanceStatus,
  note: string | undefined,
  req: Request,
) {
  const record = await Attendance.findById(id);
  if (!record) throw new NotFoundError('Attendance record');
  await assertHomecellInScope(actor, record.homecell);

  const previous = record.status;
  record.status = status;
  if (note !== undefined) record.note = note;
  record.updatedBy = toObjectId(actor.id);
  await record.save();

  await recordAudit(
    {
      action: AuditAction.UPDATE,
      module: AuditModule.ATTENDANCE,
      description: `Attendance changed from ${previous} to ${status} for ${calendarDateString(
        record.date,
      )} (${ATTENDANCE_TYPE_LABELS[record.type]})`,
      entityModel: 'Attendance',
      entityId: record._id,
      previousValues: { status: previous },
      newValues: { status },
      zone: record.zone,
      area: record.area,
      homecell: record.homecell,
    },
    req,
  );

  return Attendance.findById(id).populate(POPULATE).lean();
}

/**
 * Attendance rates and totals for a scope and period, grouped by service type.
 * Denominator is the number of registered rows, i.e. members expected that day.
 */
export async function attendanceSummary(
  actor: AuthenticatedUser,
  query: { zoneId?: string; areaId?: string; homecellId?: string; from?: string; to?: string },
) {
  const scoped = await resolveScopedFilter<AttendanceDoc>(actor, query);
  const match: FilterQuery<AttendanceDoc> = { ...scoped };
  if (query.from || query.to) match.date = dateRange(query.from, query.to) as never;

  const rows = await Attendance.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$type',
        present: { $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.PRESENT] }, 1, 0] } },
        absent: { $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.ABSENT] }, 1, 0] } },
        total: { $sum: 1 },
        meetings: { $addToSet: { date: '$date', homecell: '$homecell' } },
      },
    },
  ]);

  const byType = Object.values(AttendanceType).map((type) => {
    const row = rows.find((r) => r._id === type);
    const present = row?.present ?? 0;
    const total = row?.total ?? 0;
    return {
      type,
      label: ATTENDANCE_TYPE_LABELS[type],
      present,
      absent: row?.absent ?? 0,
      total,
      meetings: row?.meetings?.length ?? 0,
      percentage: total > 0 ? Math.round((present / total) * 1000) / 10 : 0,
    };
  });

  const present = byType.reduce((s, t) => s + t.present, 0);
  const total = byType.reduce((s, t) => s + t.total, 0);

  return {
    byType,
    overall: {
      present,
      absent: total - present,
      total,
      percentage: total > 0 ? Math.round((present / total) * 1000) / 10 : 0,
    },
  };
}

/** Present-count time series used by the dashboard trend charts. */
export async function attendanceTrend(
  actor: AuthenticatedUser,
  query: { zoneId?: string; areaId?: string; homecellId?: string; from?: string; to?: string },
) {
  const scoped = await resolveScopedFilter<AttendanceDoc>(actor, query);
  const match: FilterQuery<AttendanceDoc> = { ...scoped };
  match.date = dateRange(query.from, query.to) as never;

  const rows = await Attendance.aggregate([
    { $match: match },
    {
      $group: {
        _id: { date: '$date', type: '$type' },
        present: { $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.PRESENT] }, 1, 0] } },
        total: { $sum: 1 },
      },
    },
    { $sort: { '_id.date': 1 } },
  ]);

  // Pivot to one row per date with a column per service type — the shape Recharts wants.
  const byDate = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = calendarDateString(row._id.date);
    if (!byDate.has(key)) byDate.set(key, { date: key });
    const entry = byDate.get(key)!;
    entry[row._id.type] = row.present;
    entry[`${row._id.type}_total`] = row.total;
  }
  return [...byDate.values()];
}

/** Per-member attendance history and rate (SRS 6.11). */
export async function memberAttendanceHistory(
  actor: AuthenticatedUser,
  memberId: string,
  query: { from?: string; to?: string },
) {
  const member = await Member.findById(memberId).select('zone area homecell').lean();
  if (!member) throw new NotFoundError('Member');
  await assertHomecellInScope(actor, member.homecell);

  const filter: FilterQuery<AttendanceDoc> = { member: toObjectId(memberId) };
  if (query.from || query.to) filter.date = dateRange(query.from, query.to) as never;

  const [records, summary] = await Promise.all([
    Attendance.find(filter).sort({ date: -1 }).limit(200).lean(),
    Attendance.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$type',
          present: { $sum: { $cond: [{ $eq: ['$status', AttendanceStatus.PRESENT] }, 1, 0] } },
          total: { $sum: 1 },
        },
      },
    ]),
  ]);

  return {
    records,
    summary: summary.map((s) => ({
      type: s._id as AttendanceType,
      label: ATTENDANCE_TYPE_LABELS[s._id as AttendanceType],
      present: s.present,
      total: s.total,
      percentage: s.total > 0 ? Math.round((s.present / s.total) * 1000) / 10 : 0,
    })),
  };
}
