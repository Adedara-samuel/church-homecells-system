import type { Request } from 'express';
import type { FilterQuery } from 'mongoose';
import { buildSort } from '../../middleware/validate';
import { zoneScopeFilter } from '../../middleware/scope';
import { AuditAction, AuditModule, OrgStatus, Role } from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { ConflictError, NotFoundError, ValidationError } from '../../utils/errors';
import { idString, toObjectId } from '../../utils/ids';
import { mergeFilters, paginate, searchFilter } from '../../utils/query';
import { diffValues, recordAudit } from '../audit/audit.service';
import { Area } from '../areas/area.model';
import { Homecell } from '../homecells/homecell.model';
import { Member } from '../members/member.model';
import { User } from '../users/user.model';
import { Zone, type ZoneDoc } from './zone.model';

const SORTABLE = ['createdAt', 'name', 'code', 'status'];
const POPULATE = { path: 'coordinator', select: 'firstName lastName email phone' };

export interface ZoneListQuery {
  page: number;
  limit: number;
  sort?: string;
  order: 'asc' | 'desc';
  search?: string;
  status?: OrgStatus;
}

export async function listZones(actor: AuthenticatedUser, query: ZoneListQuery) {
  const filter: FilterQuery<ZoneDoc> = { ...zoneScopeFilter(actor) };
  if (query.status) filter.status = query.status;

  const result = await paginate(Zone, {
    filter: mergeFilters<ZoneDoc>(
      filter,
      searchFilter(query.search, ['name', 'code', 'description']) as FilterQuery<ZoneDoc>,
    ),
    page: query.page,
    limit: query.limit,
    sort: buildSort(query.sort, query.order, SORTABLE, 'name'),
    populate: POPULATE,
  });

  // Roll-up counts so the list view never needs an N+1 round trip per row.
  const ids = (result.items as { _id: unknown }[]).map((z) => toObjectId(idString(z._id)));
  const [areaCounts, homecellCounts, memberCounts] = await Promise.all([
    Area.aggregate([{ $match: { zone: { $in: ids } } }, { $group: { _id: '$zone', n: { $sum: 1 } } }]),
    Homecell.aggregate([{ $match: { zone: { $in: ids } } }, { $group: { _id: '$zone', n: { $sum: 1 } } }]),
    Member.aggregate([
      { $match: { zone: { $in: ids }, membershipStatus: 'ACTIVE' } },
      { $group: { _id: '$zone', n: { $sum: 1 } } },
    ]),
  ]);

  const index = (rows: { _id: unknown; n: number }[]) =>
    new Map(rows.map((r) => [idString(r._id), r.n]));
  const areaMap = index(areaCounts);
  const homecellMap = index(homecellCounts);
  const memberMap = index(memberCounts);

  result.items = (result.items as Record<string, unknown>[]).map((zone) => ({
    ...zone,
    areaCount: areaMap.get(idString(zone._id)) ?? 0,
    homecellCount: homecellMap.get(idString(zone._id)) ?? 0,
    memberCount: memberMap.get(idString(zone._id)) ?? 0,
  }));

  return result;
}

export async function getZone(actor: AuthenticatedUser, id: string) {
  const filter = { _id: toObjectId(id), ...zoneScopeFilter(actor) };
  const zone = await Zone.findOne(filter).populate(POPULATE).lean();
  if (!zone) throw new NotFoundError('Zone');

  const [areaCount, homecellCount, memberCount] = await Promise.all([
    Area.countDocuments({ zone: zone._id }),
    Homecell.countDocuments({ zone: zone._id }),
    Member.countDocuments({ zone: zone._id, membershipStatus: 'ACTIVE' }),
  ]);
  return { ...zone, areaCount, homecellCount, memberCount };
}

export interface ZoneInput {
  code?: string;
  name?: string;
  description?: string;
  coordinatorId?: string | null;
  status?: OrgStatus;
}

/** A coordinator assignment must reference an existing user holding the right role. */
async function resolveCoordinator(
  coordinatorId: string | null | undefined,
  expectedRole: Role,
  label: string,
): Promise<string | null | undefined> {
  if (coordinatorId === undefined) return undefined;
  if (coordinatorId === null) return null;
  const user = await User.findById(coordinatorId).select('role').lean();
  if (!user) throw new NotFoundError('Coordinator');
  if (user.role !== expectedRole) {
    throw new ValidationError(`The selected user is not a ${label}.`);
  }
  return coordinatorId;
}

