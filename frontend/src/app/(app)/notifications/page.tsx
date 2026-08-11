'use client';

import Link from 'next/link';
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn, formatRelative, humanise } from '@/lib/utils';
import { notificationsService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { AppNotification, NotificationSeverity } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { PageHeader } from '@/components/common/page';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { FilterBar, FilterSelect } from '@/components/common/filters';

const SEVERITY_ICON: Record<NotificationSeverity, typeof Info> = {
  INFO: Info,
  SUCCESS: CheckCircle2,
  WARNING: AlertTriangle,
  CRITICAL: XCircle,
};

const SEVERITY_STYLE: Record<NotificationSeverity, string> = {
  INFO: 'text-primary bg-primary/10',
  SUCCESS: 'text-success bg-success/10',
  WARNING: 'text-warning bg-warning/10',
  CRITICAL: 'text-destructive bg-destructive/10',
};

export default function NotificationsPage() {
  const list = useListQuery();

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.notifications, list.query],
    () => notificationsService.list(list.query),
    { placeholderData: (previous) => previous },
  );

  const markRead = useApiMutation((id: string) => notificationsService.markRead(id), {
    invalidates: [queryKeys.notifications],
  });

  const markAllRead = useApiMutation(() => notificationsService.markAllRead(), {
    successMessage: 'All notifications marked as read',
    invalidates: [queryKeys.notifications],
  });

  const notifications = data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Threshold warnings, approvals awaiting you, and payment outcomes."
        actions={
          (data?.unreadCount ?? 0) > 0 && (
            <Button variant="outline" onClick={() => markAllRead.mutate()} loading={markAllRead.isPending}>
              <CheckCheck className="h-4 w-4" />
              Mark all read
            </Button>
          )
        }
      />

      <FilterBar activeFilterCount={list.activeFilterCount} onReset={list.resetFilters}>
        <div className="grid gap-3 sm:grid-cols-2">
          <FilterSelect
            label="Show"
            placeholder="All notifications"
            value={list.filters.unreadOnly as string | undefined}
            onChange={(value) => list.setFilter('unreadOnly', value)}
            options={[{ value: 'true', label: 'Unread only' }]}
          />
        </div>
      </FilterBar>

      {isLoading ? (
        <TableSkeleton rows={6} columns={2} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications"
          description="You will be notified here when a purse reaches its threshold, an approval needs your decision, or a payment completes."
        />
      ) : (
        <ul className="space-y-2">
          {notifications.map((notification) => (
            <NotificationRow
              key={notification._id}
              notification={notification}
              onRead={() => markRead.mutate(notification._id)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function NotificationRow({
  notification,
  onRead,
}: {
  notification: AppNotification;
  onRead: () => void;
}) {
  const Icon = SEVERITY_ICON[notification.severity] ?? Info;

  const body = (
    <div
      className={cn(
        'flex gap-3 rounded-lg border p-4 transition-colors',
        !notification.isRead && 'border-primary/30 bg-accent/40',
        notification.actionUrl && 'hover:bg-accent',
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          SEVERITY_STYLE[notification.severity],
        )}
      >
        <Icon className="h-4 w-4" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn('font-medium', !notification.isRead && 'text-foreground')}>
            {notification.title}
          </p>
          {!notification.isRead && <Badge variant="default">New</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{notification.message}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {humanise(notification.type)} · {formatRelative(notification.createdAt)}
        </p>
      </div>

      {!notification.isRead && (
        <Button
          variant="ghost"
          size="sm"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRead();
          }}
          aria-label="Mark as read"
        >
          <CheckCheck className="h-4 w-4" />
        </Button>
      )}
    </div>
  );

  return (
    <li>
      {notification.actionUrl ? (
        <Link href={notification.actionUrl} onClick={() => !notification.isRead && onRead()}>
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}
