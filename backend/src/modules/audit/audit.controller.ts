import { Router, type Request, type Response } from 'express';
import type { FilterQuery } from 'mongoose';
import { z } from 'zod';
import { Permission } from '../../config/permissions';
import { authenticate, currentUser, requirePermission } from '../../middleware/authenticate';
import {
  dateRangeSchema,
  objectIdSchema,
  orgFilterSchema,
  paginationSchema,
  validate,
} from '../../middleware/validate';
import { AuditAction, AuditModule } from '../../types/enums';
import { dateRange } from '../../utils/dates';
import { toObjectId } from '../../utils/ids';
import { asyncHandler, ok, paginated } from '../../utils/http';
import { mergeFilters, paginate, searchFilter } from '../../utils/query';
import { AuditLog, type AuditLogDoc } from './audit.model';

export const auditRouter = Router();
auditRouter.use(authenticate, requirePermission(Permission.AUDIT_VIEW));

const listSchema = paginationSchema
  .merge(orgFilterSchema)
  .merge(dateRangeSchema)
  .extend({
    action: z.enum(Object.values(AuditAction) as [string, ...string[]]).optional(),
    module: z.enum(Object.values(AuditModule) as [string, ...string[]]).optional(),
    userId: objectIdSchema.optional(),
    entityId: objectIdSchema.optional(),
  });

auditRouter.get(
  '/',
  validate({ query: listSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const actor = currentUser(req);
    const query = req.query as unknown as z.infer<typeof listSchema>;

    const filter: FilterQuery<AuditLogDoc> = {};
    if (query.action) filter.action = query.action as AuditAction;
    if (query.module) filter.module = query.module as AuditModule;
    if (query.userId) filter.user = toObjectId(query.userId);
    if (query.entityId) filter.entityId = toObjectId(query.entityId);
    if (query.from || query.to) filter.createdAt = dateRange(query.from, query.to) as never;

    // Church-wide roles see everything; a scoped role sees only entries tagged to
    // their own part of the organisation, plus their own actions.
    if (!actor.can(Permission.AUDIT_VIEW_ALL)) {
      const scopeClauses: FilterQuery<AuditLogDoc>[] = [{ user: toObjectId(actor.id) }];
      if (actor.homecellId) scopeClauses.push({ homecell: toObjectId(actor.homecellId) });
      if (actor.areaId) scopeClauses.push({ area: toObjectId(actor.areaId) });
      if (actor.zoneId) scopeClauses.push({ zone: toObjectId(actor.zoneId) });
      filter.$or = scopeClauses;
    }

    if (query.homecellId) filter.homecell = toObjectId(query.homecellId);
    if (query.areaId) filter.area = toObjectId(query.areaId);
    if (query.zoneId) filter.zone = toObjectId(query.zoneId);

    const result = await paginate(AuditLog, {
      filter: mergeFilters<AuditLogDoc>(
        filter,
        searchFilter(query.search, ['description', 'userName', 'entityLabel']) as FilterQuery<AuditLogDoc>,
      ),
      page: query.page,
      limit: query.limit,
      sort: { createdAt: query.order === 'asc' ? 1 : -1 },
      populate: { path: 'user', select: 'firstName lastName email role' },
    });

    return paginated(res, result);
  }),
);

/** Full change history for one record, oldest first — the "who changed what" view. */
auditRouter.get(
  '/entity/:entityModel/:entityId',
  validate({
    params: z.object({
      entityModel: z.string().trim().min(2).max(40),
      entityId: objectIdSchema,
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const entries = await AuditLog.find({
      entityModel: req.params.entityModel,
      entityId: toObjectId(req.params.entityId),
    })
      .populate({ path: 'user', select: 'firstName lastName role' })
      .sort({ createdAt: 1 })
      .limit(500)
      .lean();
    return ok(res, entries);
  }),
);

auditRouter.get(
  '/statistics',
  asyncHandler(async (_req: Request, res: Response) => {
    const [byModule, byAction, recentFailures] = await Promise.all([
      AuditLog.aggregate([{ $group: { _id: '$module', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      AuditLog.aggregate([{ $group: { _id: '$action', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
      AuditLog.countDocuments({ success: false }),
    ]);
    return ok(res, {
      byModule: byModule.map((r) => ({ module: r._id, count: r.count })),
      byAction: byAction.map((r) => ({ action: r._id, count: r.count })),
      recentFailures,
    });
  }),
);
