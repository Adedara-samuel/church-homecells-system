import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../config/permissions';
import { authenticate, currentUser, requirePermission } from '../../middleware/authenticate';
import {
  dateRangeSchema,
  idParamSchema,
  objectIdSchema,
  orgFilterSchema,
  paginationSchema,
  validate,
} from '../../middleware/validate';
import { ATTENDANCE_TYPES, AttendanceStatus, AttendanceType } from '../../types/enums';
import { asyncHandler, created, ok, paginated } from '../../utils/http';
import * as service from './attendance.service';

const attendanceType = z.enum(ATTENDANCE_TYPES as [AttendanceType, ...AttendanceType[]]);
const attendanceStatus = z.enum(
  Object.values(AttendanceStatus) as [AttendanceStatus, ...AttendanceStatus[]],
);

export const recordAttendanceSchema = z.object({
  homecellId: objectIdSchema,
  type: attendanceType,
  date: z.string().date('Select a valid date'),
  entries: z
    .array(
      z.object({
        memberId: objectIdSchema,
        status: attendanceStatus,
        note: z.string().trim().max(300).optional(),
      }),
    )
    .min(1, 'Mark at least one member')
    .max(500),
});

const registerQuerySchema = z.object({
  homecellId: objectIdSchema,
  type: attendanceType,
  date: z.string().date('Select a valid date'),
});

const listSchema = paginationSchema
  .merge(orgFilterSchema)
  .merge(dateRangeSchema)
  .extend({
    type: attendanceType.optional(),
    status: attendanceStatus.optional(),
    memberId: objectIdSchema.optional(),
  });

const summarySchema = orgFilterSchema.merge(dateRangeSchema);

export const attendanceRouter = Router();
attendanceRouter.use(authenticate);

attendanceRouter.get(
  '/',
  requirePermission(Permission.ATTENDANCE_VIEW),
  validate({ query: listSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    paginated(res, await service.listAttendance(currentUser(req), req.query as never)),
  ),
);

attendanceRouter.get(
  '/register',
  requirePermission(Permission.ATTENDANCE_VIEW),
  validate({ query: registerQuerySchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const { homecellId, type, date } = req.query as unknown as z.infer<typeof registerQuerySchema>;
    return ok(res, await service.getRegister(currentUser(req), homecellId, type, date));
  }),
);

attendanceRouter.get(
  '/summary',
  requirePermission(Permission.ATTENDANCE_VIEW),
  validate({ query: summarySchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.attendanceSummary(currentUser(req), req.query as never)),
  ),
);

attendanceRouter.get(
  '/trend',
  requirePermission(Permission.ATTENDANCE_VIEW),
  validate({ query: summarySchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.attendanceTrend(currentUser(req), req.query as never)),
  ),
);

attendanceRouter.get(
  '/member/:memberId',
  requirePermission(Permission.ATTENDANCE_VIEW),
  validate({ params: z.object({ memberId: objectIdSchema }), query: dateRangeSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(
      res,
      await service.memberAttendanceHistory(
        currentUser(req),
        req.params.memberId,
        req.query as never,
      ),
    ),
  ),
);

attendanceRouter.post(
  '/',
  requirePermission(Permission.ATTENDANCE_CREATE),
  validate({ body: recordAttendanceSchema }),
  asyncHandler(async (req: Request, res: Response) =>
    created(res, await service.recordAttendance(currentUser(req), req.body as never, req)),
  ),
);

attendanceRouter.patch(
  '/:id',
  requirePermission(Permission.ATTENDANCE_UPDATE),
  validate({
    params: idParamSchema,
    body: z.object({ status: attendanceStatus, note: z.string().trim().max(300).optional() }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { status, note } = req.body as { status: AttendanceStatus; note?: string };
    return ok(
      res,
      await service.updateAttendanceRecord(currentUser(req), req.params.id, status, note, req),
    );
  }),
);
