import crypto from 'node:crypto';
import type { Request } from 'express';
import type { FilterQuery } from 'mongoose';
import {
  AuditAction,
  AuditModule,
  Role,
  UserStatus,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../utils/errors';
import { buildSort } from '../../middleware/validate';
import { idString, toObjectId } from '../../utils/ids';
import { mergeFilters, paginate, searchFilter } from '../../utils/query';
import { diffValues, recordAudit } from '../audit/audit.service';
import { Area } from '../areas/area.model';
import { Homecell } from '../homecells/homecell.model';
import { Zone } from '../zones/zone.model';
import { hashPassword } from '../auth/password';
import { revokeAllUserSessions } from '../auth/token.service';
import { User, type UserDoc } from './user.model';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './user.schemas';

const POPULATE = [
  { path: 'zone', select: 'name code' },
  { path: 'area', select: 'name code zone' },
  { path: 'homecell', select: 'name code area zone' },
];

const SORTABLE = ['createdAt', 'firstName', 'lastName', 'email', 'role', 'status', 'lastLoginAt'];

/**
 * Resolves the full Zone/Area/Homecell triple from whichever level was supplied.
 *
 * A user's assignment is always stored denormalised at every level above their own,
 * so scope filters never need a join and a Homecell Coordinator's Zone is known
 * without walking the hierarchy at request time.
 */
export async function resolveOrgAssignment(input: {
  role: Role;
  zoneId?: string | null;
  areaId?: string | null;
  homecellId?: string | null;
}): Promise<{ zone: string | null; area: string | null; homecell: string | null }> {
  if (input.role === Role.SYSTEM_ADMIN || input.role === Role.CHURCH_ADMIN) {
    return { zone: null, area: null, homecell: null };
  }

  if (input.role === Role.HOMECELL_COORDINATOR) {
    if (!input.homecellId) throw new ValidationError('A Homecell must be assigned for this role.');
    const homecell = await Homecell.findById(input.homecellId).select('area zone').lean();
    if (!homecell) throw new NotFoundError('Homecell');
    return {
      zone: idString(homecell.zone),
      area: idString(homecell.area),
      homecell: idString(homecell._id),
    };
  }

  if (input.role === Role.AREA_COORDINATOR) {
    if (!input.areaId) throw new ValidationError('An Area must be assigned for this role.');
    const area = await Area.findById(input.areaId).select('zone').lean();
    if (!area) throw new NotFoundError('Area');
    return { zone: idString(area.zone), area: idString(area._id), homecell: null };
  }

  if (!input.zoneId) throw new ValidationError('A Zone must be assigned for this role.');
  const zone = await Zone.findById(input.zoneId).select('_id').lean();
  if (!zone) throw new NotFoundError('Zone');
  return { zone: idString(zone._id), area: null, homecell: null };
}

/** A user may never create or edit an account outside their own scope or above their role. */
function assertCanManage(actor: AuthenticatedUser, targetRole: Role): void {
  if (actor.role === Role.SYSTEM_ADMIN) return;
  if (targetRole === Role.SYSTEM_ADMIN) {
    throw new ForbiddenError('Only a System Administrator can manage System Administrator accounts.');
  }
  if (actor.role === Role.CHURCH_ADMIN && targetRole === Role.CHURCH_ADMIN) {
    throw new ForbiddenError('Church Administrator accounts are managed by the System Administrator.');
  }
}

export async function listUsers(actor: AuthenticatedUser, query: ListUsersQuery) {
  const filter: FilterQuery<UserDoc> = {};
  if (query.role) filter.role = query.role;
  if (query.status) filter.status = query.status as UserStatus;
  if (query.zoneId) filter.zone = toObjectId(query.zoneId);
  if (query.areaId) filter.area = toObjectId(query.areaId);
  if (query.homecellId) filter.homecell = toObjectId(query.homecellId);

  // Scoped roles only ever see users inside their own part of the organisation.
  if (!actor.isChurchWide) {
    if (actor.homecellId) filter.homecell = toObjectId(actor.homecellId);
    else if (actor.areaId) filter.area = toObjectId(actor.areaId);
    else if (actor.zoneId) filter.zone = toObjectId(actor.zoneId);
  }

  return paginate(User, {
    filter: mergeFilters<UserDoc>(
      filter,
      searchFilter(query.search, ['firstName', 'lastName', 'email', 'phone']) as FilterQuery<UserDoc>,
    ),
    page: query.page,
    limit: query.limit,
    sort: buildSort(query.sort, query.order, SORTABLE, 'createdAt'),
    populate: POPULATE,
  });
}

export async function getUser(id: string): Promise<UserDoc> {
  const user = await User.findById(id).populate(POPULATE);
  if (!user) throw new NotFoundError('User');
  return user;
}

export async function createUser(
  actor: AuthenticatedUser,
  input: CreateUserInput,
  req: Request,
): Promise<{ user: UserDoc; generatedPassword?: string }> {
  assertCanManage(actor, input.role);

  const existing = await User.findOne({
    $or: [{ email: input.email }, { phone: input.phone }],
  }).lean();
  if (existing) {
    throw new ConflictError(
      existing.email === input.email
        ? 'An account with this email address already exists.'
        : 'An account with this phone number already exists.',
    );
  }

  const assignment = await resolveOrgAssignment(input);

  // Admin-created accounts get a strong random password unless one was supplied.
  const generatedPassword = input.password ? undefined : generateTemporaryPassword();
  const password = input.password ?? generatedPassword!;

  const user = await User.create({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    phone: input.phone,
    role: input.role,
    status: UserStatus.ACTIVE,
    passwordHash: await hashPassword(password),
    mustChangePassword: input.mustChangePassword ?? true,
    zone: assignment.zone,
    area: assignment.area,
    homecell: assignment.homecell,
    extraPermissions: input.extraPermissions ?? [],
    revokedPermissions: input.revokedPermissions ?? [],
    createdBy: actor.id,
  });

  await recordAudit(
    {
      action: AuditAction.CREATE,
      module: AuditModule.USERS,
      description: `Created ${input.role} account for ${input.firstName} ${input.lastName}`,
      entityModel: 'User',
      entityId: user._id,
      entityLabel: user.email,
      newValues: {
        email: user.email,
        role: user.role,
        zone: assignment.zone,
        area: assignment.area,
        homecell: assignment.homecell,
      },
      zone: assignment.zone,
      area: assignment.area,
      homecell: assignment.homecell,
    },
    req,
  );

  return { user: await getUser(idString(user._id)), generatedPassword };
}

export async function updateUser(
  actor: AuthenticatedUser,
  id: string,
  input: UpdateUserInput,
  req: Request,
): Promise<UserDoc> {
  const user = await User.findById(id);
  if (!user) throw new NotFoundError('User');

  assertCanManage(actor, user.role);
  if (input.role) assertCanManage(actor, input.role);

  const before = user.toObject();
  const nextRole = (input.role ?? user.role) as Role;

  if (input.firstName !== undefined) user.firstName = input.firstName;
  if (input.lastName !== undefined) user.lastName = input.lastName;
  if (input.email !== undefined) user.email = input.email;
  if (input.phone !== undefined) user.phone = input.phone;
  if (input.status !== undefined) user.status = input.status as UserStatus;
  if (input.extraPermissions !== undefined) user.extraPermissions = input.extraPermissions;
  if (input.revokedPermissions !== undefined) user.revokedPermissions = input.revokedPermissions;

  const assignmentChanged =
    input.role !== undefined ||
    input.zoneId !== undefined ||
    input.areaId !== undefined ||
    input.homecellId !== undefined;

  if (assignmentChanged) {
    const assignment = await resolveOrgAssignment({
      role: nextRole,
      zoneId: input.zoneId ?? (user.zone ? idString(user.zone) : null),
      areaId: input.areaId ?? (user.area ? idString(user.area) : null),
      homecellId: input.homecellId ?? (user.homecell ? idString(user.homecell) : null),
    });
    user.role = nextRole;
    user.zone = assignment.zone ? toObjectId(assignment.zone) : null;
    user.area = assignment.area ? toObjectId(assignment.area) : null;
    user.homecell = assignment.homecell ? toObjectId(assignment.homecell) : null;
  }

  await user.save();

  // A changed role or scope must not remain live on an old session.
  if (assignmentChanged || input.status === UserStatus.INACTIVE) {
    await revokeAllUserSessions(id, 'ACCOUNT_UPDATED');
  }

  const { previousValues, newValues } = diffValues(before, user.toObject());
  await recordAudit(
    {
      action: AuditAction.UPDATE,
      module: AuditModule.USERS,
      description: `Updated account ${user.email}`,
      entityModel: 'User',
      entityId: user._id,
      entityLabel: user.email,
      previousValues,
      newValues,
      zone: user.zone,
      area: user.area,
      homecell: user.homecell,
    },
    req,
  );

  return getUser(id);
}

export async function setUserStatus(
  actor: AuthenticatedUser,
  id: string,
  status: UserStatus,
  reason: string | undefined,
  req: Request,
): Promise<UserDoc> {
  if (id === actor.id) {
    throw new ConflictError('You cannot change the status of your own account.');
  }
  const user = await User.findById(id);
  if (!user) throw new NotFoundError('User');
  assertCanManage(actor, user.role);

  const previous = user.status;
  user.status = status;
  await user.save();

  if (status !== UserStatus.ACTIVE) {
    await revokeAllUserSessions(id, `STATUS_${status}`);
  }

  await recordAudit(
    {
      action: AuditAction.UPDATE,
      module: AuditModule.USERS,
      description: `Changed account status for ${user.email} from ${previous} to ${status}${
        reason ? ` — ${reason}` : ''
      }`,
      entityModel: 'User',
      entityId: user._id,
      entityLabel: user.email,
      previousValues: { status: previous },
      newValues: { status },
    },
    req,
  );

  return getUser(id);
}

export async function updatePermissions(
  actor: AuthenticatedUser,
  id: string,
  extraPermissions: string[],
  revokedPermissions: string[],
  req: Request,
): Promise<UserDoc> {
  const user = await User.findById(id);
  if (!user) throw new NotFoundError('User');
  assertCanManage(actor, user.role);

  const before = {
    extraPermissions: user.extraPermissions,
    revokedPermissions: user.revokedPermissions,
  };
  user.extraPermissions = extraPermissions;
  user.revokedPermissions = revokedPermissions;
  await user.save();

  await recordAudit(
    {
      action: AuditAction.PERMISSION_CHANGE,
      module: AuditModule.USERS,
      description: `Updated permission overrides for ${user.email}`,
      entityModel: 'User',
      entityId: user._id,
      entityLabel: user.email,
      previousValues: before,
      newValues: { extraPermissions, revokedPermissions },
    },
    req,
  );

  return getUser(id);
}

export async function adminResetPassword(
  actor: AuthenticatedUser,
  id: string,
  newPassword: string,
  mustChangePassword: boolean,
  req: Request,
): Promise<void> {
  const user = await User.findById(id).select('+passwordHash');
  if (!user) throw new NotFoundError('User');
  assertCanManage(actor, user.role);

  user.passwordHash = await hashPassword(newPassword);
  user.passwordChangedAt = new Date();
  user.mustChangePassword = mustChangePassword;
  user.failedLoginAttempts = 0;
  user.lockedUntil = null;
  await user.save();

  await revokeAllUserSessions(id, 'ADMIN_PASSWORD_RESET');

  await recordAudit(
    {
      action: AuditAction.PASSWORD_RESET,
      module: AuditModule.USERS,
      description: `Administrator reset the password for ${user.email}`,
      entityModel: 'User',
      entityId: user._id,
      entityLabel: user.email,
    },
    req,
  );
}

/** Random, unambiguous, and guaranteed to satisfy the password policy. */
export function generateTemporaryPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const all = upper + lower + digits + symbols;
  const pick = (set: string) => set[crypto.randomInt(set.length)];

  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 14) chars.push(pick(all));

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/** Users eligible to be assigned as a coordinator at a given level. */
export async function listAssignableCoordinators(role: Role) {
  return User.find({ role, status: UserStatus.ACTIVE })
    .select('firstName lastName email phone role zone area homecell')
    .sort({ firstName: 1 })
    .lean();
}
