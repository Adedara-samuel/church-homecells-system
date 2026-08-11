'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/primitives';
import type { BadgeProps } from '@/components/ui/primitives';

export interface Crumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: Crumb[];
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('space-y-3', className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="flex flex-wrap items-center gap-1 text-sm text-muted-foreground">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 && <ChevronRight className="h-3.5 w-3.5" aria-hidden />}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-foreground hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-foreground">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: React.ComponentType<{ className?: string }>;
  trend?: { value: number; label: string };
  tone?: 'default' | 'success' | 'warning' | 'destructive';
  className?: string;
}

const TONE_STYLES: Record<NonNullable<StatCardProps['tone']>, string> = {
  default: 'text-foreground',
  success: 'text-success',
  warning: 'text-warning',
  destructive: 'text-destructive',
};

/** KPI tile. Values are always live figures from the API — never placeholders. */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  trend,
  tone = 'default',
  className,
}: StatCardProps) {
  return (
    <div className={cn('rounded-lg border bg-card p-5 shadow-sm', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </div>
      <p className={cn('mt-2 truncate text-2xl font-semibold tabular', TONE_STYLES[tone])}>
        {value}
      </p>
      {(hint || trend) && (
        <p className="mt-1 text-xs text-muted-foreground">
          {trend && (
            <span className={trend.value >= 0 ? 'text-success' : 'text-destructive'}>
              {trend.value >= 0 ? '+' : ''}
              {trend.value.toFixed(1)}%{' '}
            </span>
          )}
          {trend?.label ?? hint}
        </p>
      )}
    </div>
  );
}

/** Consistent status chips across every module. */
export function StatusBadge({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  if (!status) return <span className="text-muted-foreground">—</span>;

  const map: Record<string, BadgeProps['variant']> = {
    ACTIVE: 'success',
    POSTED: 'success',
    APPROVED: 'success',
    SUCCESSFUL: 'success',
    DELIVERED: 'success',
    MATCHED: 'success',
    PRESENT: 'success',
    SENT: 'default',
    PENDING: 'warning',
    PENDING_APPROVAL: 'warning',
    PROCESSING: 'warning',
    QUEUED: 'warning',
    DRAFT: 'muted',
    UNRECONCILED: 'warning',
    INACTIVE: 'muted',
    ABSENT: 'muted',
    CANCELLED: 'muted',
    TRANSFERRED_OUT: 'muted',
    RELOCATED: 'muted',
    MANUALLY_RESOLVED: 'secondary',
    FAILED: 'destructive',
    REJECTED: 'destructive',
    REVERSED: 'destructive',
    REFUNDED: 'destructive',
    SUSPENDED: 'destructive',
    MISMATCHED: 'destructive',
    ORPHANED: 'destructive',
    DECEASED: 'muted',
  };

  const label = status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());

  return (
    <Badge variant={map[status] ?? 'secondary'} className={className}>
      {label}
    </Badge>
  );
}

/** Two-column label/value row used across every detail panel. */
export function DetailRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}
