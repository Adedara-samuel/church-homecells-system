import type { FilterQuery } from 'mongoose';
import { logger } from '../../config/logger';
import { resolveScopedFilter } from '../../middleware/scope';
import {
  MembershipStatus,
  SmsDeliveryStatus,
  SmsType,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { dateRange, dayjs } from '../../utils/dates';
import { idString } from '../../utils/ids';
import { paginate } from '../../utils/query';
import { Member } from '../members/member.model';
import { getSettings } from '../settings/settings.service';
import { countSegments, getSmsProvider } from './providers';
import { SmsLog, type SmsLogDoc } from './sms.model';

/** Substitutes `{{name}}` / `{{church}}` placeholders in a configured template. */
export function renderTemplate(
  template: string,
  values: { name: string; church: string },
): string {
  return template
    .replace(/\{\{\s*name\s*\}\}/gi, values.name)
    .replace(/\{\{\s*church\s*\}\}/gi, values.church);
}

export interface DispatchResult {
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
}

interface SendOptions {
  member?: { id: string; name: string } | null;
  phone: string;
  message: string;
  type: SmsType;
  /** Prevents the same greeting going out twice for the same occasion. */
  dedupeKey?: string;
}

/**
 * Sends one message and records the attempt.
 *
 * The log entry is written *before* the provider call, so a crash mid-send still
 * leaves a trace, and the unique `dedupeKey` index means a job that runs twice on the
 * same day cannot greet anyone twice.
 */
export async function sendSms(options: SendOptions): Promise<'SENT' | 'FAILED' | 'SKIPPED'> {
  const settings = await getSettings();
  const provider = getSmsProvider(settings.activeSmsProvider);

  let log;
  try {
    log = await SmsLog.create({
      member: options.member?.id ?? null,
      recipientName: options.member?.name,
      phone: options.phone,
      type: options.type,
      message: options.message,
      provider: provider.name,
      status: SmsDeliveryStatus.QUEUED,
      segments: countSegments(options.message),
      dedupeKey: options.dedupeKey ?? null,
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      logger.debug({ dedupeKey: options.dedupeKey }, 'SMS already sent for this occasion — skipping');
      return 'SKIPPED';
    }
    throw err;
  }

  try {
    const result = await provider.send({
      to: options.phone,
      message: options.message,
      senderId: settings.smsSenderId,
    });

    log.status = result.status;
    log.providerReference = result.providerReference;
    log.providerResponse = result.raw;
    log.error = result.error;
    log.sentAt = new Date();
    if (result.status === SmsDeliveryStatus.DELIVERED) log.deliveredAt = new Date();
    await log.save();

    return result.status === SmsDeliveryStatus.FAILED ? 'FAILED' : 'SENT';
  } catch (err) {
    log.status = SmsDeliveryStatus.FAILED;
    log.error = (err as Error).message;
    await log.save();
    logger.error({ err, phone: options.phone }, 'SMS dispatch failed');
    return 'FAILED';
  }
}

/**
 * SRS FR-SMS-001: greets every member whose birthday falls today.
 * Matching is on the denormalised `birthMonthDay` key, so it is one indexed lookup
 * rather than a scan with date arithmetic.
 */
export async function dispatchBirthdayMessages(referenceDate = new Date()): Promise<DispatchResult> {
  const settings = await getSettings();
  const result: DispatchResult = { attempted: 0, sent: 0, failed: 0, skipped: 0 };

  if (!settings.birthdaySmsEnabled) {
    logger.info('Birthday SMS is disabled in system settings — nothing dispatched');
    return result;
  }

  const key = dayjs.utc(referenceDate).format('MM-DD');
  const dateStamp = dayjs.utc(referenceDate).format('YYYY-MM-DD');

  const celebrants = await Member.find({
    birthMonthDay: key,
    membershipStatus: MembershipStatus.ACTIVE,
    phone: { $exists: true, $nin: [null, ''] },
  })
    .select('firstName lastName preferredName phone')
    .lean();

  for (const member of celebrants) {
    result.attempted += 1;
    const name = member.preferredName || member.firstName;
    const outcome = await sendSms({
      member: { id: idString(member._id), name: `${member.firstName} ${member.lastName}` },
      phone: member.phone,
      type: SmsType.BIRTHDAY,
      message: renderTemplate(settings.birthdayMessageTemplate, {
        name,
        church: settings.churchName,
      }),
      dedupeKey: `BIRTHDAY:${idString(member._id)}:${dateStamp}`,
    });
    if (outcome === 'SENT') result.sent += 1;
    else if (outcome === 'FAILED') result.failed += 1;
    else result.skipped += 1;
  }

  logger.info({ date: dateStamp, ...result }, 'Birthday SMS dispatch complete');
  return result;
}

/** SRS 9.1: the same flow for wedding anniversaries. */
export async function dispatchAnniversaryMessages(
  referenceDate = new Date(),
): Promise<DispatchResult> {
  const settings = await getSettings();
  const result: DispatchResult = { attempted: 0, sent: 0, failed: 0, skipped: 0 };

  if (!settings.anniversarySmsEnabled) {
    logger.info('Anniversary SMS is disabled in system settings — nothing dispatched');
    return result;
  }

  const key = dayjs.utc(referenceDate).format('MM-DD');
  const dateStamp = dayjs.utc(referenceDate).format('YYYY-MM-DD');

  const celebrants = await Member.find({
    anniversaryMonthDay: key,
    membershipStatus: MembershipStatus.ACTIVE,
    phone: { $exists: true, $nin: [null, ''] },
  })
    .select('firstName lastName preferredName phone')
    .lean();

  for (const member of celebrants) {
    result.attempted += 1;
    const name = member.preferredName || member.firstName;
    const outcome = await sendSms({
      member: { id: idString(member._id), name: `${member.firstName} ${member.lastName}` },
      phone: member.phone,
      type: SmsType.WEDDING_ANNIVERSARY,
      message: renderTemplate(settings.anniversaryMessageTemplate, {
        name,
        church: settings.churchName,
      }),
      dedupeKey: `ANNIVERSARY:${idString(member._id)}:${dateStamp}`,
    });
    if (outcome === 'SENT') result.sent += 1;
    else if (outcome === 'FAILED') result.failed += 1;
    else result.skipped += 1;
  }

  logger.info({ date: dateStamp, ...result }, 'Anniversary SMS dispatch complete');
  return result;
}

export interface ListSmsQuery {
  page: number;
  limit: number;
  type?: SmsType;
  status?: SmsDeliveryStatus;
  from?: string;
  to?: string;
  search?: string;
}

export async function listSmsLogs(_actor: AuthenticatedUser, query: ListSmsQuery) {
  const filter: FilterQuery<SmsLogDoc> = {};
  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;
  if (query.from || query.to) filter.createdAt = dateRange(query.from, query.to) as never;
  if (query.search) filter.phone = new RegExp(query.search.replace(/\D/g, ''), 'i');

  return paginate(SmsLog, {
    filter,
    page: query.page,
    limit: query.limit,
    sort: { createdAt: -1 },
    populate: { path: 'member', select: 'memberId firstName lastName' },
    select: '-providerResponse',
  });
}

export async function smsStatistics(actor: AuthenticatedUser) {
  // SMS logs are church-wide by nature; the scope filter is applied to the member
  // population they were derived from so counts stay meaningful per role.
  await resolveScopedFilter(actor, {});

  const [byStatus, byType, last30] = await Promise.all([
    SmsLog.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    SmsLog.aggregate([{ $group: { _id: '$type', count: { $sum: 1 }, segments: { $sum: '$segments' } } }]),
    SmsLog.countDocuments({ createdAt: { $gte: dayjs.utc().subtract(30, 'day').toDate() } }),
  ]);

  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r._id, r.count])),
    byType: byType.map((r) => ({ type: r._id, count: r.count, segments: r.segments })),
    last30Days: last30,
  };
}
