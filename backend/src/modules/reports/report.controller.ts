import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { Permission } from '../../config/permissions';
import { authenticate, currentUser, requirePermission } from '../../middleware/authenticate';
import { dateRangeSchema, orgFilterSchema, validate } from '../../middleware/validate';
import {
  ATTENDANCE_TYPES,
  AuditAction,
  AuditModule,
  MEMBERSHIP_STATUSES,
  RemittanceStatus,
  TRANSACTION_TYPES,
} from '../../types/enums';
import { NotFoundError } from '../../utils/errors';
import { asyncHandler, ok } from '../../utils/http';
import { recordAudit } from '../audit/audit.service';
import { getSettings } from '../settings/settings.service';
import {
  EXPORT_CONTENT_TYPES,
  exportFilename,
  toCsv,
  toExcel,
  toPdf,
  type ExportFormat,
} from './export.service';
import * as reports from './report.service';
import type { ReportResult } from './report.service';

const baseFilters = orgFilterSchema.merge(dateRangeSchema);

/**
 * Report registry.
 *
 * Adding a report means adding one entry here — the list, run and export endpoints
 * all read from it, so a new report is immediately runnable and exportable in every
 * supported format.
 */
const REPORTS: Record<
  string,
  {
    label: string;
    description: string;
    group: 'Members' | 'Attendance' | 'Finance' | 'Demographics' | 'Transfers';
    schema: z.ZodTypeAny;
    run: (actor: ReturnType<typeof currentUser>, filters: never) => Promise<ReportResult>;
  }
> = {
  members: {
    label: 'Member Report',
    description: 'Members with their organisational assignment and contact details.',
    group: 'Members',
    schema: baseFilters.extend({
      membershipStatus: z.enum(MEMBERSHIP_STATUSES as [string, ...string[]]).optional(),
    }),
    run: (actor, filters) => reports.memberReport(actor, filters),
  },
  'demographics-age': {
    label: 'Age Demographic Report',
    description: 'Membership distribution across the configured age bands.',
    group: 'Demographics',
    schema: baseFilters,
    run: (actor, filters) => reports.ageDemographicReport(actor, filters),
  },
  'demographics-sex': {
    label: 'Sex Demographic Report',
    description: 'Membership distribution by sex.',
    group: 'Demographics',
    schema: baseFilters,
    run: (actor, filters) => reports.sexDemographicReport(actor, filters),
  },
  'demographics-location': {
    label: 'Location Report',
    description: 'Members aggregated by state, LGA, city or community.',
    group: 'Demographics',
    schema: baseFilters.extend({
      groupBy: z.enum(['state', 'lga', 'city', 'community']).optional(),
    }),
    run: (actor, filters) => reports.locationReport(actor, filters),
  },
  attendance: {
    label: 'Attendance Report',
    description: 'Attendance totals and percentages by Homecell, Area, Zone or date.',
    group: 'Attendance',
    schema: baseFilters.extend({
      type: z.enum(ATTENDANCE_TYPES as [string, ...string[]]).optional(),
      groupBy: z.enum(['homecell', 'area', 'zone', 'date']).optional(),
    }),
    run: (actor, filters) => reports.attendanceReport(actor, filters),
  },
  financial: {
    label: 'Financial Report',
    description: 'Opening balance, offerings, expenses, remittances and closing balance.',
    group: 'Finance',
    schema: baseFilters,
    run: (actor, filters) => reports.financialReport(actor, filters),
  },
  transactions: {
    label: 'Transaction Report',
    description: 'Full ledger detail behind any financial summary figure.',
    group: 'Finance',
    schema: baseFilters.extend({
      type: z.enum(TRANSACTION_TYPES as [string, ...string[]]).optional(),
    }),
    run: (actor, filters) => reports.transactionReport(actor, filters),
  },
  remittances: {
    label: 'Remittance Report',
    description: 'Remittances to the General Homecell Purse with their proof status.',
    group: 'Finance',
    schema: baseFilters.extend({
      status: z.enum(Object.values(RemittanceStatus) as [string, ...string[]]).optional(),
    }),
    run: (actor, filters) => reports.remittanceReport(actor, filters),
  },
  transfers: {
    label: 'Member Transfer Report',
    description: 'Transfer history across Homecells, Areas and Zones.',
    group: 'Transfers',
    schema: baseFilters,
    run: (actor, filters) => reports.transferReport(actor, filters),
  },
};

export const reportRouter = Router();
reportRouter.use(authenticate);

reportRouter.get(
  '/',
  requirePermission(Permission.REPORTS_VIEW),
  asyncHandler(async (_req: Request, res: Response) =>
    ok(
      res,
      Object.entries(REPORTS).map(([key, definition]) => ({
        key,
        label: definition.label,
        description: definition.description,
        group: definition.group,
      })),
    ),
  ),
);

reportRouter.get(
  '/summary',
  requirePermission(Permission.REPORTS_VIEW),
  validate({ query: baseFilters }),
  asyncHandler(async (req: Request, res: Response) =>
    ok(res, await reports.churchSummary(currentUser(req), req.query as never)),
  ),
);

reportRouter.get(
  '/:key',
  requirePermission(Permission.REPORTS_VIEW),
  asyncHandler(async (req: Request, res: Response) => {
    const definition = REPORTS[req.params.key];
    if (!definition) throw new NotFoundError('Report');

    const filters = definition.schema.parse(req.query);
    const report = await definition.run(currentUser(req), filters as never);
    return ok(res, report);
  }),
);

reportRouter.get(
  '/:key/export',
  requirePermission(Permission.REPORTS_EXPORT),
  asyncHandler(async (req: Request, res: Response) => {
    const definition = REPORTS[req.params.key];
    if (!definition) throw new NotFoundError('Report');

    const { format = 'csv', ...rest } = req.query as Record<string, unknown>;
    const exportFormat = z.enum(['csv', 'xlsx', 'pdf']).parse(format) as ExportFormat;

    const filters = definition.schema.parse(rest);
    const report = await definition.run(currentUser(req), filters as never);
    const settings = await getSettings();

    await recordAudit(
      {
        action: AuditAction.EXPORT,
        module: AuditModule.REPORTS,
        description: `Exported ${report.title} as ${exportFormat.toUpperCase()} (${report.rows.length} rows)`,
        entityLabel: req.params.key,
        newValues: { format: exportFormat, rows: report.rows.length, filters },
      },
      req,
    );

    const filename = exportFilename(report, exportFormat);
    res.setHeader('Content-Type', EXPORT_CONTENT_TYPES[exportFormat]);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    if (exportFormat === 'csv') {
      // BOM so Excel opens UTF-8 (and the ₦ sign) correctly.
      return res.send(`﻿${toCsv(report, settings.currency)}`);
    }
    if (exportFormat === 'xlsx') {
      return res.send(await toExcel(report, settings.currency));
    }
    return res.send(await toPdf(report, settings.currency));
  }),
);