export async function createZone(actor: AuthenticatedUser, input: ZoneInput, req: Request) {
  const coordinator = await resolveCoordinator(
    input.coordinatorId,
    Role.ZONAL_COORDINATOR,
    'Zonal Coordinator',
  );

  const zone = await Zone.create({
    code: input.code,
    name: input.name,
    description: input.description,
    coordinator: coordinator ?? null,
    status: input.status ?? OrgStatus.ACTIVE,
    createdBy: actor.id,
  });

  // Keep the coordinator's own assignment consistent with the zone they now lead.
  if (coordinator) {
    await User.updateOne({ _id: coordinator }, { $set: { zone: zone._id, area: null, homecell: null } });
  }

  await recordAudit(
    {
      action: AuditAction.CREATE,
      module: AuditModule.ZONES,
      description: `Created Zone ${zone.name} (${zone.code})`,
      entityModel: 'Zone',
      entityId: zone._id,
      entityLabel: zone.name,
      newValues: { code: zone.code, name: zone.name, status: zone.status },
      zone: zone._id,
    },
    req,
  );

  return getZone(actor, idString(zone._id));
}

export async function updateZone(
  actor: AuthenticatedUser,
  id: string,
  input: ZoneInput,
  req: Request,
) {
  const zone = await Zone.findById(id);
  if (!zone) throw new NotFoundError('Zone');
  const before = zone.toObject();

  if (input.code !== undefined) zone.code = input.code;
  if (input.name !== undefined) zone.name = input.name;
  if (input.description !== undefined) zone.description = input.description;
  if (input.status !== undefined) zone.status = input.status;

  if (input.coordinatorId !== undefined) {
    const coordinator = await resolveCoordinator(
      input.coordinatorId,
      Role.ZONAL_COORDINATOR,
      'Zonal Coordinator',
    );
    zone.coordinator = coordinator ? toObjectId(coordinator) : null;
    if (coordinator) {
      await User.updateOne(
        { _id: coordinator },
        { $set: { zone: zone._id, area: null, homecell: null } },
      );
    }
  }

  await zone.save();

  const { previousValues, newValues } = diffValues(before, zone.toObject());
  await recordAudit(
    {
      action: AuditAction.UPDATE,
      module: AuditModule.ZONES,
      description: `Updated Zone ${zone.name}`,
      entityModel: 'Zone',
      entityId: zone._id,
      entityLabel: zone.name,
      previousValues,
      newValues,
      zone: zone._id,
    },
    req,
  );

  return getZone(actor, id);
}

/**
 * Zones are deactivated, never deleted — historical attendance, ledger entries and
 * transfer history all reference them permanently.
 */
export async function setZoneStatus(
  actor: AuthenticatedUser,
  id: string,
  status: OrgStatus,
  req: Request,
) {
  const zone = await Zone.findById(id);
  if (!zone) throw new NotFoundError('Zone');

  if (status === OrgStatus.INACTIVE) {
    const activeAreas = await Area.countDocuments({ zone: zone._id, status: OrgStatus.ACTIVE });
    if (activeAreas > 0) {
      throw new ConflictError(
        `This Zone still has ${activeAreas} active Area${activeAreas === 1 ? '' : 's'}. ` +
          'Deactivate them first.',
      );
    }
  }

  const previous = zone.status;
  zone.status = status;
  await zone.save();

  await recordAudit(
    {
      action: AuditAction.UPDATE,
      module: AuditModule.ZONES,
      description: `Zone ${zone.name} status changed from ${previous} to ${status}`,
      entityModel: 'Zone',
      entityId: zone._id,
      entityLabel: zone.name,
      previousValues: { status: previous },
      newValues: { status },
      zone: zone._id,
    },
    req,
  );

  return getZone(actor, id);
}

/** Lightweight list used to populate Zone → Area → Homecell selectors. */
export async function zoneOptions(actor: AuthenticatedUser) {
  return Zone.find({ ...zoneScopeFilter(actor), status: OrgStatus.ACTIVE })
    .select('name code')
    .sort({ name: 1 })
    .lean();
}
