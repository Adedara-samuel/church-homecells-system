'use client';

import Link from 'next/link';
import { AlertTriangle, Building2, ChevronRight, Landmark, Wallet } from 'lucide-react';
import { formatMinor } from '@/lib/utils';
import type { AreaPurseRollup, ZonePurseRollup } from '@/types';
import { Badge, Card, CardContent } from '@/components/ui/primitives';
import { StatCard } from '@/components/common/page';
import { EmptyState } from '@/components/common/states';

/**
 * The zone's own position.
 *
 * Two very different numbers sit side by side here, and conflating them would be a
 * reporting error: the zone purse is money that has *arrived* at the zone, while the
 * homecell holdings are money still sitting in homecell purses that has not been
 * remitted yet.
 */
export function ZoneSummary({ zone }: { zone: ZonePurseRollup }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <StatCard
        label="Zone purse"
        value={formatMinor(zone.zonePurseMinor, zone.currency)}
        hint="Received from homecells — remittances and dues"
        icon={Landmark}
      />
      <StatCard
        label="Held in homecell purses"
        value={formatMinor(zone.homecellHoldingsMinor, zone.currency)}
        hint={`Across ${zone.homecellCount} homecell${zone.homecellCount === 1 ? '' : 's'} — not yet remitted`}
        icon={Wallet}
      />
      <StatCard
        label="Above threshold"
        value={String(zone.aboveThresholdCount)}
        hint="Homecells that must remit now"
        icon={AlertTriangle}
      />
    </div>
  );
}

/** Where the zone purse came from. */
export function ZoneInflowBreakdown({ zone }: { zone: ZonePurseRollup }) {
  const total = zone.zonePurseMinor || 1;
  const remittanceShare = Math.round((zone.remittanceInflowMinor / total) * 100);

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <div className="flex items-baseline justify-between">
          <h3 className="font-semibold">Where the zone purse came from</h3>
          <span className="text-sm text-muted-foreground">
            {formatMinor(zone.zonePurseMinor, zone.currency)} total
          </span>
        </div>

        <div className="flex h-2 overflow-hidden rounded-full bg-muted">
          <div className="bg-primary" style={{ width: `${remittanceShare}%` }} />
          <div className="bg-success" style={{ width: `${100 - remittanceShare}%` }} />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <InflowRow
            colour="bg-primary"
            label="Remittances"
            value={formatMinor(zone.remittanceInflowMinor, zone.currency)}
          />
          <InflowRow
            colour="bg-success"
            label="Dues & levies"
            value={formatMinor(zone.duesInflowMinor, zone.currency)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function InflowRow({ colour, label, value }: { colour: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={`h-2.5 w-2.5 rounded-full ${colour}`} aria-hidden />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-medium tabular-nums">{value}</span>
    </div>
  );
}

/**
 * One row per area. An area holds no money of its own, so the figure shown is the sum
 * of its homecells' purses — the individual purses are one click away.
 */
export function AreaRollupList({ areas }: { areas: AreaPurseRollup[] }) {
  if (areas.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="No areas in this zone"
        description="Create an area before homecells can be organised beneath it."
      />
    );
  }

  return (
    <div className="space-y-2">
      {areas.map((area) => (
        <Link
          key={area.areaId}
          href={`/finance/purses?areaId=${area.areaId}`}
          className="flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/40"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{area.areaName}</span>
              <Badge variant="muted">{area.areaCode}</Badge>
              {area.aboveThresholdCount > 0 && (
                <Badge variant="warning">
                  <AlertTriangle className="h-3 w-3" />
                  {area.aboveThresholdCount} to remit
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {area.homecellCount} homecell{area.homecellCount === 1 ? '' : 's'} · areas hold no
              purse of their own
            </p>
          </div>

          <div className="text-right">
            <p className="font-semibold tabular-nums">
              {formatMinor(area.homecellHoldingsMinor, area.currency)}
            </p>
            <p className="text-xs text-muted-foreground">held by its homecells</p>
          </div>

          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      ))}
    </div>
  );
}

/** One row per zone — the church-wide view, drilling into a zone's areas. */
export function ZoneRollupList({ zones }: { zones: ZonePurseRollup[] }) {
  return (
    <div className="space-y-2">
      {zones.map((zone) => (
        <Link
          key={zone.zoneId}
          href={`/finance/purses?zoneId=${zone.zoneId}`}
          className="flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/40"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{zone.zoneName}</span>
              <Badge variant="muted">{zone.zoneCode}</Badge>
              {zone.aboveThresholdCount > 0 && (
                <Badge variant="warning">{zone.aboveThresholdCount} to remit</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {zone.areaCount} area{zone.areaCount === 1 ? '' : 's'} · {zone.homecellCount} homecell
              {zone.homecellCount === 1 ? '' : 's'}
            </p>
          </div>

          <div className="hidden text-right sm:block">
            <p className="font-semibold tabular-nums">
              {formatMinor(zone.zonePurseMinor, zone.currency)}
            </p>
            <p className="text-xs text-muted-foreground">zone purse</p>
          </div>

          <div className="text-right">
            <p className="font-semibold tabular-nums text-muted-foreground">
              {formatMinor(zone.homecellHoldingsMinor, zone.currency)}
            </p>
            <p className="text-xs text-muted-foreground">in homecells</p>
          </div>

          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </Link>
      ))}
    </div>
  );
}
