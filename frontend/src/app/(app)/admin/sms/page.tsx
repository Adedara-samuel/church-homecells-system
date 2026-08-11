'use client';

import * as React from 'react';
import { MessageSquare, Send, Sparkles } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatDate, formatNumber, humanise } from '@/lib/utils';
import { smsService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { SmsLog } from '@/types';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/primitives';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import { PageHeader, StatCard, StatusBadge } from '@/components/common/page';
import { DataTable, type Column } from '@/components/common/data-table';
import { CardSkeleton, EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { DateFilter, ConfirmButton, FilterBar, FilterSelect } from '@/components/common/filters';
import { Field } from '@/components/common/form';

interface SmsStatistics {
  byStatus: Record<string, number>;
  byType: { type: string; count: number; segments: number }[];
  last30Days: number;
}

export default function SmsPage() {
  const { can } = useAuth();
  const list = useListQuery();
  const [testOpen, setTestOpen] = React.useState(false);

  const logs = useApiQuery([...queryKeys.sms, list.query], () => smsService.list(list.query), {
    placeholderData: (previous) => previous,
  });

  const stats = useApiQuery(
    [...queryKeys.sms, 'statistics'],
    () => smsService.statistics() as Promise<SmsStatistics>,
  );

  const dispatch = useApiMutation(() => smsService.dispatchCelebrations(), {
    successMessage: 'Celebration messages dispatched',
    invalidates: [queryKeys.sms],
  });

  const columns: Column<SmsLog>[] = [
    {
      key: 'recipient',
      header: 'Recipient',
      render: (log) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{log.recipientName ?? log.phone}</p>
          <p className="truncate text-xs text-muted-foreground">{log.phone}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (log) => <span className="text-sm">{humanise(log.type)}</span>,
    },
    {
      key: 'message',
      header: 'Message',
      hideOnMobile: true,
      render: (log) => (
        <p className="max-w-md truncate text-sm text-muted-foreground">{log.message}</p>
      ),
    },
    {
      key: 'segments',
      header: 'Segments',
      align: 'right',
      hideOnMobile: true,
      render: (log) => log.segments,
    },
    { key: 'status', header: 'Status', render: (log) => <StatusBadge status={log.status} /> },
    {
      key: 'createdAt',
      header: 'Sent',
      render: (log) => <span className="text-sm">{formatDate(log.sentAt ?? log.createdAt, true)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="SMS"
        description="Automated birthday and wedding anniversary messages, with a full delivery log."
        breadcrumbs={[{ label: 'Administration' }, { label: 'SMS' }]}
        actions={
          <>
            {can('sms.configure') && (
              <Button variant="outline" onClick={() => setTestOpen(true)}>
                <Send className="h-4 w-4" />
                Send test
              </Button>
            )}
            {can('sms.send') && (
              <ConfirmButton
                title="Dispatch celebration messages now?"
                description="Sends today's birthday and anniversary messages. Members already greeted today are skipped automatically."
                confirmLabel="Dispatch"
                onConfirm={() => dispatch.mutateAsync()}
                loading={dispatch.isPending}
              >
                <Sparkles className="h-4 w-4" />
                Dispatch celebrations
              </ConfirmButton>
            )}
          </>
        }
      />

      {stats.isLoading ? (
        <CardSkeleton count={4} />
      ) : stats.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Sent in last 30 days"
            value={formatNumber(stats.data.last30Days)}
            icon={MessageSquare}
          />
          <StatCard
            label="Delivered"
            value={formatNumber(stats.data.byStatus.DELIVERED ?? 0)}
            tone="success"
          />
          <StatCard
            label="Failed"
            value={formatNumber(stats.data.byStatus.FAILED ?? 0)}
            tone={(stats.data.byStatus.FAILED ?? 0) > 0 ? 'destructive' : 'default'}
          />
          <StatCard
            label="Total segments"
            value={formatNumber(stats.data.byType.reduce((sum, t) => sum + t.segments, 0))}
            hint="Billable message parts"
          />
        </div>
      ) : null}

      <FilterBar activeFilterCount={list.activeFilterCount} onReset={list.resetFilters}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <FilterSelect
            label="Type"
            placeholder="All types"
            value={list.filters.type as string | undefined}
            onChange={(value) => list.setFilter('type', value)}
            options={['BIRTHDAY', 'WEDDING_ANNIVERSARY', 'TRANSACTIONAL'].map((t) => ({
              value: t,
              label: humanise(t),
            }))}
          />
          <FilterSelect
            label="Status"
            placeholder="All statuses"
            value={list.filters.status as string | undefined}
            onChange={(value) => list.setFilter('status', value)}
            options={['QUEUED', 'SENT', 'DELIVERED', 'FAILED'].map((s) => ({
              value: s,
              label: humanise(s),
            }))}
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
      </FilterBar>

      {logs.isLoading ? (
        <TableSkeleton rows={7} columns={5} />
      ) : logs.isError ? (
        <ErrorState error={logs.error} onRetry={() => void logs.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={logs.data?.items ?? []}
          rowKey={(log) => log._id}
          pagination={logs.data?.pagination}
          onPageChange={list.setPage}
          onLimitChange={list.setLimit}
          emptyState={
            <EmptyState
              icon={MessageSquare}
              title="No messages sent yet"
              description="Birthday and anniversary messages appear here once the scheduled job runs."
            />
          }
        />
      )}

      <TestSmsDialog open={testOpen} onOpenChange={setTestOpen} />
    </>
  );
}

function TestSmsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [phone, setPhone] = React.useState('');
  const [message, setMessage] = React.useState(
    'This is a test message from the Church Homecell Management System.',
  );

  const mutation = useApiMutation(() => smsService.sendTest(phone.trim(), message.trim()), {
    successMessage: 'Test message dispatched',
    invalidates: [queryKeys.sms],
    onSuccess: () => onOpenChange(false),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send a test message</DialogTitle>
          <DialogDescription>
            Confirms the SMS provider configuration end to end. The message appears in the delivery
            log like any other.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field label="Phone number" htmlFor="test-phone" required>
            <Input
              id="test-phone"
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+2348030000000"
            />
          </Field>
          <Field
            label="Message"
            htmlFor="test-message"
            required
            hint={`${message.length} characters · ${Math.max(1, Math.ceil(message.length / 153))} segment(s)`}
          >
            <Textarea
              id="test-message"
              rows={4}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={phone.trim().length < 7 || message.trim().length < 3}
          >
            <Send className="h-4 w-4" />
            Send test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
