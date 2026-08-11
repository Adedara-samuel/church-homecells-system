import type { Request } from 'express';
import type { FilterQuery } from 'mongoose';
import { Permission } from '../../config/permissions';
import { nextSequence } from '../../db/counter.model';
import { buildSort } from '../../middleware/validate';
import { assertHomecellInScope, assertInScope, resolveScopedFilter } from '../../middleware/scope';
import {
  AuditAction,
  AuditModule,
  MembershipStatus,
  OrgStatus,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { dayjs, toCalendarDate } from '../../utils/dates';
import { NotFoundError, ValidationError } from '../../utils/errors';
import { idString, references, toObjectId } from '../../utils/ids';
import { mergeFilters, paginate, searchFilter } from '../../utils/query';
import { diffValues, recordAudit } from '../audit/audit.service';
import { Homecell } from '../homecells/homecell.model';
import { Member, type MemberDoc } from './member.model';
import type { CreateMemberInput, ListMembersQuery, UpdateMemberInput } from './member.schemas';

const SORTABLE = ['createdAt', 'firstName', 'lastName', 'memberId', 'dateJoinedChurch'];
const POPULATE = [
  { path: 'homecell', select: 'name code' },
  { path: 'area', select: 'name code' },
  { path: 'zone', select: 'name code' },
  { path: 'previousHomecell', select: 'name code' },
];

/** Fields a user without `members.view_sensitive` never receives. */
const SENSITIVE_FIELDS = [
  'phone',
  'alternatePhone',
  'email',
  'residentialAddress',
  'emergencyContact',
  'notes',
  'dateOfBirth',
] as const;

export function redactSensitive(member: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...member };
  for (const field of SENSITIVE_FIELDS) delete copy[field];
  copy.sensitiveRedacted = true;
  return copy;
}

function applyRedaction(actor: AuthenticatedUser, doc: unknown): unknown {
  if (actor.can(Permission.MEMBERS_VIEW_SENSITIVE)) return doc;
  return redactSensitive(doc as Record<string, unknown>);
}

/** Blank strings from optional form fields become `undefined`, never stored empties. */
function clean<T extends Record<string, unknown>>(input: T): T {
  const out = {} as Record<string, unknown>;
  for (const [k, v] of Object.entries(input)) {
    if (v === '') continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      const nested = clean(v as Record<string, unknown>);
      if (Object.keys(nested).length) out[k] = nested;
      continue;
    }
    out[k] = v;
  }
  return out as T;
}

export async function listMembers(actor: AuthenticatedUser, query: ListMembersQuery) {
  const scoped = await resolveScopedFilter<MemberDoc>(actor, query);
  const filter: FilterQuery<MemberDoc> = { ...scoped };

  if (query.sex) filter.sex = query.sex as never;
  if (query.membershipStatus) filter.membershipStatus = query.membershipStatus as MembershipStatus;
  if (query.membershipCategory) filter.membershipCategory = query.membershipCategory as never;
  if (query.state) filter['location.state'] = query.state;
  if (query.lga) filter['location.lga'] = query.lga;
  if (query.city) filter['location.city'] = query.city;

  // Age is stored as a birth date, so an age range becomes a date-of-birth range.
  if (query.minAge !== undefined || query.maxAge !== undefined) {
    const dob: Record<string, Date> = {};
    if (query.maxAge !== undefined) {
      dob.$gte = dayjs.utc().subtract(query.maxAge + 1, 'year').add(1, 'day').startOf('day').toDate();
    }
    if (query.minAge !== undefined) {
      dob.$lte = dayjs.utc().subtract(query.minAge, 'year').endOf('day').toDate();
    }
    filter.dateOfBirth = dob as never;
  }

  if (query.joinedFrom || query.joinedTo) {
    filter.dateJoinedChurch = {
      ...(query.joinedFrom ? { $gte: toCalendarDate(query.joinedFrom) } : {}),
      ...(query.joinedTo ? { $lte: dayjs.utc(toCalendarDate(query.joinedTo)).endOf('day').toDate() } : {}),
    } as never;
  }

  const result = await paginate(Member, {
    filter: mergeFilters<MemberDoc>(
      filter,
      searchFilter(query.search, [
        'firstName',
        'lastName',
        'middleName',
        'memberId',
        'phone',
        'email',
      ]) as FilterQuery<MemberDoc>,
    ),
    page: query.page,
    limit: query.limit,
    sort: buildSort(query.sort, query.order, SORTABLE, 'createdAt'),
    populate: POPULATE,
    transform: (doc) => applyRedaction(actor, doc),
  });

  return result;
}

