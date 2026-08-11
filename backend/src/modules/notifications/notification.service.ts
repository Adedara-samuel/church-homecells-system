import type { FilterQuery, Types } from 'mongoose';
import { logger } from '../../config/logger';
import { buildPagination } from '../../utils/http';
import {
  NotificationSeverity,
  NotificationType,
  Role,
  UserStatus,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { NotFoundError } from '../../utils/errors';
import { idString, toObjectId } from '../../utils/ids';
import { Area } from '../areas/area.model';
import { Homecell } from '../homecells/homecell.model';
import { User } from '../users/user.model';
import { Notification, type NotificationDoc } from './notification.model';

export interface CreateNotificationInput {
  recipients: (string | Types.ObjectId)[];
  type: NotificationType;
  title: string;
  message: string;
  severity?: NotificationSeverity;
  entityModel?: string;
  entityId?: string | Types.ObjectId | null;
  actionUrl?: string;
  homecell?: string | Types.ObjectId | null;
  area?: string | Types.ObjectId | null;
  zone?: string | Types.ObjectId | null;
  dedupeKey?: string;
}

/**
 * Creates one notification per recipient.
 *
 * Notifications are an auxiliary concern: a failure here must never roll back the
 * business operation that triggered it, so errors are logged, not propagated.
 * Duplicate-key collisions on `dedupeKey` are the expected, healthy outcome when the
 * same ongoing condition is detected again and are silently ignored.
 */
export async function notify(input: CreateNotificationInput): Promise<number> {
  const unique = [...new Set(input.recipients.map(idString).filter(Boolean))];
  if (unique.length === 0) return 0;

  let createdCount = 0;
  for (const recipient of unique) {
    try {
      await Notification.create({
        recipient,
        type: input.type,
        severity: input.severity ?? NotificationSeverity.INFO,
        title: input.title,
        message: input.message,
        entityModel: input.entityModel ?? null,
        entityId: input.entityId ?? null,
        actionUrl: input.actionUrl ?? null,
        homecell: input.homecell ?? null,
        area: input.area ?? null,
        zone: input.zone ?? null,
        dedupeKey: input.dedupeKey ? `${input.dedupeKey}` : null,
      });
      createdCount += 1;
    } catch (err) {
      const duplicate = (err as { code?: number }).code === 11000;
      if (!duplicate) {
        logger.error({ err, type: input.type, recipient }, 'Failed to create notification');
      }
    }
  }
  return createdCount;
}

/**
 * Resolves the chain of users who should hear about something happening in a Homecell:
 * its coordinator(s), the Area Coordinator, the Zonal Coordinator, and optionally
 * church-wide administrators.
 */
export async function resolveEscalationRecipients(options: {
  homecellId?: string | Types.ObjectId | null;
  areaId?: string | Types.ObjectId | null;
  zoneId?: string | Types.ObjectId | null;
  includeHomecell?: boolean;
  includeArea?: boolean;
  includeZone?: boolean;
  includeChurchAdmins?: boolean;
}): Promise<string[]> {
  const recipients: string[] = [];

  if (options.includeHomecell !== false && options.homecellId) {
    const homecell = await Homecell.findById(options.homecellId)
      .select('coordinator assistantCoordinator')
      .lean();
    if (homecell?.coordinator) recipients.push(idString(homecell.coordinator));
    if (homecell?.assistantCoordinator) recipients.push(idString(homecell.assistantCoordinator));
  }

  if (options.includeArea && options.areaId) {
    const area = await Area.findById(options.areaId).select('coordinator').lean();
    if (area?.coordinator) recipients.push(idString(area.coordinator));
    const areaCoordinators = await User.find({
      role: Role.AREA_COORDINATOR,
      area: options.areaId,
      status: UserStatus.ACTIVE,
    })
      .select('_id')
      .lean();
    recipients.push(...areaCoordinators.map((u) => idString(u._id)));
  }

  if (options.includeZone && options.zoneId) {
    const zonalCoordinators = await User.find({
      role: Role.ZONAL_COORDINATOR,
      zone: options.zoneId,
      status: UserStatus.ACTIVE,
    })
      .select('_id')
      .lean();
    recipients.push(...zonalCoordinators.map((u) => idString(u._id)));
  }

  if (options.includeChurchAdmins) {
    const admins = await User.find({
      role: { $in: [Role.CHURCH_ADMIN, Role.SYSTEM_ADMIN] },
      status: UserStatus.ACTIVE,
    })
      .select('_id')
      .lean();
    recipients.push(...admins.map((u) => idString(u._id)));
  }

  return [...new Set(recipients)];
}

/** Every active user holding a given role, optionally narrowed to one org unit. */
export async function usersWithRole(
  role: Role,
  scope: { zone?: unknown; area?: unknown; homecell?: unknown } = {},
): Promise<string[]> {
  const filter: FilterQuery<unknown> = { role, status: UserStatus.ACTIVE };
  if (scope.homecell) filter.homecell = scope.homecell;
  else if (scope.area) filter.area = scope.area;
  else if (scope.zone) filter.zone = scope.zone;

  const users = await User.find(filter).select('_id').lean();
  return users.map((u) => idString(u._id));
}

export interface ListNotificationsQuery {
  page: number;
  limit: number;
  unreadOnly?: boolean;
  type?: NotificationType;
}

export async function listNotifications(actor: AuthenticatedUser, query: ListNotificationsQuery) {
  const filter: FilterQuery<NotificationDoc> = { recipient: toObjectId(actor.id) };
  if (query.unreadOnly) filter.isRead = false;
  if (query.type) filter.type = query.type;

  const skip = (query.page - 1) * query.limit;
  const [items, total, unreadCount] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ recipient: toObjectId(actor.id), isRead: false }),
  ]);

  return {
    items,
    pagination: buildPagination(query.page, query.limit, total),
    unreadCount,
  };
}

export async function unreadCount(actor: AuthenticatedUser): Promise<number> {
  return Notification.countDocuments({ recipient: toObjectId(actor.id), isRead: false });
}

export async function markRead(actor: AuthenticatedUser, id: string): Promise<NotificationDoc> {
  const notification = await Notification.findOneAndUpdate(
    { _id: toObjectId(id), recipient: toObjectId(actor.id) },
    { $set: { isRead: true, readAt: new Date() } },
    { new: true },
  );
  if (!notification) throw new NotFoundError('Notification');
  return notification;
}

export async function markAllRead(actor: AuthenticatedUser): Promise<number> {
  const result = await Notification.updateMany(
    { recipient: toObjectId(actor.id), isRead: false },
    { $set: { isRead: true, readAt: new Date() } },
  );
  return result.modifiedCount;
}
