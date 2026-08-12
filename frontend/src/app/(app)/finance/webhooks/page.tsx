'use client';

import * as React from 'react';
import { CheckCircle2, Radio, ShieldAlert, XCircle } from 'lucide-react';
import { formatDate, formatRelative, humanise } from '@/lib/utils';
import { paymentsService } from '@/services';
import { queryKeys, useApiQuery, useListQuery } from '@/hooks/use-api';
import type { WebhookEvent } from '@/types';
import { Badge } from '@/components/ui/primitives';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import { PageHeader, StatCard } from '@/components/common/page';
import { DataTable, type Column } from '@/components/common/data-table';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { FilterBar, FilterSelect } from '@/components/common/filters';
import { CopyableReference, Info, InfoGrid } from '@/components/common/detail';

/**
 * Webhook delivery log.
 *
 * The record of what each payment provider actually sent us — the first place to look
 * when a payment has not settled. A `deliveryCount` above one is normal and healthy:
 * it means a repeat delivery was recognised and ignored rather than double-counted.
 */
export default function WebhookEventsPage() {
  const list = useListQuery();
  const [selected, setSelected] = React.useState<WebhookEvent | null>(null);

  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.payments, 'webhook-events', list.query],
    () => paymentsService.webhookEvents(list.query),
    {
      placeholderData: (previous) => previous,
      // New deliveries arrive continuously while a payment is in flight.
      refetchInterval: 30_000,
    },
  );

  const events = data?.items ?? [];
  const invalidSignatures = events.filter((e) => !e.signatureValid).length;
  const duplicates = events.filter((e) => e.deliveryCount > 1).length;
  const unprocessed = events.filter((e) => !e.processed).length;

  const columns: Column<WebhookEvent>[] = [
    {
      key: 'eventType',
      header: 'Event',
      render: (event) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{event.eventType}</p>
          <p className="truncate text-xs text-muted-foreground">
            {event.provider}
            {event.paymentReference ? ` · ${event.paymentReference}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'receivedAt',
      header: 'Received',
      render: (event) => <span className="text-sm">{formatRelative(event.receivedAt)}</span>,
    },
    {
      key: 'deliveryCount',
      header: 'Deliveries',
      align: 'right',
      render: (event) =>
        event.deliveryCount > 1 ? (
          <Badge variant="secondary">{event.deliveryCount}×</Badge>
        ) : (
          <span className="text-sm">1</span>
        ),
    },
    {
      key: 'signatureValid',
      header: 'Signature',
      render: (event) =>
        event.signatureValid ? (
          <Badge variant="success">Verified</Badge>
        ) : (
          <Badge variant="destructive">Rejected</Badge>
        ),
    },
    {
      key: 'processed',
      header: 'Outcome',
      render: (event) =>
        event.processed ? (
          <Badge variant="success">Processed</Badge>
        ) : event.error ? (
          <Badge variant="muted">{event.error}</Badge>
        ) : (
          <Badge variant="warning">Pending</Badge>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Webhook deliveries"
        description="Everything the payment providers have sent us. The first place to look when a payment has not settled."
        breadcrumbs={[{ label: 'Finance' }, { label: 'Webhooks' }]}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Deliveries in view" value={String(events.length)} icon={Radio} />
        <StatCard
          label="Repeat deliveries"
          value={String(duplicates)}
          hint="Recognised and ignored — no double counting"
          icon={CheckCircle2}
        />
        <StatCard
          label="Awaiting processing"
          value={String(unprocessed)}
          icon={XCircle}
          tone={unprocessed > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Rejected signatures"
          value={String(invalidSignatures)}
          hint="Failed verification and were not applied"
          icon={ShieldAlert}
          tone={invalidSignatures > 0 ? 'destructive' : 'success'}
        />
      </div>

      <FilterBar activeFilterCount={list.activeFilterCount} onReset={list.resetFilters}>
        <div className="grid gap-3 sm:grid-cols-2">
          <FilterSelect
            label="Provider"
            placeholder="All providers"
            value={list.filters.provider as string | undefined}
            onChange={(value) => list.setFilter('provider', value)}
            options={['PAYSTACK', 'FLUTTERWAVE', 'MOCK'].map((p) => ({
              value: p,
              label: humanise(p),
            }))}
          />
          <FilterSelect
            label="Outcome"
            placeholder="All"
            value={list.filters.processed as string | undefined}
            onChange={(value) => list.setFilter('processed', value)}
            options={[
              { value: 'true', label: 'Processed' },
              { value: 'false', label: 'Not processed' },
            ]}
          />
        </div>
      </FilterBar>

      {isLoading ? (
        <TableSkeleton rows={8} columns={5} />
      ) : isError ? (
        <ErrorState error={error} onRetry={() => void refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={events}
          rowKey={(event) => event._id}
          onRowClick={(event) => setSelected(event)}
          pagination={data?.pagination}
          onPageChange={list.setPage}
          onLimitChange={list.setLimit}
          emptyState={
            <EmptyState
              icon={Radio}
              title="No webhook deliveries yet"
              description="Deliveries appear here as soon as a payment provider calls back about a transaction."
            />
          }
        />
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected?.eventType}</DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-5">
              <InfoGrid>
                <Info label="Provider">{selected.provider}</Info>
                <Info label="Received">{formatDate(selected.receivedAt, true)}</Info>
                <Info label="Deliveries">{selected.deliveryCount}</Info>
                <Info label="Processed at">
                  {selected.processedAt ? formatDate(selected.processedAt, true) : null}
                </Info>
                <Info label="Signature">
                  {selected.signatureValid ? 'Verified' : 'Rejected — not applied'}
                </Info>
                <Info label="Payment reference" mono>
                  {selected.paymentReference ? (
                    <CopyableReference value={selected.paymentReference} />
                  ) : null}
                </Info>
                <Info label="Event key" mono full>
                  <CopyableReference value={selected.eventKey} />
                </Info>
                {selected.error && (
                  <Info label="Note" full>
                    {selected.error}
                  </Info>
                )}
              </InfoGrid>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Raw payload
                </p>
                <pre className="table-scroll max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(selected.payload, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
