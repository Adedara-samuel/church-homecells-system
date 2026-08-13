import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env';
import { logger } from '../config/logger';
import {
  ATTENDANCE_TYPE_LABELS,
  ATTENDANCE_TYPE_WEEKDAY,
  AttendanceType,
  NotificationSeverity,
  NotificationType,
  OrgStatus,
  RemittanceStatus,
} from '../types/enums';
import { dayjs, toCalendarDate } from '../utils/dates';
import { idString } from '../utils/ids';
import { Attendance } from '../modules/attendance/attendance.model';
import { Homecell } from '../modules/homecells/homecell.model';
import {
  closeExpiredDefinitions,
  generateAllInvoices,
  notifyDueAndOverdue,
} from '../modules/dues/dues.service';
import { checkThresholdAndNotify } from '../modules/finance/purse.service';
import { notify, resolveEscalationRecipients } from '../modules/notifications/notification.service';
import { runReconciliation } from '../modules/payments/reconciliation.service';
import { Remittance } from '../modules/remittances/remittance.model';
import { getSettings } from '../modules/settings/settings.service';
import {
  dispatchAnniversaryMessages,
  dispatchBirthdayMessages,
} from '../modules/sms/sms.service';

const tasks: ScheduledTask[] = [];

/** Wraps a job so a failure is logged rather than crashing the scheduler. */
function safely(name: string, fn: () => Promise<void>) {
  return async () => {
    const started = Date.now();
    try {
      logger.info({ job: name }, 'Scheduled job started');
      await fn();
      logger.info({ job: name, durationMs: Date.now() - started }, 'Scheduled job finished');
    } catch (err) {
      logger.error({ err, job: name }, 'Scheduled job failed');
    }
  };
}

/** SRS §9 — daily birthday and wedding anniversary messages. */
export const celebrationJob = safely('celebrations', async () => {
  const [birthdays, anniversaries] = await Promise.all([
    dispatchBirthdayMessages(),
    dispatchAnniversaryMessages(),
  ]);
  logger.info({ birthdays, anniversaries }, 'Celebration messages dispatched');
});

/** SRS 8.3 / BR-014 — sweep every active Homecell purse against its threshold. */
export const thresholdJob = safely('purse-threshold', async () => {
  const homecells = await Homecell.find({ status: OrgStatus.ACTIVE }).select('_id').lean();
  let flagged = 0;
  for (const homecell of homecells) {
    if (await checkThresholdAndNotify(idString(homecell._id))) flagged += 1;
  }
  logger.info({ checked: homecells.length, flagged }, 'Purse threshold sweep complete');
});

/** Nudges coordinators whose approved remittances have not been completed. */
export const remittanceReminderJob = safely('remittance-reminders', async () => {
  const stale = await Remittance.find({
    status: { $in: [RemittanceStatus.PENDING_APPROVAL, RemittanceStatus.APPROVED] },
    createdAt: { $lte: dayjs.utc().subtract(3, 'day').toDate() },
  })
    .select('reference homecell area zone status createdAt')
    .lean();

  for (const remittance of stale) {
    const recipients = await resolveEscalationRecipients({
      homecellId: remittance.homecell,
      areaId: remittance.area,
      zoneId: remittance.zone,
      includeHomecell: true,
      includeArea: true,
    });
    await notify({
      recipients,
      type: NotificationType.REMITTANCE_PENDING,
      severity: NotificationSeverity.WARNING,
      title: 'Remittance still outstanding',
      message: `Remittance ${remittance.reference} has been ${remittance.status
        .toLowerCase()
        .replace(/_/g, ' ')} since ${dayjs.utc(remittance.createdAt).format('D MMM YYYY')}.`,
      entityModel: 'Remittance',
      entityId: remittance._id,
      actionUrl: `/finance/remittances/${idString(remittance._id)}`,
      homecell: remittance.homecell,
      area: remittance.area,
      zone: remittance.zone,
      dedupeKey: `remittance-pending:${idString(remittance._id)}`,
    });
  }
  logger.info({ reminded: stale.length }, 'Remittance reminders dispatched');
});

/**
 * SRS §12 — "attendance not submitted".
 * Runs on the evening of each meeting day and flags Homecells with no register.
 */
