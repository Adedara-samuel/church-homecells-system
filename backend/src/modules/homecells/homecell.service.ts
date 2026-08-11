import type { Request } from 'express';
import type { FilterQuery } from 'mongoose';
import { buildSort } from '../../middleware/validate';
import {
  assertAreaInScope,
  assertHomecellInScope,
  assertZoneInScope,
  homecellScopeFilter,
} from '../../middleware/scope';
import { AuditAction, AuditModule, MembershipStatus, OrgStatus, Role } from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { idString, toObjectId } from '../../utils/ids';
import { toMinor } from '../../utils/money';
import { mergeFilters, paginate, searchFilter } from '../../utils/query';
import { diffValues, recordAudit } from '../audit/audit.service';
import { Area } from '../areas/area.model';
import { Member } from '../members/member.model';
import { User } from '../users/user.model';
import { Homecell, type HomecellDoc } from './homecell.model';

const SORTABLE = ['createdAt', 'name', 'code', 'status'];
const POPULATE = [
  { path: 'coordinator', select: 'firstName lastName email phone' },
  { path: 'assistantCoordinator', select: 'firstName lastName email phone' },
  { path: 'area', select: 'name code' },
  { path: 'zone', select: 'name code' },
];

export interface HomecellListQuery {
  page: number;
  limit: number;
  sort?: string;
  order: 'asc' | 'desc';
  search?: string;
  status?: OrgStatus;
  zoneId?: string;
  areaId?: string;
}

export async function listHomecells(actor: AuthenticatedUser, query: HomecellListQuery) {
  const filter: FilterQuery<HomecellDoc> = { ...homecellScopeFilter(actor) };
  if (query.status) filter.status = query.status;
  if (query.areaId) {
    await assertAreaInScope(actor, query.areaId);
    filter.area = toObjectId(query.areaId);
  } else if (query.zoneId) {
    assertZoneInScope(actor, query.zoneId);
    filter.zone = toObjectId(query.zoneId);
  }

  const result = await paginate(Homecell, {
    filter: mergeFilters<HomecellDoc>(
      filter,
      searchFilter(query.search, ['name', 'code', 'meetingLocation']) as FilterQuery<HomecellDoc>,
    ),
    page: query.page,
    limit: query.limit,
    sort: buildSort(query.sort, query.order, SORTABLE, 'name'),
    populate: POPULATE,
  });

  const ids = (result.items as { _id: unknown }[]).map((h) => toObjectId(idString(h._id)));
  const memberCounts = await Member.aggregate([
    { $match: { homecell: { $in: ids }, membershipStatus: MembershipStatus.ACTIVE } },
    { $group: { _id: '$homecell', n: { $sum: 1 } } },
  ]);
  const map = new Map(memberCounts.map((r) => [idString(r._id), r.n]));

  result.items = (result.items as Record<string, unknown>[]).map((hc) => ({
    ...hc,
    memberCount: map.get(idString(hc._id)) ?? 0,
  }));

  return result;
}

export async function getHomecell(actor: AuthenticatedUser, id: string) {
  const homecell = await Homecell.findById(id).populate(POPULATE).lean();
  if (!homecell) throw new NotFoundError('Homecell');
  await assertHomecellInScope(actor, id);

  const memberCount = await Member.countDocuments({
    homecell: homecell._id,
    membershipStatus: MembershipStatus.ACTIVE,
  });
  return { ...homecell, memberCount };
}

export interface HomecellInput {
  code?: string;
  name?: string;
  areaId?: string;
  coordinatorId?: string | null;
  assistantCoordinatorId?: string | null;
  meetingLocation?: string;
  meetingAddress?: string;
  /** Major units; converted to minor at the boundary. `null` clears the override. */
  maxPurseThreshold?: number | null;
  status?: OrgStatus;
}

async function resolveCoordinator(coordinatorId: string | null | undefined) {
  if (coordinatorId === undefined) return undefined;
  if (coordinatorId === null) return null;
  const user = await User.findById(coordinatorId).select('role').lean();
  if (!user) throw new NotFoundError('Coordinator');
  if (user.role !== Role.HOMECELL_COORDINATOR) {
    throw new ValidationError('The selected user is not a Homecell Coordinator.');
  }
  return coordinatorId;
}

export async function createHomecell(
  actor: AuthenticatedUser,
  input: HomecellInput,
  req: Request,
) {
  // SRS 6.5: a Homecell cannot be assigned to an Area that does not exist.
  const area = await Area.findById(input.areaId).select('_id name zone status').lean();
  if (!area) throw new ValidationError('The selected Area does not exist.');
  if (area.status === OrgStatus.INACTIVE) {
    throw new ValidationError('A Homecell cannot be added to an inactive Area.');
  }
  await assertAreaInScope(actor, area._id);

  const coordinator = await resolveCoordinator(input.coordinatorId);
  const assistant = await resolveCoordinator(input.assistantCoordinatorId);
  if (coordinator && assistant && coordinator === assistant) {
    throw new ValidationError('The assistant coordinator must be a different person.');
  }

  const homecell = await Homecell.create({
    code: input.code,
    name: input.name,
    area: area._id,
    zone: area.zone,
    coordinator: coordinator ?? null,
    assistantCoordinator: assistant ?? null,
    meetingLocation: input.meetingLocation,
    meetingAddress: input.meetingAddress,
    maxPurseThresholdOverride:
      input.maxPurseThreshold === null || input.maxPurseThreshold === undefined
        ? null
        : toMinor(input.maxPurseThreshold),
    status: input.status ?? OrgStatus.ACTIVE,
    createdBy: actor.id,
  });

  for (const userId of [coordinator, assistant].filter(Boolean) as string[]) {
    await User.updateOne(
      { _id: userId },
      { $set: { zone: area.zone, area: area._id, homecell: homecell._id } },
    );
  }

  await recordAudit(
    {
      action: AuditAction.CREATE,
      module: AuditModule.HOMECELLS,
      description: `Created Homecell ${homecell.name} (${homecell.code}) in Area ${area.name}`,
      entityModel: 'Homecell',
      entityId: homecell._id,
      entityLabel: homecell.name,
      newValues: { code: homecell.code, name: homecell.name, area: idString(area._id) },
      zone: area.zone,
      area: area._id,
      homecell: homecell._id,
    },
    req,
  );

  return getHomecell(actor, idString(homecell._id));
}

