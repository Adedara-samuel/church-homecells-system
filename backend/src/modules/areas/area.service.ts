import type { Request } from 'express';
import type { FilterQuery } from 'mongoose';
import { buildSort } from '../../middleware/validate';
import { areaScopeFilter, assertAreaInScope, assertZoneInScope } from '../../middleware/scope';
import { AuditAction, AuditModule, OrgStatus, Role } from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { idString, toObjectId } from '../../utils/ids';
import { mergeFilters, paginate, searchFilter } from '../../utils/query';
import { diffValues, recordAudit } from '../audit/audit.service';
import { Homecell } from '../homecells/homecell.model';
import { Member } from '../members/member.model';
import { User } from '../users/user.model';
import { Zone } from '../zones/zone.model';
import { Area, type AreaDoc } from './area.model';

const SORTABLE = ['createdAt', 'name', 'code', 'status'];
const POPULATE = [
  { path: 'coordinator', select: 'firstName lastName email phone' },
  { path: 'zone', select: 'name code' },
];

export interface AreaListQuery {
  page: number;
  limit: number;
  sort?: string;
  order: 'asc' | 'desc';
  search?: string;
  status?: OrgStatus;
  zoneId?: string;
}

export async function listAreas(actor: AuthenticatedUser, query: AreaListQuery) {
  const filter: FilterQuery<AreaDoc> = { ...areaScopeFilter(actor) };
  if (query.status) filter.status = query.status;
  if (query.zoneId) {
    assertZoneInScope(actor, query.zoneId);
    filter.zone = toObjectId(query.zoneId);
  }

  const result = await paginate(Area, {
    filter: mergeFilters<AreaDoc>(
      filter,
      searchFilter(query.search, ['name', 'code', 'description']) as FilterQuery<AreaDoc>,
    ),
    page: query.page,
    limit: query.limit,
    sort: buildSort(query.sort, query.order, SORTABLE, 'name'),
    populate: POPULATE,
  });

  const ids = (result.items as { _id: unknown }[]).map((a) => toObjectId(idString(a._id)));
  const [homecellCounts, memberCounts] = await Promise.all([
    Homecell.aggregate([{ $match: { area: { $in: ids } } }, { $group: { _id: '$area', n: { $sum: 1 } } }]),
    Member.aggregate([
      { $match: { area: { $in: ids }, membershipStatus: 'ACTIVE' } },
      { $group: { _id: '$area', n: { $sum: 1 } } },
    ]),
  ]);
  const hcMap = new Map(homecellCounts.map((r) => [idString(r._id), r.n]));
  const mMap = new Map(memberCounts.map((r) => [idString(r._id), r.n]));

  result.items = (result.items as Record<string, unknown>[]).map((area) => ({
    ...area,
    homecellCount: hcMap.get(idString(area._id)) ?? 0,
    memberCount: mMap.get(idString(area._id)) ?? 0,
  }));

  return result;
}

export async function getArea(actor: AuthenticatedUser, id: string) {
  const area = await Area.findById(id).populate(POPULATE).lean();
  if (!area) throw new NotFoundError('Area');
  await assertAreaInScope(actor, id);

  const [homecellCount, memberCount] = await Promise.all([
    Homecell.countDocuments({ area: area._id }),
    Member.countDocuments({ area: area._id, membershipStatus: 'ACTIVE' }),
  ]);
  return { ...area, homecellCount, memberCount };
}

export interface AreaInput {
  code?: string;
  name?: string;
  description?: string;
  zoneId?: string;
  coordinatorId?: string | null;
  status?: OrgStatus;
}

async function resolveCoordinator(coordinatorId: string | null | undefined) {
  if (coordinatorId === undefined) return undefined;
  if (coordinatorId === null) return null;
  const user = await User.findById(coordinatorId).select('role').lean();
  if (!user) throw new NotFoundError('Coordinator');
  if (user.role !== Role.AREA_COORDINATOR) {
    throw new ValidationError('The selected user is not an Area Coordinator.');
  }
  return coordinatorId;
}

