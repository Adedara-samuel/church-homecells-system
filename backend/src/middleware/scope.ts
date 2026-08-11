import type { FilterQuery } from 'mongoose';
import { Area } from '../modules/areas/area.model';
import { Homecell } from '../modules/homecells/homecell.model';
import type { AuthenticatedUser } from '../types/express';
import { ScopeLevel } from '../types/enums';
import { OutOfScopeError } from '../utils/errors';
import { idString, toObjectId } from '../utils/ids';

/**
 * Organisational scope enforcement (SRS FR-AUTH-003, BR-018).
 *
 * Every list query is *filtered* by scope and every single-record read is *checked*
 * against scope. Both happen on the server. A Homecell Coordinator who edits the
 * `homecellId` query parameter gets a 403, not another Homecell's data.
 */

export interface OrgRefs {
  zone?: unknown;
  area?: unknown;
  homecell?: unknown;
}

/**
 * Builds the Mongo filter fragment restricting a collection to the user's scope.
 * Every scoped collection carries denormalised `zone` / `area` / `homecell` fields
 * precisely so this stays a single indexed predicate with no `$lookup`.
 */
export function scopeFilter<T>(user: AuthenticatedUser): FilterQuery<T> {
  switch (user.scopeLevel) {
    case ScopeLevel.CHURCH:
      return {};
    case ScopeLevel.ZONE:
      if (!user.zoneId) throw new OutOfScopeError('No Zone is assigned to your account.');
      return { zone: toObjectId(user.zoneId) } as FilterQuery<T>;
    case ScopeLevel.AREA:
      if (!user.areaId) throw new OutOfScopeError('No Area is assigned to your account.');
      return { area: toObjectId(user.areaId) } as FilterQuery<T>;
    case ScopeLevel.HOMECELL:
      if (!user.homecellId) throw new OutOfScopeError('No Homecell is assigned to your account.');
      return { homecell: toObjectId(user.homecellId) } as FilterQuery<T>;
    default:
      throw new OutOfScopeError();
  }
}

/** Scope filter for the Zone collection itself (whose own id is the scope key). */
export function zoneScopeFilter(user: AuthenticatedUser): FilterQuery<unknown> {
  if (user.isChurchWide) return {};
  if (user.scopeLevel === ScopeLevel.ZONE && user.zoneId) return { _id: toObjectId(user.zoneId) };
  if (user.zoneId) return { _id: toObjectId(user.zoneId) };
  throw new OutOfScopeError('No Zone is assigned to your account.');
}

/** Scope filter for the Area collection (matches on `_id` or parent `zone`). */
export function areaScopeFilter(user: AuthenticatedUser): FilterQuery<unknown> {
  if (user.isChurchWide) return {};
  switch (user.scopeLevel) {
    case ScopeLevel.ZONE:
      return { zone: toObjectId(user.zoneId!) };
    case ScopeLevel.AREA:
      return { _id: toObjectId(user.areaId!) };
    case ScopeLevel.HOMECELL:
      return user.areaId ? { _id: toObjectId(user.areaId) } : { _id: null };
    default:
      throw new OutOfScopeError();
  }
}

/** Scope filter for the Homecell collection. */
export function homecellScopeFilter(user: AuthenticatedUser): FilterQuery<unknown> {
  if (user.isChurchWide) return {};
  switch (user.scopeLevel) {
    case ScopeLevel.ZONE:
      return { zone: toObjectId(user.zoneId!) };
    case ScopeLevel.AREA:
      return { area: toObjectId(user.areaId!) };
    case ScopeLevel.HOMECELL:
      return { _id: toObjectId(user.homecellId!) };
    default:
      throw new OutOfScopeError();
  }
}

/**
 * Asserts a fetched record sits inside the caller's scope.
 * Call this immediately after loading any record by id.
 */
export function assertInScope(user: AuthenticatedUser, refs: OrgRefs): void {
  if (user.isChurchWide) return;

  const zone = idString(refs.zone);
  const area = idString(refs.area);
  const homecell = idString(refs.homecell);

  switch (user.scopeLevel) {
    case ScopeLevel.ZONE:
      if (zone && zone === user.zoneId) return;
      break;
    case ScopeLevel.AREA:
      if (area && area === user.areaId) return;
      break;
    case ScopeLevel.HOMECELL:
      if (homecell && homecell === user.homecellId) return;
      break;
    default:
      break;
  }
  throw new OutOfScopeError();
}

/** Scope check for a Zone document. */
export function assertZoneInScope(user: AuthenticatedUser, zoneId: unknown): void {
  if (user.isChurchWide) return;
  if (idString(zoneId) === user.zoneId) return;
  throw new OutOfScopeError('That Zone is outside your assigned scope.');
}

/** Scope check for an Area document, resolving its parent Zone when needed. */
export async function assertAreaInScope(
  user: AuthenticatedUser,
  areaId: unknown,
): Promise<void> {
  if (user.isChurchWide) return;
  const id = idString(areaId);
  if (user.scopeLevel === ScopeLevel.AREA || user.scopeLevel === ScopeLevel.HOMECELL) {
    if (id === user.areaId) return;
    throw new OutOfScopeError('That Area is outside your assigned scope.');
  }
  const area = await Area.findById(id).select('zone').lean();
  if (area && idString(area.zone) === user.zoneId) return;
  throw new OutOfScopeError('That Area is outside your assigned scope.');
}

/** Scope check for a Homecell document, resolving its parents when needed. */
export async function assertHomecellInScope(
  user: AuthenticatedUser,
  homecellId: unknown,
): Promise<void> {
  if (user.isChurchWide) return;
  const id = idString(homecellId);
  if (user.scopeLevel === ScopeLevel.HOMECELL) {
    if (id === user.homecellId) return;
    throw new OutOfScopeError('That Homecell is outside your assigned scope.');
  }
  const homecell = await Homecell.findById(id).select('zone area').lean();
  if (!homecell) throw new OutOfScopeError('That Homecell is outside your assigned scope.');
  if (user.scopeLevel === ScopeLevel.AREA && idString(homecell.area) === user.areaId) return;
  if (user.scopeLevel === ScopeLevel.ZONE && idString(homecell.zone) === user.zoneId) return;
  throw new OutOfScopeError('That Homecell is outside your assigned scope.');
}

/**
 * Narrows an explicit `zone`/`area`/`homecell` query filter to the caller's scope.
 *
 * If the caller asks for a unit inside their scope, that narrower filter is used.
 * If they ask for one outside it, this throws. If they ask for nothing, their whole
 * scope is returned. This is the single helper every list endpoint uses.
 */
export async function resolveScopedFilter<T>(
  user: AuthenticatedUser,
  requested: { zoneId?: string; areaId?: string; homecellId?: string },
): Promise<FilterQuery<T>> {
  const base = scopeFilter<T>(user) as Record<string, unknown>;

  if (requested.homecellId) {
    await assertHomecellInScope(user, requested.homecellId);
    return { ...base, homecell: toObjectId(requested.homecellId) } as FilterQuery<T>;
  }
  // The base scope is always retained. A request for a *broader* unit than the caller's
  // own scope therefore narrows to the intersection rather than widening access.
  if (requested.areaId) {
    await assertAreaInScope(user, requested.areaId);
    return { ...base, area: toObjectId(requested.areaId) } as FilterQuery<T>;
  }
  if (requested.zoneId) {
    assertZoneInScope(user, requested.zoneId);
    return { ...base, zone: toObjectId(requested.zoneId) } as FilterQuery<T>;
  }
  return base as FilterQuery<T>;
}