export const attendanceReminderJob = safely('attendance-reminders', async () => {
  const today = toCalendarDate(new Date());
  const weekday = dayjs.utc(today).day();

  const type = (Object.keys(ATTENDANCE_TYPE_WEEKDAY) as AttendanceType[]).find(
    (t) => ATTENDANCE_TYPE_WEEKDAY[t] === weekday,
  );
  if (!type) return;

  const homecells = await Homecell.find({ status: OrgStatus.ACTIVE })
    .select('_id name area zone')
    .lean();

  const recorded = await Attendance.distinct('homecell', { type, date: today });
  const recordedSet = new Set(recorded.map(idString));

  const missing = homecells.filter((h) => !recordedSet.has(idString(h._id)));

  for (const homecell of missing) {
    const recipients = await resolveEscalationRecipients({
      homecellId: homecell._id,
      includeHomecell: true,
    });
    await notify({
      recipients,
      type: NotificationType.ATTENDANCE_NOT_SUBMITTED,
      severity: NotificationSeverity.WARNING,
      title: 'Attendance not yet submitted',
      message: `${ATTENDANCE_TYPE_LABELS[type]} attendance for ${homecell.name} has not been recorded for today.`,
      entityModel: 'Homecell',
      entityId: homecell._id,
      actionUrl: `/attendance/record?homecellId=${idString(homecell._id)}&type=${type}`,
      homecell: homecell._id,
      area: homecell.area,
      zone: homecell.zone,
      dedupeKey: `attendance-missing:${idString(homecell._id)}:${type}:${dayjs
        .utc(today)
        .format('YYYY-MM-DD')}`,
    });
  }

  logger.info({ type, missing: missing.length }, 'Attendance reminders dispatched');
});

/**
 * Keeps the dues ledger current: closes levies whose due date has passed, raises the
 * new month's invoices for every active Homecell, then tells coordinators what falls
 * due today and what is already late.
 *
 * Generation is idempotent — a Homecell that already has this month's invoice is left
 * alone — so running the job twice in a day cannot double-bill anyone.
 */
export const duesJob = safely('dues', async () => {
  const closed = await closeExpiredDefinitions();
  const { homecells, created } = await generateAllInvoices();
  const { due, overdue } = await notifyDueAndOverdue();
  logger.info(
    { closedLevies: closed, homecells, created, due, overdue },
    'Dues accrual and reminders complete',
  );
});

/** SRS §12 — nightly payment reconciliation against the active provider. */
export const reconciliationJob = safely('payment-reconciliation', async () => {
  const settings = await getSettings();
  await runReconciliation({
    provider: settings.activePaymentProvider,
    from: dayjs.utc().subtract(2, 'day').startOf('day').toDate(),
    to: new Date(),
    trigger: 'SCHEDULED',
  });
});

export function startJobs(): void {
  if (!env.ENABLE_CRON_JOBS) {
    logger.info('Scheduled jobs are disabled (ENABLE_CRON_JOBS=false)');
    return;
  }

  const options = { timezone: env.CRON_TIMEZONE };
  const schedule = (expression: string, handler: () => Promise<void>, name: string) => {
    if (!cron.validate(expression)) {
      logger.error({ expression, name }, 'Invalid cron expression — job not scheduled');
      return;
    }
    tasks.push(cron.schedule(expression, handler, options));
    logger.info({ name, expression, timezone: env.CRON_TIMEZONE }, 'Scheduled job registered');
  };

  schedule(env.CELEBRATION_CRON, celebrationJob, 'celebrations');
  schedule(env.THRESHOLD_CRON, thresholdJob, 'purse-threshold');
  schedule(env.ATTENDANCE_REMINDER_CRON, attendanceReminderJob, 'attendance-reminders');
  schedule(env.RECONCILIATION_CRON, reconciliationJob, 'payment-reconciliation');
  schedule('0 9 * * *', remittanceReminderJob, 'remittance-reminders');
  // Early enough that a coordinator opening the app in the morning already sees the
  // new month's charge and any due-today reminder.
  schedule(env.DUES_CRON, duesJob, 'dues');
}

export function stopJobs(): void {
  for (const task of tasks) task.stop();
  tasks.length = 0;
}