export async function getMember(actor: AuthenticatedUser, id: string) {
  const member = await Member.findById(id).populate(POPULATE).lean();
  if (!member) throw new NotFoundError('Member');
  assertInScope(actor, { zone: member.zone, area: member.area, homecell: member.homecell });
  return applyRedaction(actor, member);
}

/**
 * Registers a member.
 *
 * The caller supplies only the Homecell; Area and Zone are derived from it so the
 * BR-003 invariant (member's Homecell belongs to their Area and Zone) holds by
 * construction rather than by validation.
 */
export async function createMember(
  actor: AuthenticatedUser,
  input: CreateMemberInput,
  req: Request,
) {
  const homecell = await Homecell.findById(input.homecellId).select('_id name area zone status').lean();
  if (!homecell) throw new ValidationError('The selected Homecell does not exist.');
  if (homecell.status === OrgStatus.INACTIVE) {
    throw new ValidationError('Members cannot be registered into an inactive Homecell.');
  }
  await assertHomecellInScope(actor, homecell._id);

  const data = clean(input as Record<string, unknown>) as CreateMemberInput;
  const sequence = await nextSequence('member');

  const member = await Member.create({
    ...data,
    memberId: references.member(sequence),
    dateOfBirth: data.dateOfBirth ? toCalendarDate(data.dateOfBirth) : null,
    weddingAnniversary: data.weddingAnniversary ? toCalendarDate(data.weddingAnniversary) : null,
    dateJoinedChurch: data.dateJoinedChurch ? toCalendarDate(data.dateJoinedChurch) : new Date(),
    membershipStatus: data.membershipStatus ?? MembershipStatus.ACTIVE,
    homecell: homecell._id,
    area: homecell.area,
    zone: homecell.zone,
    createdBy: actor.id,
    updatedBy: actor.id,
  });

  await recordAudit(
    {
      action: AuditAction.CREATE,
      module: AuditModule.MEMBERS,
      description: `Registered member ${member.firstName} ${member.lastName} (${member.memberId}) in ${homecell.name}`,
      entityModel: 'Member',
      entityId: member._id,
      entityLabel: member.memberId,
      newValues: {
        memberId: member.memberId,
        name: `${member.firstName} ${member.lastName}`,
        homecell: idString(homecell._id),
      },
      zone: homecell.zone,
      area: homecell.area,
      homecell: homecell._id,
    },
    req,
  );

  return getMember(actor, idString(member._id));
}

export async function updateMember(
  actor: AuthenticatedUser,
  id: string,
  input: UpdateMemberInput,
  req: Request,
) {
  const member = await Member.findById(id);
  if (!member) throw new NotFoundError('Member');
  assertInScope(actor, { zone: member.zone, area: member.area, homecell: member.homecell });

  const before = member.toObject();
  const data = clean(input as Record<string, unknown>) as Record<string, unknown>;

  // Homecell changes go through the transfer workflow, never a profile edit (BR-017).
  delete data.homecellId;
  delete data.memberId;

  for (const [key, value] of Object.entries(data)) {
    if (key === 'dateOfBirth' || key === 'weddingAnniversary' || key === 'dateJoinedChurch') {
      (member as unknown as Record<string, unknown>)[key] = value
        ? toCalendarDate(value as string)
        : null;
    } else {
      (member as unknown as Record<string, unknown>)[key] = value;
    }
  }
  member.updatedBy = toObjectId(actor.id);
  await member.save();

  const { previousValues, newValues } = diffValues(before, member.toObject());
  await recordAudit(
    {
      action: AuditAction.UPDATE,
      module: AuditModule.MEMBERS,
      description: `Updated member ${member.firstName} ${member.lastName} (${member.memberId})`,
      entityModel: 'Member',
      entityId: member._id,
      entityLabel: member.memberId,
      previousValues,
      newValues,
      zone: member.zone,
      area: member.area,
      homecell: member.homecell,
    },
    req,
  );

  return getMember(actor, id);
}

