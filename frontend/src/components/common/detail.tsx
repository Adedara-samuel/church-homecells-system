'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  CircleDashed,
  Clock,
  Copy,
  ExternalLink,
  FileText,
  ImageIcon,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { auditService } from '@/services';
import { queryKeys, useApiQuery } from '@/hooks/use-api';
import { cn, formatDate, formatRelative, humanise } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@/components/ui/primitives';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/overlays';

/* -------------------------------------------------------------------------- */
/* Record header                                                               */
/* -------------------------------------------------------------------------- */

export interface RecordHeaderProps {
  /** Machine reference shown large and copyable — the thing people quote. */
  reference?: string;
  title: string;
  subtitle?: React.ReactNode;
  backHref: string;
  backLabel: string;
  status?: React.ReactNode;
  /** The headline figure, e.g. an amount. */
  highlight?: { label: string; value: React.ReactNode; tone?: 'default' | 'success' | 'warning' | 'destructive' };
  actions?: React.ReactNode;
}

const HIGHLIGHT_TONE = {
  default: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
};

export function RecordHeader({
  reference,
  title,
  subtitle,
  backHref,
  backLabel,
  status,
  highlight,
  actions,
}: RecordHeaderProps) {
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
        <Link href={backHref}>
          <ArrowLeft className="h-4 w-4" />
          {backLabel}
        </Link>
      </Button>

      <div className="surface-raised rounded-xl p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
              {status}
            </div>
            {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
            {reference && <CopyableReference value={reference} />}
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center lg:justify-end">
            {highlight && (
              <div className="lg:text-right">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {highlight.label}
                </p>
                <p
                  className={cn(
                    'text-2xl font-semibold tabular sm:text-3xl',
                    HIGHLIGHT_TONE[highlight.tone ?? 'default'],
                  )}
                >
                  {highlight.value}
                </p>
              </div>
            )}
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A reference people need to quote to support — one click to copy. */
export function CopyableReference({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success('Reference copied');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Could not copy to the clipboard');
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={cn(
        'group inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted px-2 py-1 font-mono text-xs transition-colors hover:bg-accent',
        className,
      )}
      aria-label={`Copy reference ${value}`}
    >
      <span className="truncate">{value}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-success" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
      )}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Info grid                                                                   */
/* -------------------------------------------------------------------------- */

export function InfoCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function InfoGrid({
  children,
  columns = 2,
  className,
}: {
  children: React.ReactNode;
  columns?: 1 | 2 | 3;
  className?: string;
}) {
  return (
    <dl
      className={cn(
        'grid gap-x-6 gap-y-5',
        columns === 2 && 'sm:grid-cols-2',
        columns === 3 && 'sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {children}
    </dl>
  );
}

export function Info({
  label,
  children,
  mono,
  className,
  full,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  className?: string;
  full?: boolean;
}) {
  const empty = children === null || children === undefined || children === '';
  return (
    <div className={cn('min-w-0 space-y-1', full && 'sm:col-span-2 lg:col-span-3', className)}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn('text-sm', mono && 'break-all font-mono text-xs')}>
        {empty ? <span className="text-muted-foreground">—</span> : children}
      </dd>
    </div>
  );
}

/** Links to another record in the system, styled consistently everywhere. */
export function RecordLink({
  href,
  children,
  external,
}: {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}) {
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-primary hover:underline"
      >
        {children}
        <ExternalLink className="h-3.5 w-3.5" />
      </a>
    );
  }
  return (
    <Link href={href} className="text-primary hover:underline">
      {children}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Timeline                                                                    */
/* -------------------------------------------------------------------------- */

export interface TimelineStep {
  label: string;
  description?: React.ReactNode;
  at?: string | null;
  state: 'done' | 'current' | 'pending' | 'failed';
  actor?: string | null;
}

/** Vertical progress rail used for approvals and payment status history. */
export function Timeline({ steps }: { steps: TimelineStep[] }) {
  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity recorded yet.</p>;
  }

  return (
    <ol className="relative space-y-5">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        return (
          <li key={`${step.label}-${index}`} className="relative flex gap-3">
            {/* Connector rail, stopping before the final marker. */}
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  'absolute left-[11px] top-7 h-[calc(100%+0.5rem)] w-px',
                  step.state === 'done' ? 'bg-success/40' : 'bg-border',
                )}
              />
            )}
            <span
              className={cn(
                'relative z-10 mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 bg-background',
                step.state === 'done' && 'border-success bg-success text-success-foreground',
                step.state === 'failed' &&
                  'border-destructive bg-destructive text-destructive-foreground',
                step.state === 'current' && 'border-primary text-primary',
                step.state === 'pending' && 'border-muted-foreground/30 text-muted-foreground',
              )}
            >
              {step.state === 'done' ? (
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              ) : step.state === 'failed' ? (
                <X className="h-3.5 w-3.5" strokeWidth={3} />
              ) : step.state === 'current' ? (
                <Clock className="h-3.5 w-3.5" />
              ) : (
                <CircleDashed className="h-3.5 w-3.5" />
              )}
            </span>

            <div className="min-w-0 flex-1 pb-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-medium">{step.label}</p>
                {step.at && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-xs text-muted-foreground">
                        {formatRelative(step.at)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{formatDate(step.at, true)}</TooltipContent>
                  </Tooltip>
                )}
              </div>
              {step.actor && <p className="text-xs text-muted-foreground">{step.actor}</p>}
              {step.description && (
                <div className="mt-1 text-sm text-muted-foreground">{step.description}</div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* Attachment preview                                                          */
/* -------------------------------------------------------------------------- */

export function AttachmentPreview({
  url,
  label = 'Supporting document',
  emptyMessage = 'No document attached',
}: {
  url?: string | null;
  label?: string;
  emptyMessage?: string;
}) {
  if (!url) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        <FileText className="h-4 w-4" />
        {emptyMessage}
      </div>
    );
  }

  const isPdf = /\.pdf($|\?)/i.test(url);

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
    >
      {isPdf ? (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded bg-muted text-xs font-semibold">
          PDF
        </span>
      ) : (
        // Remote host and incidental preview — the optimiser adds no value here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={label} className="h-14 w-14 shrink-0 rounded object-cover" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">Open in a new tab</p>
      </div>
      <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground" />
    </a>
  );
}

/* -------------------------------------------------------------------------- */
/* Value diff                                                                  */
/* -------------------------------------------------------------------------- */

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  const text = String(value);
  // Surface ISO timestamps in a readable form.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return formatDate(text, true);
  return text;
}

/**
 * Field-by-field before/after view.
 *
 * The audit log stores only the keys that actually changed, so this renders one row
 * per change with the old value struck through beside the new one — far easier to scan
 * than two JSON blobs side by side.
 */
export function ValueDiff({
  previous,
  next,
}: {
  previous?: Record<string, unknown> | null;
  next?: Record<string, unknown> | null;
}) {
  const keys = React.useMemo(
    () => [...new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})])].sort(),
    [previous, next],
  );

  if (keys.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This action recorded no field-level changes.
      </p>
    );
  }

  return (
    <div className="table-scroll rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/40">
          <tr>
            <th className="w-[28%] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Field
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Before
            </th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              After
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => {
            const before = previous?.[key];
            const after = next?.[key];
            const added = before === undefined;
            const removed = after === undefined;

            return (
              <tr key={key} className="border-b align-top last:border-0">
                <td className="px-3 py-2 font-medium">{humanise(key)}</td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'whitespace-pre-wrap break-words font-mono text-xs',
                      added ? 'text-muted-foreground' : 'text-destructive line-through',
                    )}
                  >
                    {added ? '—' : renderValue(before)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'whitespace-pre-wrap break-words font-mono text-xs',
                      removed ? 'text-muted-foreground' : 'text-success',
                    )}
                  >
                    {removed ? '—' : renderValue(after)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Audit trail for a record                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every change ever made to one record, oldest first.
 *
 * Dropped onto any detail page to answer "who changed this, and when?" without
 * leaving the record.
 */
export function RecordAuditTrail({
  entityModel,
  entityId,
  canView,
}: {
  entityModel: string;
  entityId: string;
  canView: boolean;
}) {
  const { data, isLoading } = useApiQuery(
    [...queryKeys.audit, 'entity', entityModel, entityId],
    () => auditService.forEntity(entityModel, entityId),
    { enabled: canView && Boolean(entityId) },
  );

  if (!canView) return null;

  return (
    <InfoCard title="Audit trail" description="Every recorded action on this record.">
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No audit entries for this record yet.</p>
      ) : (
        <Timeline
          steps={data.map((entry) => ({
            label: entry.description,
            at: entry.createdAt,
            state: entry.success ? 'done' : 'failed',
            actor: `${entry.userName ?? 'System'}${
              entry.userRole ? ` · ${humanise(entry.userRole)}` : ''
            }`,
            description:
              entry.previousValues || entry.newValues ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-primary hover:underline">
                    View changed fields
                  </summary>
                  <div className="mt-2">
                    <ValueDiff previous={entry.previousValues} next={entry.newValues} />
                  </div>
                </details>
              ) : undefined,
          }))}
        />
      )}
    </InfoCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                        */
/* -------------------------------------------------------------------------- */

/** Small labelled metric used inside detail panels. */
export function MiniStat({
  label,
  value,
  tone = 'default',
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'destructive' | 'muted';
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
      </div>
      <p
        className={cn(
          'mt-1.5 truncate text-lg font-semibold tabular',
          tone === 'success' && 'text-success',
          tone === 'warning' && 'text-warning',
          tone === 'destructive' && 'text-destructive',
          tone === 'muted' && 'text-muted-foreground',
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function ImagePlaceholder({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-lg bg-muted text-muted-foreground',
        className,
      )}
    >
      <ImageIcon className="h-6 w-6" />
    </div>
  );
}

export { Badge };
