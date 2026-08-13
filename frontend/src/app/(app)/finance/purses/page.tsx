'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Banknote, Receipt, Send, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn, formatMinor, formatMoney, formatPercent } from '@/lib/utils';
import { financeService } from '@/services';
import { queryKeys, useApiQuery } from '@/hooks/use-api';
import type { AreaPurseRollup, Purse } from '@/types';
import {
  AreaRollupList,
  ZoneInflowBreakdown,
  ZoneRollupList,
  ZoneSummary,
} from './zone-view';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui/primitives';
import { PageHeader, StatCard } from '@/components/common/page';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/common/states';

/**
 * The purse hierarchy, one page with three levels.
 *
 * Which level opens depends on who is looking, because that is the level at which
 * their job is done:
 *   church-wide → every zone, drilling into one zone
 *   zonal       → their zone's purse and a row per area
 *   area        → the homecell purses beneath them (an area holds no purse itself)
 *   homecell    → their own purse
 *
 * `?zoneId=` / `?areaId=` drive the drill-down, so a level is linkable and the browser
 * back button steps back up the tree.
 */
export default function PursesPage() {
  const { can, user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  /**
   * A Homecell Coordinator sees one purse: their own. They belong to a zone, so
   * without this they would fall through to the zone rollup and see the zone total
   * and every sibling homecell's balance. The API refuses them too — this keeps the
   * UI from asking for something it will not get.
   */
  const homecellOnly = user?.scopeLevel === 'HOMECELL';

  const areaId = homecellOnly
    ? null
    : searchParams.get('areaId') ?? (user?.homecell ? null : user?.area) ?? null;
  const zoneId = homecellOnly
    ? null
    : searchParams.get('zoneId') ?? (areaId ? null : user?.zone) ?? null;

  // Church-wide roles land on the zone list; everyone else on their own level.
  const level: 'zones' | 'zone' | 'area' | 'homecell' = homecellOnly
    ? 'homecell'
    : areaId
      ? 'area'
      : zoneId
        ? 'zone'
        : 'zones';

  const ownPurse = useApiQuery(
    [...queryKeys.finance, 'purse', user?.homecell ?? 'none'],
    () => financeService.purse(user!.homecell!),
    { enabled: level === 'homecell' && Boolean(user?.homecell), refetchInterval: 120_000 },
  );

  const zones = useApiQuery(
    [...queryKeys.finance, 'purses', 'zones'],
    () => financeService.zonePurses(),
    { enabled: level === 'zones', refetchInterval: 120_000 },
  );

  const zone = useApiQuery(
    [...queryKeys.finance, 'purses', 'zone', zoneId ?? 'none'],
    () => financeService.zonePurse(zoneId!),
    { enabled: level === 'zone', refetchInterval: 120_000 },
  );

  const area = useApiQuery(
    [...queryKeys.finance, 'purses', 'area', areaId ?? 'none'],
    () => financeService.areaPurses(areaId!),
    { enabled: level === 'area', refetchInterval: 120_000 },
  );

  const active = level === 'zones' ? zones : level === 'zone' ? zone : area;

  if (level === 'homecell') {
    return (
      <>
        <PageHeader
          title="My homecell purse"
          description="Your balance is the sum of posted ledger transactions — it is never edited directly."
          breadcrumbs={[{ label: 'Finance' }, { label: 'Purse' }]}
        />

        {ownPurse.isLoading ? (
          <CardSkeleton count={1} />
        ) : ownPurse.isError ? (
          <ErrorState error={ownPurse.error} onRetry={() => void ownPurse.refetch()} />
        ) : ownPurse.data ? (
          <div className="max-w-md">
            <PurseCard purse={ownPurse.data} canRemit={can('remittances.create')} />
          </div>
        ) : (
          <EmptyState
            icon={Wallet}
            title="No purse yet"
            description="Your purse appears here as soon as your homecell records its first financial transaction."
          />
        )}
      </>
    );
  }

  if (level !== 'area') {
    return (
      <>
        <PageHeader
          title={level === 'zones' ? 'Purses by zone' : zone.data?.zone.zoneName ?? 'Zone purse'}
          description={
            level === 'zones'
              ? 'Only homecells hold a purse. A zone accumulates what its homecells remit.'
              : 'The zone purse is what has been remitted in. Areas hold nothing — open one to see its homecell purses.'
          }
          breadcrumbs={
            level === 'zones'
              ? [{ label: 'Finance' }, { label: 'Purses' }]
              : [
                  { label: 'Finance' },
                  { label: 'Purses', href: '/finance/purses' },
                  { label: zone.data?.zone.zoneName ?? 'Zone' },
                ]
          }
        />

        {active.isLoading ? (
          <CardSkeleton count={3} />
        ) : active.isError ? (
          <ErrorState error={active.error} onRetry={() => void active.refetch()} />
        ) : level === 'zones' ? (
          (zones.data ?? []).length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No zones yet"
              description="Purses appear here once zones, areas and homecells are in place."
            />
          ) : (
            <ZoneRollupList zones={zones.data!} />
          )
        ) : (
          <div className="space-y-6">
            <ZoneSummary zone={zone.data!.zone} />
            {zone.data!.zone.zonePurseMinor > 0 && (
              <ZoneInflowBreakdown zone={zone.data!.zone} />
            )}
            <div>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">
                Areas — open one to see its homecell purses
              </h2>
              <AreaRollupList areas={zone.data!.areas} />
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <AreaPurses
      areaId={areaId!}
      canRemit={can('remittances.create')}
      query={area}
      onBack={zoneId || user?.zone ? () => router.push('/finance/purses') : undefined}
    />
  );
}

/** The only level that shows real purses: every homecell beneath one area. */
function AreaPurses({
  canRemit,
  query,
  onBack,
}: {
  areaId: string;
  canRemit: boolean;
  query: ReturnType<typeof useApiQuery<{ area: AreaPurseRollup; purses: Purse[] }>>;
  onBack?: () => void;
}) {
  const { data, isLoading, isError, error, refetch } = query;
  const purses = data?.purses ?? [];
  const currency = purses[0]?.currency ?? 'NGN';

  const totals = purses.reduce(
    (acc, purse) => ({
      available: acc.available + purse.balance.availableMinor,
      pending: acc.pending + purse.balance.pendingMinor,
      aboveThreshold: acc.aboveThreshold + (purse.requiresRemittance ? 1 : 0),
    }),
    { available: 0, pending: 0, aboveThreshold: 0 },
  );

  return (
    <>
      <PageHeader
        title={data ? `${data.area.areaName} — homecell purses` : 'Homecell purses'}
        description="Every balance below is the sum of posted ledger transactions — it is never edited directly. The area itself holds no purse; the total is what its homecells hold."
        breadcrumbs={
          onBack
            ? [
                { label: 'Finance' },
                { label: 'Purses', href: '/finance/purses' },
                { label: data?.area.areaName ?? 'Area' },
              ]
            : [{ label: 'Finance' }, { label: 'Homecell purses' }]
        }
      />

      {isLoading ? (
        <CardSkeleton count={3} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Held by these homecells"
              value={formatMinor(totals.available, currency)}
              hint={`Across ${purses.length} homecell${purses.length === 1 ? '' : 's'}`}
              icon={Wallet}
            />
            <StatCard
              label="Pending"
              value={formatMinor(totals.pending, currency)}
              hint="Awaiting settlement or approval"
              icon={Receipt}
            />
            <StatCard
              label="Above threshold"
              value={String(totals.aboveThreshold)}
              hint={
                totals.aboveThreshold > 0
                  ? 'Remittance required'
                  : 'All purses within their limit'
              }
              icon={AlertTriangle}
              tone={totals.aboveThreshold > 0 ? 'warning' : 'success'}
            />
          </div>

          {purses.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="No homecell purses yet"
              description="A purse appears here as soon as a Homecell records its first financial transaction."
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {purses.map((purse) => (
                <PurseCard key={purse.homecellId} purse={purse} canRemit={canRemit} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function PurseCard({ purse, canRemit }: { purse: Purse; canRemit: boolean }) {
  const utilisation = Math.min(purse.utilisationPercent, 100);

  return (
    <Card className={cn(purse.requiresRemittance && 'border-warning/50')}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base">{purse.homecellName}</CardTitle>
            <p className="text-xs text-muted-foreground">{purse.homecellCode}</p>
          </div>
          {purse.requiresRemittance && (
            <Badge variant="warning">
              <AlertTriangle className="h-3 w-3" />
              Remit
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Available balance</p>
          <p
            className={cn(
              'text-2xl font-semibold tabular',
              purse.requiresRemittance && 'text-warning',
            )}
          >
            {formatMoney(purse.available, purse.currency)}
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Maximum {formatMoney(purse.threshold, purse.currency)}
              {purse.thresholdSource === 'HOMECELL_OVERRIDE' && ' (override)'}
            </span>
            <span className="tabular font-medium">{formatPercent(purse.utilisationPercent)}</span>
          </div>
          <div
            className="h-2 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={utilisation}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${purse.homecellName} purse utilisation`}
          >
            <div
              className={cn(
                'h-full rounded-full transition-all',
                purse.requiresRemittance ? 'bg-warning' : 'bg-primary',
              )}
              style={{ width: `${utilisation}%` }}
            />
          </div>
        </div>

        {purse.requiresRemittance && purse.suggestedRemittanceMinor > 0 && (
          <p className="rounded-md bg-warning/10 p-2.5 text-xs">
            Remit at least{' '}
            <span className="font-semibold">
              {formatMinor(purse.suggestedRemittanceMinor, purse.currency)}
            </span>{' '}
            to return below the threshold.
          </p>
        )}

        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild className="flex-1">
            <Link href={`/finance/ledger?homecellId=${purse.homecellId}`}>
              <Banknote className="h-4 w-4" />
              Ledger
            </Link>
          </Button>
          {canRemit && (
            <Button size="sm" asChild className="flex-1">
              <Link href={`/finance/remittances/new?homecellId=${purse.homecellId}`}>
                <Send className="h-4 w-4" />
                Remit
              </Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
