import type { FilterQuery } from 'mongoose';
import { homecellScopeFilter, assertHomecellInScope, resolveScopedFilter } from '../../middleware/scope';
import {
  NotificationSeverity,
  NotificationType,
  OrgStatus,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { NotFoundError } from '../../utils/errors';
import { idString, toObjectId } from '../../utils/ids';
import { formatMoney, toMajor } from '../../utils/money';
import { Homecell, type HomecellDoc } from '../homecells/homecell.model';
import { notify, resolveEscalationRecipients } from '../notifications/notification.service';
import { getSettings } from '../settings/settings.service';
import { balancesByHomecell, homecellBalance, type BalanceSummary } from './ledger.service';
import type { LedgerTransactionDoc } from './ledger.model';

export interface PurseView {
  homecellId: string;
  homecellName: string;
  homecellCode: string;
  areaId: string;
  zoneId: string;
  currency: string;
  balance: BalanceSummary;
  /** Major units, for direct display. */
  available: number;
  pending: number;
  thresholdMinor: number;
  threshold: number;
  thresholdSource: 'HOMECELL_OVERRIDE' | 'SYSTEM_DEFAULT';
  /** SRS 8.2: the notification fires at or above the threshold. */
  requiresRemittance: boolean;
  utilisationPercent: number;
  /** The amount that must be remitted to fall back under the threshold. */
  suggestedRemittanceMinor: number;
}

/** Resolves the effective threshold: a Homecell override wins over the system default. */
export async function effectiveThreshold(
  homecell: Pick<HomecellDoc, 'maxPurseThresholdOverride'>,
): Promise<{ thresholdMinor: number; source: PurseView['thresholdSource'] }> {
  const settings = await getSettings();
  if (
    homecell.maxPurseThresholdOverride !== null &&
    homecell.maxPurseThresholdOverride !== undefined
  ) {
    return { thresholdMinor: homecell.maxPurseThresholdOverride, source: 'HOMECELL_OVERRIDE' };
  }
  return { thresholdMinor: settings.maxPurseThresholdMinor, source: 'SYSTEM_DEFAULT' };
}

export async function getPurse(actor: AuthenticatedUser, homecellId: string): Promise<PurseView> {
  await assertHomecellInScope(actor, homecellId);
  const homecell = await Homecell.findById(homecellId)
    .select('name code area zone maxPurseThresholdOverride')
    .lean();
  if (!homecell) throw new NotFoundError('Homecell');

  const settings = await getSettings();
  const balance = await homecellBalance(homecell._id, settings.currency);
  const { thresholdMinor, source } = await effectiveThreshold(homecell);

  return buildPurseView(homecell, balance, thresholdMinor, source, settings.currency);
}

function buildPurseView(
  homecell: Pick<HomecellDoc, '_id' | 'name' | 'code' | 'area' | 'zone'>,
  balance: BalanceSummary,
  thresholdMinor: number,
  thresholdSource: PurseView['thresholdSource'],
  currency: string,
): PurseView {
  const requiresRemittance = thresholdMinor > 0 && balance.availableMinor >= thresholdMinor;
  return {
    homecellId: idString(homecell._id),
    homecellName: homecell.name,
    homecellCode: homecell.code,
    areaId: idString(homecell.area),
    zoneId: idString(homecell.zone),
    currency,
    balance,
    available: toMajor(balance.availableMinor),
    pending: toMajor(balance.pendingMinor),
    thresholdMinor,
    threshold: toMajor(thresholdMinor),
    thresholdSource,
    requiresRemittance,
    utilisationPercent:
      thresholdMinor > 0
        ? Math.round((balance.availableMinor / thresholdMinor) * 1000) / 10
        : 0,
    suggestedRemittanceMinor: requiresRemittance
      ? Math.max(balance.availableMinor - thresholdMinor, 0)
      : 0,
  };
}

export interface PurseListQuery {
  zoneId?: string;
  areaId?: string;
  homecellId?: string;
  aboveThresholdOnly?: boolean;
}

/**
 * Purse position for every Homecell in scope.
 *
 * Balances come from one grouped aggregation rather than a query per Homecell, so a
 * church with hundreds of cells still renders the finance overview in a single pass.
 */
export async function listPurses(
  actor: AuthenticatedUser,
  query: PurseListQuery,
): Promise<PurseView[]> {
  const settings = await getSettings();

  const homecellFilter: FilterQuery<HomecellDoc> = {
    ...homecellScopeFilter(actor),
    status: OrgStatus.ACTIVE,
  };
  if (query.homecellId) {
    await assertHomecellInScope(actor, query.homecellId);
    homecellFilter._id = toObjectId(query.homecellId);
  } else if (query.areaId) {
    homecellFilter.area = toObjectId(query.areaId);
  } else if (query.zoneId) {
    homecellFilter.zone = toObjectId(query.zoneId);
  }

  const homecells = await Homecell.find(homecellFilter)
    .select('name code area zone maxPurseThresholdOverride')
    .sort({ name: 1 })
    .lean();
  if (homecells.length === 0) return [];

  const ledgerFilter = await resolveScopedFilter<LedgerTransactionDoc>(actor, query);
  const balances = await balancesByHomecell({
    ...ledgerFilter,
    homecell: { $in: homecells.map((h) => h._id) },
  });

  const views = await Promise.all(
    homecells.map(async (homecell) => {
      const availableMinor = balances.get(idString(homecell._id)) ?? 0;
      const { thresholdMinor, source } = await effectiveThreshold(homecell);
      // The grouped aggregation gives the net available figure; the detailed
      // breakdown is only fetched when a single purse is opened.
      const balance: BalanceSummary = {
        currency: settings.currency,
        availableMinor,
        pendingMinor: 0,
        openingBalanceMinor: 0,
        totalIncomingMinor: 0,
        totalOfferingsMinor: 0,
        totalOtherIncomeMinor: 0,
        totalExpensesMinor: 0,
        totalRemittedMinor: 0,
        totalAdjustmentsMinor: 0,
        transactionCount: 0,
      };
      return buildPurseView(homecell, balance, thresholdMinor, source, settings.currency);
    }),
  );

  return query.aboveThresholdOnly ? views.filter((v) => v.requiresRemittance) : views;
}

/**
 * SRS 8.3 / BR-014.
 *
 * Called after every posting that can raise a balance, and hourly by the scheduled
 * sweep. The notification carries a `dedupeKey`, so a purse that stays above its
 * threshold produces one unread prompt rather than one per offering.
 */
export async function checkThresholdAndNotify(homecellId: string): Promise<boolean> {
  const homecell = await Homecell.findById(homecellId)
    .select('name code area zone maxPurseThresholdOverride status')
    .lean();
  if (!homecell || homecell.status !== OrgStatus.ACTIVE) return false;

  const settings = await getSettings();
  const balance = await homecellBalance(homecell._id, settings.currency);
  const { thresholdMinor } = await effectiveThreshold(homecell);

  if (thresholdMinor <= 0 || balance.availableMinor < thresholdMinor) return false;

  const recipients = await resolveEscalationRecipients({
    homecellId: homecell._id,
    areaId: homecell.area,
    zoneId: homecell.zone,
    includeHomecell: true,
    includeArea: true,
    includeZone: true,
  });

  await notify({
    recipients,
    type: NotificationType.PURSE_THRESHOLD_REACHED,
    severity: NotificationSeverity.WARNING,
    title: 'Homecell purse has reached its maximum threshold',
    message:
      `${homecell.name} purse balance is ${formatMoney(balance.availableMinor, settings.currency)}, ` +
      `at or above the configured maximum of ${formatMoney(thresholdMinor, settings.currency)}. ` +
      'Please remit the required amount to the General Homecell Purse.',
    entityModel: 'Homecell',
    entityId: homecell._id,
    actionUrl: `/finance/remittances/new?homecellId=${idString(homecell._id)}`,
    homecell: homecell._id,
    area: homecell.area,
    zone: homecell.zone,
    // One live prompt per threshold breach episode.
    dedupeKey: `purse-threshold:${idString(homecell._id)}`,
  });

  return true;
}

/** Ledger view for one Homecell — the drill-down behind a summary figure. */
export async function purseStatement(
  actor: AuthenticatedUser,
  homecellId: string,
  query: { from?: string; to?: string },
) {
  const purse = await getPurse(actor, homecellId);
  return { purse, filters: query };
}
