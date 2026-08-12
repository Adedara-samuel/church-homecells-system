'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Send, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { formatMinor, toDateInput } from '@/lib/utils';
import { financeService, homecellsService, remittancesService, settingsService } from '@/services';
import { queryKeys, useApiMutation } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/primitives';
import { PageHeader } from '@/components/common/page';
import { Field, FileUploadField, FormSection, MoneyInput, SelectField } from '@/components/common/form';
import { MiniStat } from '@/components/common/detail';

/**
 * Dedicated remittance page.
 *
 * The threshold warnings on the dashboard and the purse cards link straight here with
 * `?homecellId=`, so the coordinator lands with the Homecell chosen and the shortfall
 * already calculated.
 */
export default function NewRemittancePage() {
  return (
    <React.Suspense fallback={null}>
      <NewRemittanceForm />
    </React.Suspense>
  );
}

function NewRemittanceForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const preset = searchParams.get('homecellId') ?? user?.homecell ?? '';

  const [homecellId, setHomecellId] = React.useState(preset);
  const [form, setForm] = React.useState({
    amount: '',
    date: toDateInput(),
    paymentReference: '',
    description: '',
  });
  const [receipt, setReceipt] = React.useState<{ url: string; publicId: string } | null>(null);

  const settings = useQuery({ queryKey: [...queryKeys.settings], queryFn: settingsService.get });

  const homecells = useQuery({
    queryKey: [...queryKeys.homecells, 'options', 'all'],
    queryFn: () => homecellsService.options({}),
  });

  const purse = useQuery({
    queryKey: [...queryKeys.finance, 'purse', homecellId],
    queryFn: () => financeService.purse(homecellId),
    enabled: Boolean(homecellId),
  });

  // Pre-fill the shortfall the moment a purse over its threshold is selected.
  React.useEffect(() => {
    if (purse.data?.requiresRemittance && purse.data.suggestedRemittanceMinor > 0 && !form.amount) {
      setForm((f) => ({ ...f, amount: String(purse.data!.suggestedRemittanceMinor / 100) }));
    }
  }, [purse.data, form.amount]);

  const mutation = useApiMutation(
    () =>
      remittancesService.create({
        homecellId,
        amount: Number(form.amount),
        date: form.date,
        channel: 'MANUAL',
        paymentReference: form.paymentReference.trim() || undefined,
        description: form.description.trim() || undefined,
        receiptUrl: receipt?.url,
        receiptPublicId: receipt?.publicId,
      }),
    {
      successMessage: 'Remittance recorded',
      invalidates: [queryKeys.remittances, queryKeys.finance, queryKeys.dashboard],
      onSuccess: (created) => router.push(`/finance/remittances/${created._id}`),
    },
  );

  const receiptRequired = settings.data?.remittanceRequiresReceipt ?? true;
  const amountMinor = Math.round(Number(form.amount || 0) * 100);
  const available = purse.data?.balance.availableMinor ?? 0;
  const exceedsBalance = Boolean(purse.data) && amountMinor > available;
  const remaining = available - amountMinor;

  const canSubmit =
    Boolean(homecellId) &&
    Number(form.amount) > 0 &&
    !exceedsBalance &&
    (!receiptRequired || Boolean(receipt));

  return (
    <>
      <PageHeader
        title="Record remittance"
        description={`Move funds from a Homecell purse to ${
          settings.data?.generalPurseAccountName ?? 'the General Homecell Purse'
        }.`}
        breadcrumbs={[
          { label: 'Finance' },
          { label: 'Remittances', href: '/finance/remittances' },
          { label: 'New' },
        ]}
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <FormSection title="Source" description="The Homecell the funds are coming from.">
            <Field label="Homecell" required className="sm:col-span-2">
              <SelectField
                value={homecellId}
                onChange={setHomecellId}
                placeholder="Select a Homecell"
                options={(homecells.data ?? []).map((h) => ({
                  value: h._id,
                  label: `${h.name} (${h.code})`,
                }))}
              />
            </Field>
          </FormSection>

          <FormSection title="Remittance" description="What is being sent, and when.">
            <Field
              label="Amount"
              htmlFor="amount"
              required
              error={exceedsBalance ? 'The amount exceeds the available purse balance.' : undefined}
              hint={
                !exceedsBalance && purse.data && amountMinor > 0
                  ? `Purse balance after this remittance: ${formatMinor(
                      remaining,
                      purse.data.currency,
                    )}`
                  : undefined
              }
            >
              <MoneyInput
                id="amount"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0.00"
                aria-invalid={exceedsBalance}
              />
            </Field>

            <Field label="Remittance date" htmlFor="date" required>
              <Input
                id="date"
                type="date"
                value={form.date}
                max={toDateInput()}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              />
            </Field>

            <Field
              label="Payment / transfer reference"
              htmlFor="paymentReference"
              hint="The bank reference from the transfer"
              className="sm:col-span-2"
            >
              <Input
                id="paymentReference"
                value={form.paymentReference}
                onChange={(e) => setForm((f) => ({ ...f, paymentReference: e.target.value }))}
              />
            </Field>

            <Field label="Description" htmlFor="description" className="sm:col-span-2">
              <Textarea
                id="description"
                rows={3}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Remittance to the General Homecell Purse"
              />
            </Field>

            <Field
              label="Proof of payment"
              required={receiptRequired}
              className="sm:col-span-2"
              error={receiptRequired && !receipt ? 'Proof of payment is required.' : undefined}
            >
              <FileUploadField
                value={receipt}
                onChange={setReceipt}
                folder="receipts"
                label="Upload proof of payment"
              />
            </Field>
          </FormSection>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => router.push('/finance/remittances')}>
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              loading={mutation.isPending}
              disabled={!canSubmit}
            >
              <Send className="h-4 w-4" />
              Record remittance
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {purse.data ? (
            <div className="space-y-3 rounded-lg border bg-card p-5">
              <p className="text-sm font-semibold">{purse.data.homecellName} purse</p>
              <MiniStat
                label="Available balance"
                value={formatMinor(purse.data.balance.availableMinor, purse.data.currency)}
                icon={Wallet}
                tone={purse.data.requiresRemittance ? 'warning' : 'default'}
              />
              <MiniStat
                label="Maximum threshold"
                value={formatMinor(purse.data.thresholdMinor, purse.data.currency)}
                tone="muted"
              />
              {purse.data.requiresRemittance && (
                <div className="flex items-start gap-2 rounded-md bg-warning/10 p-3 text-xs">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <p>
                    This purse is above its threshold. Remitting at least{' '}
                    <span className="font-semibold">
                      {formatMinor(purse.data.suggestedRemittanceMinor, purse.data.currency)}
                    </span>{' '}
                    brings it back within the limit.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
              Select a Homecell to see its purse balance and threshold.
            </div>
          )}

          <div className="rounded-lg border bg-muted/30 p-4 text-xs text-muted-foreground">
            <p className="mb-1 font-medium text-foreground">What happens next</p>
            <p>
              The remittance is submitted for approval. The Homecell purse is debited only once it
              has been verified against the proof of payment — recording it here does not move
              money on its own.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
