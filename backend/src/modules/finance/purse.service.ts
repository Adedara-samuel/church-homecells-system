import type { FilterQuery, Types } from 'mongoose';
import {
  homecellScopeFilter,
  assertAreaInScope,
  assertHomecellInScope,
  assertZoneInScope,
  resolveScopedFilter,
  zoneScopeFilter,
} from '../../middleware/scope';
import {
  DuesInvoiceStatus,
  NotificationSeverity,
  NotificationType,
  OrgStatus,
  RemittanceStatus,
  TransactionStatus,
  TransactionType,
} from '../../types/enums';
import type { AuthenticatedUser } from '../../types/express';
import { InsufficientBalanceError, NotFoundError } from '../../utils/errors';
import { idString, toObjectId } from '../../utils/ids';
import { formatMoney, toMajor } from '../../utils/money';
import { Area } from '../areas/area.model';
import { DuesInvoice } from '../dues/dues.model';
import { Homecell, type HomecellDoc } from '../homecells/homecell.model';
import { Remittance, type RemittanceDoc } from '../remittances/remittance.model';
import { notify, resolveEscalationRecipients } from '../notifications/notification.service';
import { getSettings } from '../settings/settings.service';
import { Zone } from '../zones/zone.model';
import { balancesByHomecell, homecellBalance, type BalanceSummary } from './ledger.service';
import { LedgerTransaction, type LedgerTransactionDoc } from './ledger.model';

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

/**
 * Money already promised to somewhere else but not yet posted.
 *
 * A remittance awaiting approval, or with a checkout open at the provider, has not
 * touched the ledger yet — the balance still shows the money as available. Without
 * counting it, two ₦314,000 remittances can each pass the balance check against a
 * ₦400,000 purse and both settle, leaving it overdrawn. The same applies to dues
 * invoices with a checkout open against them.
 */
export async function committedOutflowMinor(
  homecellId: string | Types.ObjectId,
  excludeRemittanceId?: string | Types.ObjectId | null,
): Promise<number> {
  const homecell = toObjectId(homecellId);

  const remittanceFilter: FilterQuery<RemittanceDoc> = {
    homecell,
    // Anything not yet posted to the ledger but still expected to be.
    status: {
      $in: [
        RemittanceStatus.PENDING_APPROVAL,
        RemittanceStatus.APPROVED,
        RemittanceStatus.PROCESSING,
      ],
    },
    ledgerTransaction: null,
  };
  if (excludeRemittanceId) remittanceFilter._id = { $ne: toObjectId(excludeRemittanceId) };

  const [remittances, dues] = await Promise.all([
    Remittance.aggregate<{ total: number }>([
      { $match: remittanceFilter },
      { $group: { _id: null, total: { $sum: '$amountMinor' } } },
    ]),
    DuesInvoice.aggregate<{ total: number }>([
      { $match: { homecell, status: DuesInvoiceStatus.PROCESSING } },
      { $group: { _id: null, total: { $sum: '$amountMinor' } } },
    ]),
  ]);

  return (remittances[0]?.total ?? 0) + (dues[0]?.total ?? 0);
}

/**
 * What the Homecell can actually commit right now: the posted balance less everything
 * already promised. This — not the raw balance — is what every outgoing payment is
 * checked against.
 */
export async function spendableMinor(
  homecellId: string | Types.ObjectId,
  excludeRemittanceId?: string | Types.ObjectId | null,
): Promise<{ availableMinor: number; committedMinor: number; spendableMinor: number }> {
  const settings = await getSettings();
  const [balance, committed] = await Promise.all([
    homecellBalance(toObjectId(homecellId), settings.currency),
    committedOutflowMinor(homecellId, excludeRemittanceId),
  ]);

  return {
    availableMinor: balance.availableMinor,
    committedMinor: committed,
    spendableMinor: balance.availableMinor - committed,
  };
}