export async function setMembershipStatus(
  actor: AuthenticatedUser,
  id: string,
  status: MembershipStatus,
  reason: string | undefined,
  req: Request,
) {
  const member = await Member.findById(id);
  if (!member) throw new NotFoundError('Member');
  assertInScope(actor, { zone: member.zone, area: member.area, homecell: member.homecell });

  const previous = member.membershipStatus;
  member.membershipStatus = status;
  member.updatedBy = toObjectId(actor.id);
  await member.save();

  await recordAudit(
    {
      action: AuditAction.UPDATE,
      module: AuditModule.MEMBERS,
      description: `Membership status for ${member.memberId} changed from ${previous} to ${status}${
        reason ? ` — ${reason}` : ''
      }`,
      entityModel: 'Member',
      entityId: member._id,
      entityLabel: member.memberId,
      previousValues: { membershipStatus: previous },
      newValues: { membershipStatus: status },
      zone: member.zone,
      area: member.area,
      homecell: member.homecell,
    },
    req,
  );

  return getMember(actor, id);
}

/** Active members of a Homecell — the roster the attendance screen renders. */
export async function listHomecellRoster(actor: AuthenticatedUser, homecellId: string) {
  await assertHomecellInScope(actor, homecellId);
  return Member.find({
    homecell: toObjectId(homecellId),
    membershipStatus: MembershipStatus.ACTIVE,
  })
    .select('memberId firstName middleName lastName preferredName sex phone photoUrl')
    .sort({ firstName: 1, lastName: 1 })
    .lean();
}

/** Celebrations feed shared by the dashboard and the SMS jobs. */
export async function upcomingCelebrations(
  actor: AuthenticatedUser,
  days: number,
): Promise<{
  birthdays: Record<string, unknown>[];
  anniversaries: Record<string, unknown>[];
}> {
  const scoped = await resolveScopedFilter<MemberDoc>(actor, {});
  const keys: string[] = [];
  for (let i = 0; i < days; i += 1) {
    keys.push(dayjs.utc().add(i, 'day').format('MM-DD'));
  }

  const [birthdays, anniversaries] = await Promise.all([
    Member.find({
      ...scoped,
      membershipStatus: MembershipStatus.ACTIVE,
      birthMonthDay: { $in: keys },
    })
      .select('memberId firstName lastName phone dateOfBirth birthMonthDay homecell photoUrl')
      .populate({ path: 'homecell', select: 'name code' })
      .lean(),
    Member.find({
      ...scoped,
      membershipStatus: MembershipStatus.ACTIVE,
      anniversaryMonthDay: { $in: keys },
    })
      .select('memberId firstName lastName phone weddingAnniversary anniversaryMonthDay homecell photoUrl')
      .populate({ path: 'homecell', select: 'name code' })
      .lean(),
  ]);

  // Order by how soon the occasion falls rather than by calendar month.
  const rank = (key: string | null | undefined) => (key ? keys.indexOf(key) : 999);
  birthdays.sort((a, b) => rank(a.birthMonthDay) - rank(b.birthMonthDay));
  anniversaries.sort((a, b) => rank(a.anniversaryMonthDay) - rank(b.anniversaryMonthDay));

  return { birthdays, anniversaries };
}