export async function updateHomecell(
  actor: AuthenticatedUser,
  id: string,
  input: HomecellInput,
  req: Request,
) {
  const homecell = await Homecell.findById(id);
  if (!homecell) throw new NotFoundError('Homecell');
  await assertHomecellInScope(actor, id);
  const before = homecell.toObject();

  if (input.code !== undefined) homecell.code = input.code;
  if (input.name !== undefined) homecell.name = input.name;
  if (input.meetingLocation !== undefined) homecell.meetingLocation = input.meetingLocation;
  if (input.meetingAddress !== undefined) homecell.meetingAddress = input.meetingAddress;
  if (input.status !== undefined) homecell.status = input.status;
  if (input.maxPurseThreshold !== undefined) {
    homecell.maxPurseThresholdOverride =
      input.maxPurseThreshold === null ? null : toMinor(input.maxPurseThreshold);
  }

  if (input.areaId !== undefined && idString(input.areaId) !== idString(homecell.area)) {
    const area = await Area.findById(input.areaId).select('_id zone').lean();
    if (!area) throw new ValidationError('The selected Area does not exist.');
    await assertAreaInScope(actor, area._id);
    homecell.area = area._id;
    homecell.zone = area.zone;
    // BR-003 again: members follow their Homecell.
    await Member.updateMany(
      { homecell: homecell._id },
      { $set: { area: area._id, zone: area.zone } },
    );
    await User.updateMany(
      { homecell: homecell._id },
      { $set: { area: area._id, zone: area.zone } },
    );
  }

  if (input.coordinatorId !== undefined) {
    const coordinator = await resolveCoordinator(input.coordinatorId);
    homecell.coordinator = coordinator ? toObjectId(coordinator) : null;
    if (coordinator) {
      await User.updateOne(
        { _id: coordinator },
        { $set: { zone: homecell.zone, area: homecell.area, homecell: homecell._id } },
      );
    }
  }
  if (input.assistantCoordinatorId !== undefined) {
    const assistant = await resolveCoordinator(input.assistantCoordinatorId);
    homecell.assistantCoordinator = assistant ? toObjectId(assistant) : null;
    if (assistant) {
      await User.updateOne(
        { _id: assistant },
        { $set: { zone: homecell.zone, area: homecell.area, homecell: homecell._id } },
      );
    }
  }

  await homecell.save();

  const { previousValues, newValues } = diffValues(before, homecell.toObject());
  await recordAudit(
    {
      action: AuditAction.UPDATE,
      module: AuditModule.HOMECELLS,
      description: `Updated Homecell ${homecell.name}`,
      entityModel: 'Homecell',
      entityId: homecell._id,
      entityLabel: homecell.name,
      previousValues,
      newValues,
      zone: homecell.zone,
      area: homecell.area,
      homecell: homecell._id,
    },
    req,
  );

  return getHomecell(actor, id);
}

export async function setHomecellStatus(
  actor: AuthenticatedUser,
  id: string,
  status: OrgStatus,
  req: Request,
) {
  const homecell = await Homecell.findById(id);
  if (!homecell) throw new NotFoundError('Homecell');
  await assertHomecellInScope(actor, id);

  if (status === OrgStatus.INACTIVE) {
    const activeMembers = await Member.countDocuments({
      homecell: homecell._id,
      membershipStatus: MembershipStatus.ACTIVE,
    });
    if (activeMembers > 0) {
      throw new ConflictError(
        `This Homecell still has ${activeMembers} active member${
          activeMembers === 1 ? '' : 's'
        }. Transfer them before deactivating it.`,
      );
    }
  }

  const previous = homecell.status;
  homecell.status = status;
  await homecell.save();

  await recordAudit(
    {
      action: AuditAction.UPDATE,
      module: AuditModule.HOMECELLS,
      description: `Homecell ${homecell.name} status changed from ${previous} to ${status}`,
      entityModel: 'Homecell',
      entityId: homecell._id,
      entityLabel: homecell.name,
      previousValues: { status: previous },
      newValues: { status },
      zone: homecell.zone,
      area: homecell.area,
      homecell: homecell._id,
    },
    req,
  );

  return getHomecell(actor, id);
}

export async function homecellOptions(
  actor: AuthenticatedUser,
  filters: { zoneId?: string; areaId?: string },
) {
  const filter: FilterQuery<HomecellDoc> = {
    ...homecellScopeFilter(actor),
    status: OrgStatus.ACTIVE,
  };
  if (filters.areaId) {
    await assertAreaInScope(actor, filters.areaId);
    filter.area = toObjectId(filters.areaId);
  } else if (filters.zoneId) {
    assertZoneInScope(actor, filters.zoneId);
    filter.zone = toObjectId(filters.zoneId);
  }
  return Homecell.find(filter).select('name code area zone').sort({ name: 1 }).lean();
}

/** Loads a Homecell with its parents — used wherever a write needs the full org triple. */
export async function requireHomecellContext(homecellId: string) {
  const homecell = await Homecell.findById(homecellId).select('_id name area zone status').lean();
  if (!homecell) throw new NotFoundError('Homecell');
  return homecell;
}
