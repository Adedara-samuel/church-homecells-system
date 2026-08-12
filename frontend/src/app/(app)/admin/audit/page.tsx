'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowLeftRight,
  Banknote,
  Building2,
  CalendarCheck,
  CreditCard,
  Download,
  FileText,
  Fingerprint,
  Globe,
  KeyRound,
  LogIn,
  LogOut,
  Monitor,
  Pencil,
  Plus,
  ScrollText,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Undo2,
  Upload,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn, formatDate, formatNumber, formatRelative, humanise } from '@/lib/utils';
import { auditService } from '@/services';
import { queryKeys, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { AuditEntry } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, Skeleton } from '@/components/ui/primitives';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/overlays';
import { PageHeader, StatCard } from '@/components/common/page';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { DateFilter, FilterBar, FilterSelect, OrgFilters } from '@/components/common/filters';
import { CopyableReference, Info, InfoGrid, ValueDiff } from '@/components/common/detail';

const MODULES = [
  'AUTH', 'USERS', 'ZONES', 'AREAS', 'HOMECELLS', 'MEMBERS', 'TRANSFERS', 'ATTENDANCE',
  'FINANCE', 'PAYMENTS', 'REMITTANCES', 'NOTIFICATIONS', 'SMS', 'REPORTS', 'SETTINGS', 'UPLOADS',
];

const ACTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'APPROVE', 'REJECT',
  'REVERSE', 'TRANSFER', 'UPLOAD', 'EXPORT', 'PAYMENT_INIT', 'PAYMENT_WEBHOOK', 'RECONCILE',
  'PERMISSION_CHANGE', 'PASSWORD_CHANGE', 'PASSWORD_RESET', 'SMS_DISPATCH',
];

/** Icon + tone per action, so the feed is scannable at a glance. */
const ACTION_STYLE: Record<
  string,
  { icon: typeof Plus; tone: 'neutral' | 'success' | 'warning' | 'destructive' | 'info' }
> = {
  CREATE: { icon: Plus, tone: 'success' },
  UPDATE: { icon: Pencil, tone: 'info' },
  DELETE: { icon: Trash2, tone: 'destructive' },
  LOGIN: { icon: LogIn, tone: 'neutral' },
  LOGIN_FAILED: { icon: ShieldAlert, tone: 'destructive' },
  LOGOUT: { icon: LogOut, tone: 'neutral' },
  APPROVE: { icon: ShieldCheck, tone: 'success' },
  REJECT: { icon: X, tone: 'destructive' },
  REVERSE: { icon: Undo2, tone: 'warning' },
  TRANSFER: { icon: ArrowLeftRight, tone: 'info' },
  UPLOAD: { icon: Upload, tone: 'neutral' },
  EXPORT: { icon: Download, tone: 'neutral' },
  PAYMENT_INIT: { icon: CreditCard, tone: 'info' },
  PAYMENT_WEBHOOK: { icon: Activity, tone: 'info' },
  RECONCILE: { icon: Activity, tone: 'warning' },
  PERMISSION_CHANGE: { icon: KeyRound, tone: 'warning' },
  PASSWORD_CHANGE: { icon: KeyRound, tone: 'warning' },
  PASSWORD_RESET: { icon: KeyRound, tone: 'warning' },
  SMS_DISPATCH: { icon: Activity, tone: 'neutral' },
};

const MODULE_ICON: Record<string, typeof Users> = {
  AUTH: KeyRound,
  USERS: UserCog,
  ZONES: Globe,
  AREAS: Building2,
  HOMECELLS: Users,
  MEMBERS: Users,
  TRANSFERS: ArrowLeftRight,
  ATTENDANCE: CalendarCheck,
  FINANCE: Banknote,
  PAYMENTS: CreditCard,
  REMITTANCES: FileText,
  SMS: Activity,
  REPORTS: Download,
  SETTINGS: Settings,
  UPLOADS: Upload,
};

const TONE_CLASS = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-primary/10 text-primary',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  destructive: 'bg-destructive/12 text-destructive',
};

