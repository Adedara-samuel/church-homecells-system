'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { KeyRound, ShieldBan, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { formatDate, humanise, initials } from '@/lib/utils';
import { usersService } from '@/services';
import { queryKeys, useApiMutation, useApiQuery } from '@/hooks/use-api';
import { ROLE_LABELS } from '@/components/layout/navigation';
import { Button } from '@/components/ui/button';
import { Badge, Input } from '@/components/ui/primitives';
import {
  Avatar,
  AvatarFallback,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlays';
import { StatusBadge } from '@/components/common/page';
import { DetailSkeleton, ErrorState } from '@/components/common/states';
import { ConfirmButton } from '@/components/common/filters';
import { Field } from '@/components/common/form';
import {
  Info,
  InfoCard,
  InfoGrid,
  RecordAuditTrail,
  RecordHeader,
  RecordLink,
} from '@/components/common/detail';

export default function UserDetailPage() {
  const params = useParams<{ id: string }>();
  const { can, user: currentUser } = useAuth();
  const id = params.id;
  const [resetOpen, setResetOpen] = React.useState(false);

  const { data: user, isLoading, isError, error, refetch } = useApiQuery(
    [...queryKeys.users, id],
    () => usersService.get(id),
  );

  const setStatus = useApiMutation(
    ({ status, reason }: { status: string; reason: string }) =>
      usersService.setStatus(id, status, reason || undefined),
    { successMessage: 'Account status updated', invalidates: [queryKeys.users] },
  );

  if (isLoading) return <DetailSkeleton />;
  if (isError || !user) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const isSelf = user._id === currentUser?.id;
  const scope =
    user.homecell?.name ?? user.area?.name ?? user.zone?.name ?? 'Church-wide (no restriction)';

  return (
    <>
      <RecordHeader
        backHref="/admin/users"
        backLabel="Users"
        title={`${user.firstName} ${user.lastName}`}
        subtitle={
          <>
            {user.email} · {ROLE_LABELS[user.role]}
          </>
        }
        status={<StatusBadge status={user.status} />}
        actions={
          <>
            {can('users.update') && (
              <Button variant="outline" onClick={() => setResetOpen(true)}>
                <KeyRound className="h-4 w-4" />
                Reset password
              </Button>
            )}
            {can('users.update') && !isSelf && (
              <ConfirmButton
                variant={user.status === 'ACTIVE' ? 'outline' : 'default'}
                title={
                  user.status === 'ACTIVE' ? 'Deactivate this account?' : 'Reactivate this account?'
                }
                description={
                  user.status === 'ACTIVE'
                    ? 'The user is signed out of every device immediately and cannot sign in again until reactivated.'
                    : 'The user will be able to sign in again with their existing password.'
                }
                confirmLabel={user.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                requireReason={user.status === 'ACTIVE'}
                reasonLabel="Reason for deactivation"
                onConfirm={(reason) =>
                  setStatus.mutateAsync({
                    status: user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
                    reason,
                  })
                }
                loading={setStatus.isPending}
              >
                {user.status === 'ACTIVE' ? (
                  <>
                    <ShieldBan className="h-4 w-4" />
                    Deactivate
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4" />
                    Reactivate
                  </>
                )}
              </ConfirmButton>
            )}
          </>
        }
      />

      {isSelf && (
        <div className="rounded-lg border border-primary/30 bg-accent/40 p-4 text-sm">
          This is your own account. Status changes are disabled to prevent locking yourself out —
          use <RecordLink href="/account">My account</RecordLink> to change your password.
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5">
          <InfoCard title="Profile">
            <div className="flex flex-col items-center gap-3 pb-4 text-center">
              <Avatar className="h-20 w-20">
                <AvatarFallback className="text-lg">
                  {initials(`${user.firstName} ${user.lastName}`)}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold">
                  {user.firstName} {user.lastName}
                </p>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
              <Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>
            </div>

            <InfoGrid columns={1}>
              <Info label="Phone">{user.phone}</Info>
              <Info label="Status">
                <StatusBadge status={user.status} />
              </Info>
              <Info label="Last sign-in">
                {user.lastLoginAt ? formatDate(user.lastLoginAt, true) : 'Never signed in'}
              </Info>
              <Info label="Account created">{formatDate(user.createdAt)}</Info>
              <Info label="Must change password">
                {user.mustChangePassword ? 'Yes — on next sign-in' : 'No'}
              </Info>
            </InfoGrid>
          </InfoCard>
        </div>

        <div className="space-y-5 lg:col-span-2">
          <InfoCard
            title="Organisational scope"
            description="The API restricts every request from this account to the unit below."
          >
            <InfoGrid>
              <Info label="Role">{ROLE_LABELS[user.role]}</Info>
              <Info label="Effective scope">{scope}</Info>
              <Info label="Zone">
                {user.zone?._id ? (
                  <RecordLink href={`/structure/zones/${user.zone._id}`}>
                    {user.zone.name}
                  </RecordLink>
                ) : (
                  user.zone?.name
                )}
              </Info>
              <Info label="Area">
                {user.area?._id ? (
                  <RecordLink href={`/structure/areas/${user.area._id}`}>
                    {user.area.name}
                  </RecordLink>
                ) : (
                  user.area?.name
                )}
              </Info>
              <Info label="Homecell">
                {user.homecell?._id ? (
                  <RecordLink href={`/structure/homecells/${user.homecell._id}`}>
                    {user.homecell.name}
                  </RecordLink>
                ) : (
                  user.homecell?.name
                )}
              </Info>
            </InfoGrid>
          </InfoCard>

          <InfoCard
            title="Permission overrides"
            description="Granted or revoked on top of the base permissions for this role."
          >
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Additional permissions
                </p>
                {user.extraPermissions.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {user.extraPermissions.map((permission) => (
                      <Badge key={permission} variant="success" className="font-mono text-[11px]">
                        + {permission}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">None — role defaults apply.</p>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Revoked permissions
                </p>
                {user.revokedPermissions.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {user.revokedPermissions.map((permission) => (
                      <Badge
                        key={permission}
                        variant="destructive"
                        className="font-mono text-[11px]"
                      >
                        − {permission}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">None.</p>
                )}
              </div>
            </div>
          </InfoCard>

          <RecordAuditTrail entityModel="User" entityId={user._id} canView={can('audit.view')} />
        </div>
      </div>

      <ResetPasswordDialog userId={id} open={resetOpen} onOpenChange={setResetOpen} />
    </>
  );
}

function ResetPasswordDialog({
  userId,
  open,
  onOpenChange,
}: {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [password, setPassword] = React.useState('');

  React.useEffect(() => {
    if (open) setPassword(generatePassword());
  }, [open]);

  const mutation = useApiMutation(() => usersService.resetPassword(userId, password, true), {
    successMessage: 'Password reset — the user must change it at next sign-in',
    invalidates: [queryKeys.users],
    onSuccess: () => onOpenChange(false),
  });

  const strong =
    password.length >= 10 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Every active session for this user is revoked, and they must set their own password at
            next sign-in.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field
            label="Temporary password"
            htmlFor="temp-password"
            required
            error={
              password && !strong
                ? 'Use at least 10 characters with upper and lower case, a digit and a symbol.'
                : undefined
            }
            hint="Copy this now and share it securely — it is not shown again."
          >
            <Input
              id="temp-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="font-mono"
            />
          </Field>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(password);
              toast.success('Password copied');
            }}
          >
            Copy password
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!strong}>
            Reset password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Random password that always satisfies the server's policy. */
function generatePassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*';
  const all = upper + lower + digits + symbols;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];

  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 14) chars.push(pick(all));

  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