export async function createArea(actor: AuthenticatedUser, input: AreaInput, req: Request) {
  // SRS 6.5: an Area cannot be assigned to a Zone that does not exist.
  const zone = await Zone.findById(input.zoneId).select('_id name status').lean();
  if (!zone) throw new ValidationError('The selected Zone does not exist.');
  if (zone.status === OrgStatus.INACTIVE) {
    throw new ValidationError('An Area cannot be added to an inactive Zone.');
  }
  assertZoneInScope(actor, zone._id);

  const coordinator = await resolveCoordinator(input.coordinatorId);

  const area = await Area.create({
    code: input.code,
    name: input.name,
    description: input.description,
    zone: zone._id,
    coordinator: coordinator ?? null,
    status: input.status ?? OrgStatus.ACTIVE,
    createdBy: actor.id,
  });

  if (coordinator) {
    await User.updateOne(
      { _id: coordinator },
      { $set: { zone: zone._id, area: area._id, homecell: null } },
    );
  }

  await recordAudit(
    {
      action: AuditAction.CREATE,
      module: AuditModule.AREAS,
      description: `Created Area ${area.name} (${area.code}) in Zone ${zone.name}`,
      entityModel: 'Area',
      entityId: area._id,
      entityLabel: area.name,
      newValues: { code: area.code, name: area.name, zone: idString(zone._id) },
      zone: zone._id,
      area: area._id,
    },
    req,
  );

  return getArea(actor, idString(area._id));
}

export async function updateArea(
  actor: AuthenticatedUser,
  id: string,
  input: AreaInput,
  req: Request,
) {
  const area = await Area.findById(id);
  if (!area) throw new NotFoundError('Area');
  await assertAreaInScope(actor, id);
  const before = area.toObject();

  if (input.code !== undefined) area.code = input.code;
  if (input.name !== undefined) area.name = input.name;
  if (input.description !== undefined) area.description = input.description;
  if (input.status !== undefined) area.status = input.status;

  if (input.zoneId !== undefined && idString(input.zoneId) !== idString(area.zone)) {
    const zone = await Zone.findById(input.zoneId).select('_id').lean();
    if (!zone) throw new ValidationError('The selected Zone does not exist.');
    assertZoneInScope(actor, zone._id);
    area.zone = zone._id;
    // BR-003: every Homecell and Member beneath this Area follows it to the new Zone.
    await Homecell.updateMany({ area: area._id }, { $set: { zone: zone._id } });
    await Member.updateMany({ area: area._id }, { $set: { zone: zone._id } });
    await User.updateMany({ area: area._id }, { $set: { zone: zone._id } });
  }

  if (input.coordinatorId !== undefined) {
    const coordinator = await resolveCoordinator(input.coordinatorId);
    area.coordinator = coordinator ? toObjectId(coordinator) : null;
    if (coordinator) {
      await User.updateOne(
        { _id: coordinator },
        { $set: { zone: area.zone, area: area._id, homecell: null } },
      );
    }
  }

  await area.save();

  const { previousValues, newValues } = diffValues(before, area.toObject());
  await recordAudit(
    {
      action: AuditAction.UPDATE,
      module: AuditModule.AREAS,
      description: `Updated Area ${area.name}`,
      entityModel: 'Area',
      entityId: area._id,
      entityLabel: area.name,
      previousValues,
      newValues,
      zone: area.zone,
      area: area._id,
    },
    req,
  );

  return getArea(actor, id);
}

export async function setAreaStatus(
  actor: AuthenticatedUser,
  id: string,
  status: OrgStatus,
  req: Request,
) {
  const area = await Area.findById(id);
  if (!area) throw new NotFoundError('Area');
  await assertAreaInScope(actor, id);

  if (status === OrgStatus.INACTIVE) {
    const activeHomecells = await Homecell.countDocuments({
      area: area._id,
      status: OrgStatus.ACTIVE,
    });
    if (activeHomecells > 0) {
      throw new ConflictError(
        `This Area still has ${activeHomecells} active Homecell${
          activeHomecells === 1 ? '' : 's'
        }. Deactivate or move them first.`,
      );
    }
  }

  const previous = area.status;
  area.status = status;
  await area.save();

  await recordAudit(
    {
      action: AuditAction.UPDATE,
      module: AuditModule.AREAS,
      description: `Area ${area.name} status changed from ${previous} to ${status}`,
      entityModel: 'Area',
      entityId: area._id,
      entityLabel: area.name,
      previousValues: { status: previous },
      newValues: { status },
      zone: area.zone,
      area: area._id,
    },
    req,
  );

  return getArea(actor, id);
}

export async function areaOptions(actor: AuthenticatedUser, zoneId?: string) {
  const filter: FilterQuery<AreaDoc> = { ...areaScopeFilter(actor), status: OrgStatus.ACTIVE };
  if (zoneId) {
    assertZoneInScope(actor, zoneId);
    filter.zone = toObjectId(zoneId);
  }
  return Area.find(filter).select('name code zone').sort({ name: 1 }).lean();
}
