import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../config/permissions';
import { authenticate, currentUser, requirePermission } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import {
  AuditAction,
  AuditModule,
  PAYMENT_PROVIDERS,
  SmsProviderName,
  TransferApprovalStage,
} from '../../types/enums';
import { asyncHandler, ok } from '../../utils/http';
import { toMajor, toMinor } from '../../utils/money';
import { diffValues, recordAudit } from '../audit/audit.service';
import { providerStatuses } from '../payments/providers';
import { smsProviderStatuses } from '../sms/providers';
import { uploadsConfiguredWith } from '../uploads/upload.service';
import { getSettings, updateSettings } from './settings.service';
import type { SystemSettingsDocument } from './settings.model';

const approvalStage = z.enum(Object.values(TransferApprovalStage) as [string, ...string[]]);

const updateSchema = z.object({
  churchName: z.string().trim().min(2).max(160).optional(),

  // Amounts arrive in major units and are stored in minor units.
  maxPurseThreshold: z.number().min(0).max(1_000_000_000).optional(),
  expenseApprovalRequired: z.boolean().optional(),
  expenseApprovalThreshold: z.number().min(0).optional(),
  remittanceRequiresApproval: z.boolean().optional(),
  remittanceRequiresReceipt: z.boolean().optional(),
  generalPurseAccountName: z.string().trim().max(160).optional(),
  generalPurseAccountNumber: z.string().trim().max(32).optional(),
  generalPurseBankName: z.string().trim().max(120).optional(),

  activePaymentProvider: z.enum(PAYMENT_PROVIDERS as [string, ...string[]]).optional(),
  paymentsEnabled: z.boolean().optional(),
  payoutsEnabled: z.boolean().optional(),

  transferApprovalChainSameArea: z.array(approvalStage).max(4).optional(),
  transferApprovalChainCrossArea: z.array(approvalStage).max(4).optional(),
  transferApprovalChainCrossZone: z.array(approvalStage).max(4).optional(),

  activeSmsProvider: z.enum(Object.values(SmsProviderName) as [string, ...string[]]).optional(),
  smsSenderId: z.string().trim().min(3).max(11).optional(),
  birthdaySmsEnabled: z.boolean().optional(),
  anniversarySmsEnabled: z.boolean().optional(),
  birthdayMessageTemplate: z.string().trim().min(10).max(640).optional(),
  anniversaryMessageTemplate: z.string().trim().min(10).max(640).optional(),

  ageBands: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(24),
        min: z.number().int().min(0).max(150),
        max: z.number().int().min(0).max(150).nullable(),
      }),
    )
    .min(1)
    .max(20)
    .optional(),
  upcomingCelebrationWindowDays: z.number().int().min(1).max(365).optional(),

  maxUploadSizeMb: z.number().min(1).max(50).optional(),
  allowedUploadMimeTypes: z.array(z.string().max(80)).min(1).max(20).optional(),
});

/** Presents stored minor-unit amounts as major units for the settings screen. */
function present(settings: SystemSettingsDocument) {
  const json = settings.toJSON() as Record<string, unknown>;
  return {
    ...json,
    maxPurseThreshold: toMajor(settings.maxPurseThresholdMinor),
    expenseApprovalThreshold: toMajor(settings.expenseApprovalThresholdMinor),
  };
}

export const settingsRouter = Router();
settingsRouter.use(authenticate);

settingsRouter.get(
  '/',
  requirePermission(Permission.SETTINGS_VIEW),
  asyncHandler(async (_req: Request, res: Response) => ok(res, present(await getSettings(true)))),
);

/** Integration health — which providers actually have credentials in this environment. */
settingsRouter.get(
  '/integrations',
  requirePermission(Permission.SETTINGS_VIEW),
  asyncHandler(async (_req: Request, res: Response) => {
    const settings = await getSettings();
    return ok(res, {
      payments: {
        active: settings.activePaymentProvider,
        providers: providerStatuses(),
        paymentsEnabled: settings.paymentsEnabled,
        payoutsEnabled: settings.payoutsEnabled,
      },
      sms: {
        active: settings.activeSmsProvider,
        providers: smsProviderStatuses(),
        birthdayEnabled: settings.birthdaySmsEnabled,
        anniversaryEnabled: settings.anniversarySmsEnabled,
      },
      uploads: { provider: uploadsConfiguredWith(), maxSizeMb: settings.maxUploadSizeMb },
    });
  }),
);

settingsRouter.patch(
  '/',
  requirePermission(Permission.SETTINGS_UPDATE),
  validate({ body: updateSchema }),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof updateSchema>;
    const before = (await getSettings(true)).toObject();

    const { maxPurseThreshold, expenseApprovalThreshold, ...rest } = body;
    const patch: Record<string, unknown> = { ...rest };
    if (maxPurseThreshold !== undefined) patch.maxPurseThresholdMinor = toMinor(maxPurseThreshold);
    if (expenseApprovalThreshold !== undefined) {
      patch.expenseApprovalThresholdMinor = toMinor(expenseApprovalThreshold);
    }

    const updated = await updateSettings(patch as never, currentUser(req).id);
    const { previousValues, newValues } = diffValues(before, updated.toObject());

    await recordAudit(
      {
        action: AuditAction.UPDATE,
        module: AuditModule.SETTINGS,
        description: 'Updated system settings',
        entityModel: 'SystemSettings',
        entityId: updated._id,
        previousValues,
        newValues,
      },
      req,
    );

    return ok(res, present(updated));
  }),
);
