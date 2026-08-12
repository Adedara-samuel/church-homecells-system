'use client';

import * as React from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CreditCard,
  MessageSquare,
  Plus,
  Save,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
import { formatMoney } from '@/lib/utils';
import { settingsService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery } from '@/hooks/use-api';
import type { SystemSettings } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui/primitives';
import { PageHeader } from '@/components/common/page';
import { DetailSkeleton, ErrorState } from '@/components/common/states';
import { Field, MoneyInput, SelectField } from '@/components/common/form';

export default function SettingsPage() {
  const { data, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.settings],
    settingsService.get,
  );

  const integrations = useApiQuery(
    [...queryKeys.settings, 'integrations'],
    settingsService.integrations,
  );

  const [draft, setDraft] = React.useState<Partial<SystemSettings> & Record<string, unknown>>({});

  React.useEffect(() => {
    if (data) setDraft({});
  }, [data]);

  const mutation = useApiMutation(() => settingsService.update(draft), {
    successMessage: 'Settings saved',
    invalidates: [queryKeys.settings, queryKeys.finance, queryKeys.dashboard],
    onSuccess: () => setDraft({}),
  });

  if (isLoading) return <DetailSkeleton />;
  if (isError || !data) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const value = <K extends string>(key: K, fallback: unknown) =>
    (draft[key] !== undefined ? draft[key] : fallback) as never;

  const set = (key: string, next: unknown) => setDraft((current) => ({ ...current, [key]: next }));

  const hasChanges = Object.keys(draft).length > 0;

  return (
    <>
      <PageHeader
        title="System settings"
        description="Church-wide configuration. Provider credentials live in environment variables — only the choice of provider is stored here."
        breadcrumbs={[{ label: 'Administration' }, { label: 'Settings' }]}
        actions={
          <Button
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
            disabled={!hasChanges}
          >
            <Save className="h-4 w-4" />
            Save changes
          </Button>
        }
      />

      <Tabs defaultValue="general">
        <TabsList className="flex-wrap">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="finance">Finance</TabsTrigger>
          <TabsTrigger value="transfers">Transfers</TabsTrigger>
          <TabsTrigger value="sms">SMS</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Church details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Church name" htmlFor="church-name">
                <Input
                  id="church-name"
                  value={value('churchName', data.churchName)}
                  onChange={(e) => set('churchName', e.target.value)}
                />
              </Field>
              <Field label="Celebration window" htmlFor="celebration-window" hint="Days ahead shown on dashboards">
                <Input
                  id="celebration-window"
                  type="number"
                  min={1}
                  max={365}
                  value={value('upcomingCelebrationWindowDays', data.upcomingCelebrationWindowDays)}
                  onChange={(e) => set('upcomingCelebrationWindowDays', Number(e.target.value))}
                />
              </Field>
              <Field label="Maximum upload size (MB)" htmlFor="upload-size">
                <Input
                  id="upload-size"
                  type="number"
                  min={1}
                  max={50}
                  value={value('maxUploadSizeMb', data.maxUploadSizeMb)}
                  onChange={(e) => set('maxUploadSizeMb', Number(e.target.value))}
                />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="finance">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Homecell purse</CardTitle>
                <CardDescription>
                  When a purse balance reaches this amount, the coordinator is prompted to remit.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Maximum purse threshold"
                  hint={`Currently ${formatMoney(data.maxPurseThreshold, data.currency)} — a Homecell may override this individually.`}
                >
                  <MoneyInput
                    value={value('maxPurseThreshold', data.maxPurseThreshold)}
                    onChange={(e) => set('maxPurseThreshold', Number(e.target.value))}
                  />
                </Field>
                <Field label="General purse account name">
                  <Input
                    value={value('generalPurseAccountName', data.generalPurseAccountName)}
                    onChange={(e) => set('generalPurseAccountName', e.target.value)}
                  />
                </Field>
                <Field label="Account number">
                  <Input
                    value={value('generalPurseAccountNumber', data.generalPurseAccountNumber ?? '')}
                    onChange={(e) => set('generalPurseAccountNumber', e.target.value)}
                  />
                </Field>
                <Field label="Bank name">
                  <Input
                    value={value('generalPurseBankName', data.generalPurseBankName ?? '')}
                    onChange={(e) => set('generalPurseBankName', e.target.value)}
                  />
                </Field>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Approval requirements</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ToggleRow
                  label="Expenses require approval"
                  description="Only approved expenses reduce the available purse balance."
                  checked={value('expenseApprovalRequired', data.expenseApprovalRequired)}
                  onChange={(checked) => set('expenseApprovalRequired', checked)}
                />
                <Field
                  label="Expense approval threshold"
                  hint="Expenses at or above this amount always require approval. Set to zero to require it for all."
                >
                  <MoneyInput
                    value={value('expenseApprovalThreshold', data.expenseApprovalThreshold)}
                    onChange={(e) => set('expenseApprovalThreshold', Number(e.target.value))}
                  />
                </Field>
                <ToggleRow
                  label="Remittances require approval"
                  description="A remittance must be approved before it can be verified or disbursed."
                  checked={value('remittanceRequiresApproval', data.remittanceRequiresApproval)}
                  onChange={(checked) => set('remittanceRequiresApproval', checked)}
                />
                <ToggleRow
                  label="Remittances require proof of payment"
                  description="A receipt must be attached before a manual remittance can be verified."
                  checked={value('remittanceRequiresReceipt', data.remittanceRequiresReceipt)}
                  onChange={(checked) => set('remittanceRequiresReceipt', checked)}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="transfers">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Transfer approval chains</CardTitle>
              <CardDescription>
                Each transfer follows the chain matching its scope. An empty chain approves
                immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(
                [
                  [
                    'transferApprovalChainSameArea',
                    'Same area',
                    'A member moving between two Homecells in the same Area.',
                  ],
                  [
                    'transferApprovalChainCrossArea',
                    'Across areas',
                    'A member moving to a Homecell in a different Area of the same Zone.',
                  ],
                  [
                    'transferApprovalChainCrossZone',
                    'Across zones',
                    'A member moving to a Homecell in another Zone entirely.',
                  ],
                ] as const
              ).map(([key, label, description]) => (
                <ApprovalChainEditor
                  key={key}
                  label={label}
                  description={description}
                  stages={value(key, data[key]) as string[]}
                  onChange={(stages) => set(key, stages)}
                />
              ))}
              <p className="text-xs text-muted-foreground">
                Changes apply to transfers requested from now on. Requests already in flight keep
                the chain they were created with, so an edit here can never strand one mid-approval.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sms">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Celebration messages</CardTitle>
              <CardDescription>
                <code className="rounded bg-muted px-1">{'{{name}}'}</code> and{' '}
                <code className="rounded bg-muted px-1">{'{{church}}'}</code> are replaced when the
                message is sent.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <ToggleRow
                label="Birthday SMS"
                description="Sent automatically each morning to members celebrating that day."
                checked={value('birthdaySmsEnabled', data.birthdaySmsEnabled)}
                onChange={(checked) => set('birthdaySmsEnabled', checked)}
              />
              <Field label="Birthday message">
                <Textarea
                  rows={4}
                  value={value('birthdayMessageTemplate', data.birthdayMessageTemplate)}
                  onChange={(e) => set('birthdayMessageTemplate', e.target.value)}
                />
              </Field>
              <ToggleRow
                label="Wedding anniversary SMS"
                description="Sent automatically to members celebrating an anniversary."
                checked={value('anniversarySmsEnabled', data.anniversarySmsEnabled)}
                onChange={(checked) => set('anniversarySmsEnabled', checked)}
              />
              <Field label="Anniversary message">
                <Textarea
                  rows={4}
                  value={value('anniversaryMessageTemplate', data.anniversaryMessageTemplate)}
                  onChange={(e) => set('anniversaryMessageTemplate', e.target.value)}
                />
              </Field>
              <Field label="Sender ID" hint="Maximum 11 characters, as registered with the provider">
                <Input
                  maxLength={11}
                  value={value('smsSenderId', data.smsSenderId)}
                  onChange={(e) => set('smsSenderId', e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CreditCard className="h-4 w-4" />
                  Payment provider
                </CardTitle>
                <CardDescription>
                  Credentials come from environment variables. A provider without credentials falls
                  back to the development mock so the application stays usable.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Active provider">
                  <SelectField
                    value={value('activePaymentProvider', data.activePaymentProvider)}
                    onChange={(v) => set('activePaymentProvider', v)}
                    options={[
                      { value: 'PAYSTACK', label: 'Paystack' },
                      { value: 'FLUTTERWAVE', label: 'Flutterwave' },
                      { value: 'MOCK', label: 'Mock (development)' },
                    ]}
                  />
                </Field>

                <div className="space-y-2">
                  {integrations.data?.payments.providers.map((provider) => (
                    <IntegrationRow
                      key={provider.name}
                      name={provider.name}
                      configured={provider.isConfigured}
                      detail={provider.supportsPayouts ? 'Supports payouts' : 'Collections only'}
                    />
                  ))}
                </div>

                <ToggleRow
                  label="Online payments enabled"
                  description="Turn off to stop new checkout sessions being created."
                  checked={value('paymentsEnabled', data.paymentsEnabled)}
                  onChange={(checked) => set('paymentsEnabled', checked)}
                />
                <ToggleRow
                  label="Outgoing payouts enabled"
                  description="Controls whether remittances can be disbursed through the provider."
                  checked={value('payoutsEnabled', data.payoutsEnabled)}
                  onChange={(checked) => set('payoutsEnabled', checked)}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquare className="h-4 w-4" />
                  SMS provider
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Active provider">
                  <SelectField
                    value={value('activeSmsProvider', data.activeSmsProvider)}
                    onChange={(v) => set('activeSmsProvider', v)}
                    options={[
                      { value: 'TERMII', label: 'Termii' },
                      { value: 'TWILIO', label: 'Twilio' },
                      { value: 'MOCK', label: 'Mock (development)' },
                    ]}
                  />
                </Field>
                <div className="space-y-2">
                  {integrations.data?.sms.providers.map((provider) => (
                    <IntegrationRow
                      key={provider.name}
                      name={provider.name}
                      configured={provider.isConfigured}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Upload className="h-4 w-4" />
                  File storage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <IntegrationRow
                  name={integrations.data?.uploads.provider === 'cloudinary' ? 'CLOUDINARY' : 'LOCAL DISK'}
                  configured={integrations.data?.uploads.provider === 'cloudinary'}
                  detail={
                    integrations.data?.uploads.provider === 'cloudinary'
                      ? 'Receipts and photographs are stored on Cloudinary'
                      : 'Cloudinary is not configured — files are stored on the server disk'
                  }
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}

/** Stages an administrator can place in a transfer approval chain. */
const APPROVAL_STAGES = [
  { value: 'AREA_COORDINATOR', label: 'Area Coordinator' },
  { value: 'ZONAL_COORDINATOR', label: 'Zonal Coordinator' },
  { value: 'CHURCH_ADMIN', label: 'Church Administrator' },
];

/**
 * Builds one approval chain.
 *
 * Order is meaningful — a transfer moves through the stages left to right — so stages
 * can be reordered, and each may appear only once to avoid asking the same role twice.
 */
function ApprovalChainEditor({
  label,
  description,
  stages,
  onChange,
}: {
  label: string;
  description: string;
  stages: string[];
  onChange: (stages: string[]) => void;
}) {
  const available = APPROVAL_STAGES.filter((stage) => !stages.includes(stage.value));

  const move = (index: number, direction: -1 | 1) => {
    const next = [...stages];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  return (
    <div className="rounded-lg border p-4">
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>

      {stages.length === 0 ? (
        <p className="mt-3 rounded-md bg-warning/10 p-3 text-xs">
          No approval required — a transfer of this kind applies immediately on request.
        </p>
      ) : (
        <ol className="mt-3 space-y-2">
          {stages.map((stage, index) => (
            <li key={`${stage}-${index}`} className="flex items-center gap-2 rounded-md border p-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                {APPROVAL_STAGES.find((s) => s.value === stage)?.label ?? stage}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                aria-label={`Move ${stage} earlier`}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={index === stages.length - 1}
                onClick={() => move(index, 1)}
                aria-label={`Move ${stage} later`}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onChange(stages.filter((_, i) => i !== index))}
                aria-label={`Remove ${stage}`}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ol>
      )}

      {available.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {available.map((stage) => (
            <Button
              key={stage.value}
              variant="outline"
              size="sm"
              onClick={() => onChange([...stages, stage.value])}
            >
              <Plus className="h-4 w-4" />
              {stage.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function IntegrationRow({
  name,
  configured,
  detail,
}: {
  name: string;
  configured: boolean;
  detail?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{name}</p>
        {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
      </div>
      {configured ? (
        <Badge variant="success">
          <CheckCircle2 className="h-3 w-3" />
          Configured
        </Badge>
      ) : (
        <Badge variant="muted">
          <XCircle className="h-3 w-3" />
          Not configured
        </Badge>
      )}
    </div>
  );
}