/** Refuses an outgoing commitment the purse cannot cover once promises are counted. */
export async function assertSpendable(
  homecellId: string | Types.ObjectId,
  amountMinor: number,
  excludeRemittanceId?: string | Types.ObjectId | null,
): Promise<void> {
  const settings = await getSettings();
  const { spendableMinor: spendable, committedMinor } = await spendableMinor(
    homecellId,
    excludeRemittanceId,
  );

  if (spendable < amountMinor) {
    throw new InsufficientBalanceError(Math.max(spendable, 0), amountMinor, settings.currency, {
      committedMinor,
    });
  }
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

// ---------------------------------------------------------------------------
// The purse hierarchy
// ---------------------------------------------------------------------------

/**
 * Who holds money, and who only looks at it.
 *
 *   Homecell — the only unit that holds a purse. Every balance is the sum of its
 *              posted ledger entries.
 *   Area     — holds nothing. An Area Coordinator sees the purses of the Homecells
 *              beneath them, and a total, but there is no "area purse" to spend.
 *   Zone     — holds the money its Homecells have remitted. A Zonal Coordinator sees
 *              one row per Area (the sum of that Area's Homecell purses) and drills
 *              into an Area to see the individual Homecells.
 */

export interface AreaPurseRollup {
  areaId: string;
  areaName: string;
  areaCode: string;
  zoneId: string;
  currency: string;
  /** Sum of the purses of the Homecells in this Area. The Area holds none of it. */
  homecellHoldingsMinor: number;
  homecellCount: number;
  aboveThresholdCount: number;
}

export interface ZonePurseRollup {
  zoneId: string;
  zoneName: string;
  zoneCode: string;
  currency: string;
  /**
   * The Zone's own purse: everything its Homecells have remitted, including monthly
   * dues and levies. Reversed postings drop out because a reversal moves the original
   * entry out of POSTED.
   */
  zonePurseMinor: number;
  remittanceInflowMinor: number;
  duesInflowMinor: number;
  /** Money still sitting in Homecell purses beneath this Zone — not yet the Zone's. */
  homecellHoldingsMinor: number;
  areaCount: number;
  homecellCount: number;
  aboveThresholdCount: number;
}

/**
 * What has actually reached a Zone, split by what it came from.
 *
 * Only POSTED entries count: `reverseTransaction` moves a reversed entry to REVERSED,
 * so a reversed remittance leaves the Zone's total without any extra arithmetic.
 */
async function zoneInflows(
  zoneIds: Types.ObjectId[],
): Promise<Map<string, { total: number; remittances: number; dues: number }>> {
  const rows = await LedgerTransaction.aggregate<{
    _id: { zone: Types.ObjectId; sourceModel: string | null };
    total: number;
  }>([
    {
      $match: {
        zone: { $in: zoneIds },
        type: TransactionType.REMITTANCE,
        status: TransactionStatus.POSTED,
      },
    },
    { $group: { _id: { zone: '$zone', sourceModel: '$sourceModel' }, total: { $sum: '$amountMinor' } } },
  ]);

  const map = new Map<string, { total: number; remittances: number; dues: number }>();
  for (const row of rows) {
    const key = idString(row._id.zone);
    const entry = map.get(key) ?? { total: 0, remittances: 0, dues: 0 };
    entry.total += row.total;
    if (row._id.sourceModel === 'DuesInvoice') entry.dues += row.total;
    else entry.remittances += row.total;
    map.set(key, entry);
  }
  return map;
}

/** Homecell balances grouped up to whichever level the caller asked for. */
async function homecellRollup(homecells: HomecellDoc[]) {
  const balances = await balancesByHomecell({
    homecell: { $in: homecells.map((h) => h._id) },
  });

  const thresholds = new Map<string, number>();
  for (const homecell of homecells) {
    const { thresholdMinor } = await effectiveThreshold(homecell);
    thresholds.set(idString(homecell._id), thresholdMinor);
  }

  return { balances, thresholds };
}

/** One row per Zone the caller can see — the church-wide and multi-zone view. */
export async function listZonePurses(actor: AuthenticatedUser): Promise<ZonePurseRollup[]> {
  const settings = await getSettings();

  const zones = await Zone.find({ ...zoneScopeFilter(actor), status: OrgStatus.ACTIVE })
    .select('name code')
    .sort({ name: 1 })
    .lean();
  if (zones.length === 0) return [];

  const zoneIds = zones.map((zone) => zone._id);
  const [homecells, areaCounts, inflows] = await Promise.all([
    Homecell.find({ zone: { $in: zoneIds }, status: OrgStatus.ACTIVE })
      .select('name code area zone maxPurseThresholdOverride')
      .lean(),
    Area.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { zone: { $in: zoneIds }, status: OrgStatus.ACTIVE } },
      { $group: { _id: '$zone', count: { $sum: 1 } } },
    ]),
    zoneInflows(zoneIds),
  ]);

  const { balances, thresholds } = await homecellRollup(homecells as HomecellDoc[]);
  const areaCountByZone = new Map(areaCounts.map((row) => [idString(row._id), row.count]));

  return zones.map((zone) => {
    const own = homecells.filter((homecell) => idString(homecell.zone) === idString(zone._id));
    const inflow = inflows.get(idString(zone._id)) ?? { total: 0, remittances: 0, dues: 0 };

    let holdings = 0;
    let aboveThreshold = 0;
    for (const homecell of own) {
      const key = idString(homecell._id);
      const balance = balances.get(key) ?? 0;
      const threshold = thresholds.get(key) ?? 0;
      holdings += balance;
      if (threshold > 0 && balance >= threshold) aboveThreshold += 1;
    }

    return {
      zoneId: idString(zone._id),
      zoneName: zone.name,
      zoneCode: zone.code,
      currency: settings.currency,
      zonePurseMinor: inflow.total,
      remittanceInflowMinor: inflow.remittances,
      duesInflowMinor: inflow.dues,
      homecellHoldingsMinor: holdings,
      areaCount: areaCountByZone.get(idString(zone._id)) ?? 0,
      homecellCount: own.length,
      aboveThresholdCount: aboveThreshold,
    };
  });
}

