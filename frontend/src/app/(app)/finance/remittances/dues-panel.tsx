'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CheckCircle2, Download, Loader2, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { duesService } from '@/services';
import { queryKeys, useApiQuery } from '@/hooks/use-api';
import { ApiError } from '@/lib/api-client';
import { cn, formatDate, formatMinor } from '@/lib/utils';
import type { DuesInvoiceSummary } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, Checkbox } from '@/components/ui/primitives';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';

/**
 * Monthly dues and zone levies.
 *
 * The list is what the Homecell actually owes, oldest first. Selection drives a single
 * checkout: paying eight months opens one payment, not eight. Anything already being
 * paid is shown but locked, so the same month cannot be sent to the provider twice.
 */
export function DuesPanel({ homecellId }: { homecellId: string | undefined }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [paying, setPaying] = React.useState(false);

  const statement = useApiQuery(
    [...queryKeys.dues, 'statement', homecellId ?? 'none'],
    () => duesService.statement(homecellId!),
    { enabled: Boolean(homecellId) },
  );

  // A refreshed statement can retire a selected invoice (paid elsewhere, waived by the
  // zone), so the selection is pruned to what is still payable.
  React.useEffect(() => {
    const payable = new Set(
      (statement.data?.outstanding ?? [])
        .filter((invoice) => invoice.status === 'OUTSTANDING')
        .map((invoice) => invoice.id),
    );
    setSelected((current) => {
      const next = new Set([...current].filter((id) => payable.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [statement.data]);

  if (!homecellId) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Select a homecell"
        description="Choose a homecell to see the dues and levies it owes."
      />
    );
  }
  if (statement.isLoading) return <TableSkeleton rows={4} />;
  if (statement.isError) {
    return <ErrorState error={statement.error} onRetry={() => void statement.refetch()} />;
  }

  const data = statement.data!;
  const payable = data.outstanding.filter((invoice) => invoice.status === 'OUTSTANDING');
  const selectedInvoices = payable.filter((invoice) => selected.has(invoice.id));
  const selectedTotal = selectedInvoices.reduce((sum, invoice) => sum + invoice.amountMinor, 0);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pay = async (invoiceIds?: string[]) => {
    setPaying(true);
    try {
      const session = await duesService.pay(homecellId, invoiceIds);
      if (!session.authorizationUrl) {
        throw new Error('The payment provider did not return a checkout link.');
      }
      // Full navigation rather than a popup: mobile browsers block popups, and the
      // provider redirects back to the callback page when the payment completes.
      window.location.href = session.authorizationUrl;
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : 'The payment could not be started. Try again.';
      toast.error(message);
      // The server may have retired or claimed invoices; re-read rather than guess.
      void queryClient.invalidateQueries({ queryKey: queryKeys.dues });
      setPaying(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryTile
          label="Total outstanding"
          value={formatMinor(data.totalOutstandingMinor, data.currency)}
          tone={data.totalOutstandingMinor > 0 ? 'warning' : 'success'}
        />
        <SummaryTile
          label="Overdue charges"
          value={String(data.overdueCount)}
          tone={data.overdueCount > 0 ? 'destructive' : 'success'}
        />
        <SummaryTile
          label="Paid this year"
          value={formatMinor(data.paidThisYearMinor, data.currency)}
          tone="default"
        />
      </div>

      {payable.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing outstanding"
          description={
            data.processingCount > 0
              ? 'A payment is currently being processed for the remaining charges.'
              : 'All dues and levies for this homecell are settled.'
          }
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  checked={selected.size > 0 && selected.size === payable.length}
                  onCheckedChange={(checked) =>
                    setSelected(checked ? new Set(payable.map((i) => i.id)) : new Set())
                  }
                  aria-label="Select every outstanding charge"
                />
                Select all
              </label>
              <span className="text-sm text-muted-foreground">
                {selected.size} of {payable.length} selected
              </span>
            </div>

            <ul className="divide-y">
              {data.outstanding.map((invoice) => (
                <InvoiceRow
                  key={invoice.id}
                  invoice={invoice}
                  currency={data.currency}
                  checked={selected.has(invoice.id)}
                  onToggle={() => toggle(invoice.id)}
                />
              ))}
            </ul>

            <div className="flex flex-col gap-3 border-t p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Selected total</p>
                <p className="text-xl font-semibold tabular-nums">
                  {formatMinor(selectedTotal, data.currency)}
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  disabled={paying}
                  onClick={() => void pay(undefined)}
                  title="Pay every outstanding charge in one payment"
                >
                  {paying ? <Loader2 className="animate-spin" /> : <Receipt />}
                  Pay all ({formatMinor(data.totalOutstandingMinor, data.currency)})
                </Button>
                <Button
                  disabled={paying || selectedInvoices.length === 0}
                  onClick={() => void pay(selectedInvoices.map((invoice) => invoice.id))}
                >
                  {paying ? <Loader2 className="animate-spin" /> : null}
                  Pay selected
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Dues are paid from the homecell purse. The purse is only debited once the payment
        provider confirms the payment — returning from the checkout page does not settle it.
      </p>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'default' | 'success' | 'warning' | 'destructive';
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-lg font-semibold tabular-nums',
          tone === 'warning' && 'text-warning',
          tone === 'destructive' && 'text-destructive',
          tone === 'success' && 'text-success',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function InvoiceRow({
  invoice,
  currency,
  checked,
  onToggle,
}: {
  invoice: DuesInvoiceSummary;
  currency: string;
  checked: boolean;
  onToggle: () => void;
}) {
  const locked = invoice.status !== 'OUTSTANDING';

  return (
    <li className={cn('flex items-center gap-3 p-3', locked && 'opacity-60')}>
      <Checkbox
        checked={checked}
        disabled={locked}
        onCheckedChange={onToggle}
        aria-label={`Select ${invoice.name} for ${invoice.periodLabel}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{invoice.periodLabel}</span>
          {invoice.frequency === 'ONE_OFF' && <Badge variant="secondary">Levy</Badge>}
          {invoice.overdue && (
            <Badge variant="destructive">
              <AlertTriangle className="h-3 w-3" />
              Overdue
            </Badge>
          )}
          {locked && <Badge variant="muted">Payment in progress</Badge>}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {invoice.name} · due {formatDate(invoice.dueDate)}
        </p>
      </div>
      <span className="shrink-0 font-semibold tabular-nums">
        {formatMinor(invoice.amountMinor, currency)}
      </span>
    </li>
  );
}

