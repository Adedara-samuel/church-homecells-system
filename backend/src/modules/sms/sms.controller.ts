import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../config/permissions';
import { authenticate, currentUser, requirePermission } from '../../middleware/authenticate';
import { dateRangeSchema, paginationSchema, phoneSchema, validate } from '../../middleware/validate';
import { AuditAction, AuditModule, SmsDeliveryStatus, SmsType } from '../../types/enums';
import { asyncHandler, created, ok, paginated } from '../../utils/http';
import { recordAudit } from '../audit/audit.service';
import { smsProviderStatuses } from './providers';
import * as service from './sms.service';

export const smsRouter = Router();
smsRouter.use(authenticate);

smsRouter.get(
  '/',
  requirePermission(Permission.SMS_VIEW),
  validate({
    query: paginationSchema.merge(dateRangeSchema).extend({
      type: z.enum(Object.values(SmsType) as [string, ...string[]]).optional(),
      status: z.enum(Object.values(SmsDeliveryStatus) as [string, ...string[]]).optional(),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) =>
    paginated(res, await service.listSmsLogs(currentUser(req), req.query as never)),
  ),
);

smsRouter.get(
  '/statistics',
  requirePermission(Permission.SMS_VIEW),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await service.smsStatistics(currentUser(req))),
  ),
);

smsRouter.get(
  '/providers',
  requirePermission(Permission.SMS_VIEW),
  asyncHandler(async (_req: Request, res: Response) => ok(res, smsProviderStatuses())),
);

/** Sends a single message — used to test the provider configuration. */
smsRouter.post(
  '/test',
  requirePermission(Permission.SMS_CONFIGURE),
  validate({
    body: z.object({
      phone: phoneSchema,
      message: z.string().trim().min(3, 'Enter a message').max(480),
    }),
  }),
  asyncHandler(async (req: Request, res: Response) => {
    const { phone, message } = req.body as { phone: string; message: string };
    const outcome = await service.sendSms({
      phone,
      message,
      type: SmsType.TRANSACTIONAL,
    });

    await recordAudit(
      {
        action: AuditAction.SMS_DISPATCH,
        module: AuditModule.SMS,
        description: `Sent a test SMS to ${phone} (${outcome})`,
        newValues: { phone, outcome },
      },
      req,
    );

    return created(res, { outcome });
  }),
);

/**
 * Runs the celebration dispatch on demand.
 * The scheduled job does the same thing daily; this exists so an administrator can
 * re-run it after fixing a configuration problem.
 */
smsRouter.post(
  '/dispatch-celebrations',
  requirePermission(Permission.SMS_SEND),
  validate({ body: z.object({ date: z.string().date().optional() }) }),
  asyncHandler(async (req: Request, res: Response) => {
    const date = (req.body as { date?: string }).date
      ? new Date((req.body as { date: string }).date)
      : new Date();

    const [birthdays, anniversaries] = await Promise.all([
      service.dispatchBirthdayMessages(date),
      service.dispatchAnniversaryMessages(date),
    ]);

    await recordAudit(
      {
        action: AuditAction.SMS_DISPATCH,
        module: AuditModule.SMS,
        description: `Manually dispatched celebration messages — ${birthdays.sent} birthday, ${anniversaries.sent} anniversary`,
        newValues: { birthdays, anniversaries },
      },
      req,
    );

    return ok(res, { birthdays, anniversaries });
  }),
);
