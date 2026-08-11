'use client';

import * as React from 'react';
import { AlertTriangle, Inbox, RefreshCw, ShieldAlert, WifiOff } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/primitives';

/* -------------------------------------------------------------------------- */
/* Empty                                                                       */
/* -------------------------------------------------------------------------- */

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  className?: string;
}

/**
 * Empty states say what the screen is for and offer the next step, rather than
 * leaving a blank panel that reads as a failure.
 */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-14 text-center',
        className,
      )}
    >
      <div className="rounded-full bg-muted p-3">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {description && (
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Error                                                                       */
/* -------------------------------------------------------------------------- */

export interface ErrorStateProps {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

/**
 * Renders the message the API actually returned. Permission and network failures get
 * their own presentation because the user's next action differs in each case.
 */
export function ErrorState({ error, onRetry, className }: ErrorStateProps) {
  const apiError = error instanceof ApiError ? error : null;
  const isPermission =
    apiError?.status === 403 || apiError?.code === 'FORBIDDEN' || apiError?.code === 'OUT_OF_SCOPE';
  const isNetwork = apiError?.code === 'NETWORK_ERROR';

  const Icon = isPermission ? ShieldAlert : isNetwork ? WifiOff : AlertTriangle;
  const title = isPermission
    ? 'You do not have access to this'
    : isNetwork
      ? 'Cannot reach the server'
      : 'Something went wrong';
  const message =
    apiError?.message ??
    (error instanceof Error ? error.message : 'An unexpected error occurred.');

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-12 text-center',
        className,
      )}
    >
      <div className="rounded-full bg-destructive/10 p-3">
        <Icon className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        <p className="mx-auto max-w-md text-sm text-muted-foreground">{message}</p>
        {apiError?.requestId && (
          <p className="text-xs text-muted-foreground/70">Reference: {apiError.requestId}</p>
        )}
      </div>
      {onRetry && !isPermission && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          Try again
        </Button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

/** Table skeleton shaped like the rows it replaces, so layout does not jump. */
export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-2" aria-busy aria-label="Loading">
      <div className="flex gap-4 border-b pb-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 py-2.5">
          {Array.from({ length: columns }).map((_, columnIndex) => (
            <Skeleton
              key={columnIndex}
              className={cn('h-4 flex-1', columnIndex === 0 && 'max-w-[30%]')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-lg border p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = 280 }: { height?: number }) {
  return (
    <div className="space-y-3" aria-busy aria-label="Loading chart">
      <Skeleton className="h-4 w-40" />
      <Skeleton style={{ height }} className="w-full" />
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy aria-label="Loading">
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Async boundary                                                              */
/* -------------------------------------------------------------------------- */

export interface AsyncBoundaryProps {
  isLoading: boolean;
  isError: boolean;
  error?: unknown;
  isEmpty?: boolean;
  onRetry?: () => void;
  loadingFallback?: React.ReactNode;
  emptyFallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * The single place loading / error / empty ordering is decided, so every screen
 * in the application behaves identically without repeating the branches.
 */
export function AsyncBoundary({
  isLoading,
  isError,
  error,
  isEmpty,
  onRetry,
  loadingFallback,
  emptyFallback,
  children,
}: AsyncBoundaryProps) {
  if (isLoading) return <>{loadingFallback ?? <TableSkeleton />}</>;
  if (isError) return <ErrorState error={error} onRetry={onRetry} />;
  if (isEmpty) return <>{emptyFallback ?? <EmptyState title="Nothing to show yet" />}</>;
  return <>{children}</>;
}