/**
 * One Zone: its own purse, plus a row per Area showing what the Homecells in that
 * Area are still holding. This is the Zonal Coordinator's landing view — Areas first,
 * Homecells only after choosing one.
 */
export async function getZonePurse(
  actor: AuthenticatedUser,
  zoneId: string,
): Promise<{ zone: ZonePurseRollup; areas: AreaPurseRollup[] }> {
  assertZoneInScope(actor, zoneId);

  const settings = await getSettings();
  const zone = await Zone.findById(zoneId).select('name code').lean();
  if (!zone) throw new NotFoundError('Zone');

  const [areas, homecells, inflows] = await Promise.all([
    Area.find({ zone: zone._id, status: OrgStatus.ACTIVE }).select('name code zone').sort({ name: 1 }).lean(),
    Homecell.find({ zone: zone._id, status: OrgStatus.ACTIVE })
      .select('name code area zone maxPurseThresholdOverride')
      .lean(),
    zoneInflows([zone._id]),
  ]);

  const { balances, thresholds } = await homecellRollup(homecells as HomecellDoc[]);
  const inflow = inflows.get(idString(zone._id)) ?? { total: 0, remittances: 0, dues: 0 };

  const areaRows: AreaPurseRollup[] = areas.map((area) => {
    const own = homecells.filter((homecell) => idString(homecell.area) === idString(area._id));
    let holdings = 0;
    let aboveThreshold = 0;
    for (const homecell of own) {
      const key = idString(homecell._id);
      const balance = balances.get(key) ?? 0;
      const threshold = thresholds.get(key) ?? 0;
      holdings += balance;
      if (threshold > 0 && balance >= threshold) aboveThreshold += 1;
    }
    return {
      areaId: idString(area._id),
      areaName: area.name,
      areaCode: area.code,
      zoneId: idString(zone._id),
      currency: settings.currency,
      homecellHoldingsMinor: holdings,
      homecellCount: own.length,
      aboveThresholdCount: aboveThreshold,
    };
  });

  return {
    zone: {
      zoneId: idString(zone._id),
      zoneName: zone.name,
      zoneCode: zone.code,
      currency: settings.currency,
      zonePurseMinor: inflow.total,
      remittanceInflowMinor: inflow.remittances,
      duesInflowMinor: inflow.dues,
      homecellHoldingsMinor: areaRows.reduce((sum, area) => sum + area.homecellHoldingsMinor, 0),
      areaCount: areaRows.length,
      homecellCount: homecells.length,
      aboveThresholdCount: areaRows.reduce((sum, area) => sum + area.aboveThresholdCount, 0),
    },
    areas: areaRows,
  };
}

/**
 * One Area: every Homecell purse beneath it.
 *
 * The Area itself holds nothing — the total returned is the sum of what its Homecells
 * hold, offered for display only. There is no balance here to spend or remit.
 */
export async function getAreaPurses(
  actor: AuthenticatedUser,
  areaId: string,
): Promise<{ area: AreaPurseRollup; purses: PurseView[] }> {
  await assertAreaInScope(actor, areaId);

  const area = await Area.findById(areaId).select('name code zone').lean();
  if (!area) throw new NotFoundError('Area');

  const purses = await listPurses(actor, { areaId });

  return {
    area: {
      areaId: idString(area._id),
      areaName: area.name,
      areaCode: area.code,
      zoneId: idString(area.zone),
      currency: purses[0]?.currency ?? (await getSettings()).currency,
      homecellHoldingsMinor: purses.reduce((sum, purse) => sum + purse.balance.availableMinor, 0),
      homecellCount: purses.length,
      aboveThresholdCount: purses.filter((purse) => purse.requiresRemittance).length,
    },
    purses,
  };
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