/** Deep-links an audit entry to the record it describes. */
const ENTITY_ROUTES: Record<string, string> = {
  User: '/admin/users',
  Zone: '/structure/zones',
  Area: '/structure/areas',
  Homecell: '/structure/homecells',
  Member: '/members',
  MemberTransfer: '/transfers',
  Offering: '/finance/offerings',
  Expense: '/finance/expenses',
  Remittance: '/finance/remittances',
  Payment: '/finance/payments',
  LedgerTransaction: '/finance/ledger',
  ReconciliationRun: '/finance/reconciliation',
};

interface AuditStatistics {
  byModule: { module: string; count: number }[];
  byAction: { action: string; count: number }[];
  recentFailures: number;
}

export default function AuditPage() {
  const { can } = useAuth();
  const list = useListQuery();
  const [selected, setSelected] = React.useState<AuditEntry | null>(null);

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.audit, list.query],
    () => auditService.list(list.query),
    { placeholderData: (previous) => previous },
  );

  const stats = useApiQuery(
    [...queryKeys.audit, 'statistics'],
    () => auditService.statistics() as Promise<AuditStatistics>,
  );

  // Stable reference so the grouping below only recomputes when the data changes.
  const entries = React.useMemo(() => data?.items ?? [], [data?.items]);

  // Group by calendar day so the feed reads as a chronological narrative.
  const grouped = React.useMemo(() => {
    const map = new Map<string, AuditEntry[]>();
    for (const entry of entries) {
      const key = new Date(entry.createdAt).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(entry);
    }
    return [...map.entries()];
  }, [entries]);

  const topModule = stats.data?.byModule?.[0];
  const topAction = stats.data?.byAction?.[0];

  return (
    <>
      <PageHeader
        title="Audit log"
        description="An append-only record of every significant action. Entries cannot be edited or deleted by anyone, including a System Administrator."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Audit log' }]}
      />

      {stats.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : stats.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Entries in view"
            value={formatNumber(data?.pagination?.total ?? 0)}
            hint="Matching your current filters"
            icon={ScrollText}
          />
          <StatCard
            label="Busiest module"
            value={topModule ? humanise(topModule.module) : '—'}
            hint={topModule ? `${formatNumber(topModule.count)} recorded actions` : undefined}
            icon={Activity}
          />
          <StatCard
            label="Most common action"
            value={topAction ? humanise(topAction.action) : '—'}
            hint={topAction ? `${formatNumber(topAction.count)} occurrences` : undefined}
            icon={Pencil}
          />
          <StatCard
            label="Failed actions"
            value={formatNumber(stats.data.recentFailures)}
            hint="Rejected or unsuccessful attempts"
            icon={ShieldAlert}
            tone={stats.data.recentFailures > 0 ? 'destructive' : 'success'}
          />
        </div>
      ) : null}

      {/* Activity distribution — where the work is happening. */}
      {stats.data && stats.data.byModule.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <p className="mb-3 text-sm font-medium">Activity by module</p>
            <div className="space-y-2">
              {stats.data.byModule.slice(0, 8).map((row) => {
                const max = stats.data!.byModule[0].count || 1;
                const Icon = MODULE_ICON[row.module] ?? Activity;
                return (
                  <button
                    key={row.module}
                    onClick={() => list.setFilter('module', row.module)}
                    className="flex w-full items-center gap-3 rounded-md p-1.5 text-left transition-colors hover:bg-accent"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="w-28 shrink-0 truncate text-sm">{humanise(row.module)}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${(row.count / max) * 100}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-sm tabular text-muted-foreground">
                      {formatNumber(row.count)}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <FilterBar
        search={list.search}
        onSearchChange={list.setSearch}
        searchPlaceholder="Search by description, user or record reference…"
        activeFilterCount={list.activeFilterCount}
        onReset={list.resetFilters}
      >
        <div className="space-y-4">
          <OrgFilters
            zoneId={list.filters.zoneId as string | undefined}
            areaId={list.filters.areaId as string | undefined}
            homecellId={list.filters.homecellId as string | undefined}
            onChange={(key, value) => list.setFilter(key, value)}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <FilterSelect
              label="Module"
              placeholder="All modules"
              value={list.filters.module as string | undefined}
              onChange={(value) => list.setFilter('module', value)}
              options={MODULES.map((m) => ({ value: m, label: humanise(m) }))}
            />
            <FilterSelect
              label="Action"
              placeholder="All actions"
              value={list.filters.action as string | undefined}
              onChange={(value) => list.setFilter('action', value)}
              options={ACTIONS.map((a) => ({ value: a, label: humanise(a) }))}
            />
            <DateFilter
              label="From"
              value={list.filters.from as string | undefined}
              onChange={(value) => list.setFilter('from', value)}
            />
            <DateFilter
              label="To"
              value={list.filters.to as string | undefined}
              onChange={(value) => list.setFilter('to', value)}
            />
          </div>
        </div>
      </FilterBar>

      {isLoading ? (
        <TableSkeleton rows={10} columns={3} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No audit entries match"
          description="Adjust the filters or widen the date range to see more activity."
          action={
            list.activeFilterCount > 0 || list.search ? (
              <Button variant="outline" onClick={list.resetFilters}>
                Clear filters
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-6">
          {grouped.map(([day, dayEntries]) => (
            <section key={day}>
              <div className="sticky top-16 z-10 -mx-1 mb-2 bg-background/95 px-1 py-1.5 backdrop-blur">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {formatDayHeading(day)}
                  <span className="ml-2 font-normal normal-case">
                    {dayEntries.length} {dayEntries.length === 1 ? 'entry' : 'entries'}
                  </span>
                </h2>
              </div>

              <ol className="space-y-2">
                {dayEntries.map((entry) => (
                  <AuditRow key={entry._id} entry={entry} onOpen={() => setSelected(entry)} />
                ))}
              </ol>
            </section>
          ))}

          {/* Pagination */}
          {data?.pagination && data.pagination.totalPages > 1 && (
            <div className="flex flex-col items-center justify-between gap-3 border-t pt-4 sm:flex-row">
              <p className="text-sm text-muted-foreground">
                Showing{' '}
                <span className="font-medium text-foreground">
                  {(data.pagination.page - 1) * data.pagination.limit + 1}–
                  {Math.min(data.pagination.page * data.pagination.limit, data.pagination.total)}
                </span>{' '}
                of{' '}
                <span className="font-medium text-foreground">
                  {formatNumber(data.pagination.total)}
                </span>
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!data.pagination.hasPreviousPage}
                  onClick={() => list.setPage(data.pagination!.page - 1)}
                >
                  Previous
                </Button>
                <span className="px-2 text-sm text-muted-foreground">
                  {data.pagination.page} / {data.pagination.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!data.pagination.hasNextPage}
                  onClick={() => list.setPage(data.pagination!.page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <AuditDetailDialog entry={selected} onClose={() => setSelected(null)} canViewUsers={can('users.view')} />
    </>
  );
}

function AuditRow({ entry, onOpen }: { entry: AuditEntry; onOpen: () => void }) {
  const style = ACTION_STYLE[entry.action] ?? { icon: Activity, tone: 'neutral' as const };
  const Icon = style.icon;
  const hasChanges = Boolean(entry.previousValues || entry.newValues);

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-4"
      >
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
            TONE_CLASS[style.tone],
          )}
        >
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <p className="font-medium leading-snug">{entry.description}</p>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelative(entry.createdAt)}
                </span>
              </TooltipTrigger>
              <TooltipContent>{formatDate(entry.createdAt, true)}</TooltipContent>
            </Tooltip>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary" className="text-[11px]">
              {humanise(entry.module)}
            </Badge>
            <Badge variant="outline" className="text-[11px]">
              {humanise(entry.action)}
            </Badge>
            {!entry.success && (
              <Badge variant="destructive" className="text-[11px]">
                Failed
              </Badge>
            )}
            {hasChanges && (
              <Badge variant="muted" className="text-[11px]">
                {Object.keys(entry.newValues ?? entry.previousValues ?? {}).length} field
                {Object.keys(entry.newValues ?? entry.previousValues ?? {}).length === 1 ? '' : 's'}{' '}
                changed
              </Badge>
            )}
            <span className="truncate">
              {entry.userName ?? 'System'}
              {entry.userRole ? ` · ${humanise(entry.userRole)}` : ''}
            </span>
          </div>
        </div>
      </button>
    </li>
  );
}

function AuditDetailDialog({
  entry,
  onClose,
  canViewUsers,
}: {
  entry: AuditEntry | null;
  onClose: () => void;
  canViewUsers: boolean;
}) {
  if (!entry) return null;

  const style = ACTION_STYLE[entry.action] ?? { icon: Activity, tone: 'neutral' as const };
  const Icon = style.icon;
  const route = entry.entityModel ? ENTITY_ROUTES[entry.entityModel] : undefined;

  return (
    <Dialog open={Boolean(entry)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                TONE_CLASS[style.tone],
              )}
            >
              <Icon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="leading-snug">{entry.description}</DialogTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(entry.createdAt, true)} · {formatRelative(entry.createdAt)}
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-6">
          <div className="flex flex-wrap gap-1.5">
            <Badge variant="secondary">{humanise(entry.module)}</Badge>
            <Badge variant="outline">{humanise(entry.action)}</Badge>
            <Badge variant={entry.success ? 'success' : 'destructive'}>
              {entry.success ? 'Succeeded' : 'Failed'}
            </Badge>
          </div>

          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Who
            </h3>
            <InfoGrid>
              <Info label="User">
                {entry.user?._id && canViewUsers ? (
                  <Link
                    href={`/admin/users/${entry.user._id}`}
                    className="text-primary hover:underline"
                    onClick={onClose}
                  >
                    {entry.userName ?? `${entry.user.firstName} ${entry.user.lastName}`}
                  </Link>
                ) : (
                  (entry.userName ?? 'System')
                )}
              </Info>
              <Info label="Role">{entry.userRole ? humanise(entry.userRole) : null}</Info>
              <Info label="IP address" mono>
                {entry.ipAddress ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5" />
                    {entry.ipAddress}
                  </span>
                ) : null}
              </Info>
              <Info label="Device">
                {entry.userAgent ? (
                  <span className="inline-flex items-start gap-1.5">
                    <Monitor className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="break-all text-xs">{summariseUserAgent(entry.userAgent)}</span>
                  </span>
                ) : null}
              </Info>
            </InfoGrid>
          </section>

          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              What
            </h3>
            <InfoGrid>
              <Info label="Record type">
                {entry.entityModel ? humanise(entry.entityModel) : null}
              </Info>
              <Info label="Record label">{entry.entityLabel}</Info>
              <Info label="Record id" mono full>
                {entry.entityId ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <CopyableReference value={entry.entityId} />
                    {route && (
                      <Link
                        href={`${route}/${entry.entityId}`}
                        className="text-xs text-primary hover:underline"
                        onClick={onClose}
                      >
                        Open record
                      </Link>
                    )}
                  </div>
                ) : null}
              </Info>
              <Info label="Request id" mono full>
                {entry.requestId ? <CopyableReference value={entry.requestId} /> : null}
              </Info>
            </InfoGrid>
          </section>

          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Changes
            </h3>
            <ValueDiff previous={entry.previousValues} next={entry.newValues} />
          </section>

          <section className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3">
            <Fingerprint className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              This entry is immutable. The application layer has no code path that can modify or
              delete an audit record — the model rejects update and delete operations outright.
            </p>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatDayHeading(day: string): string {
  const date = new Date(day);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-NG', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Turns a raw UA string into something a human can read at a glance. */
function summariseUserAgent(userAgent: string): string {
  const browser =
    /Edg\//.test(userAgent) ? 'Edge'
    : /OPR\//.test(userAgent) ? 'Opera'
    : /Chrome\//.test(userAgent) ? 'Chrome'
    : /Safari\//.test(userAgent) ? 'Safari'
    : /Firefox\//.test(userAgent) ? 'Firefox'
    : 'Unknown browser';

  const platform =
    /Windows/.test(userAgent) ? 'Windows'
    : /Android/.test(userAgent) ? 'Android'
    : /iPhone|iPad/.test(userAgent) ? 'iOS'
    : /Mac OS X/.test(userAgent) ? 'macOS'
    : /Linux/.test(userAgent) ? 'Linux'
    : 'Unknown platform';

  return `${browser} on ${platform}`;
}
