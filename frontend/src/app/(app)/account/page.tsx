'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { formatDate, initials } from '@/lib/utils';
import { ROLE_LABELS } from '@/components/layout/navigation';
import { Button } from '@/components/ui/button';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from '@/components/ui/primitives';
import { Avatar, AvatarFallback } from '@/components/ui/overlays';
import { DetailRow, PageHeader } from '@/components/common/page';
import { Field } from '@/components/common/form';

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: z
      .string()
      .min(10, 'Use at least 10 characters')
      .regex(/[a-z]/, 'Include a lowercase letter')
      .regex(/[A-Z]/, 'Include an uppercase letter')
      .regex(/\d/, 'Include a digit')
      .regex(/[^A-Za-z0-9]/, 'Include a symbol'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'The passwords do not match',
    path: ['confirmPassword'],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: 'Choose a password different from your current one',
    path: ['newPassword'],
  });

type PasswordValues = z.infer<typeof passwordSchema>;

export default function AccountPage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const forceChange = searchParams.get('forceChange') === '1' || user?.mustChangePassword;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema) });

  const onSubmit = async (values: PasswordValues) => {
    try {
      await api.post('/auth/change-password', values);
      reset();
      toast.success('Password changed', {
        description: 'You have been signed out of all devices. Please sign in again.',
      });
      // Every session is revoked server-side, so a fresh sign-in is required.
      setTimeout(() => void logout(), 1200);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : 'The password could not be changed.',
      );
    }
  };

  if (!user) return null;

  return (
    <>
      <PageHeader
        title="My account"
        description="Your profile, role and password."
      />

      {forceChange && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 p-4"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div>
            <p className="font-medium">Please set your own password</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This account is still using the password it was created with. Choose a new one before
              continuing.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <div className="flex flex-col items-center gap-3 text-center">
              <Avatar className="h-20 w-20">
                <AvatarFallback className="text-lg">{initials(user.fullName)}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-semibold">{user.fullName}</p>
                <p className="text-sm text-muted-foreground">{user.email}</p>
              </div>
              <Badge variant="secondary">{ROLE_LABELS[user.role]}</Badge>
            </div>

            <dl className="mt-6 space-y-4">
              <DetailRow label="Phone">{user.phone}</DetailRow>
              <DetailRow label="Access scope">{user.scopeLevel}</DetailRow>
              <DetailRow label="Last sign-in">
                {user.lastLoginAt ? formatDate(user.lastLoginAt, true) : 'This is your first session'}
              </DetailRow>
              <DetailRow label="Permissions">
                {user.permissions.length} granted
              </DetailRow>
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Change password</CardTitle>
            <CardDescription>
              Changing your password signs you out of every device, including this one.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="max-w-md space-y-4" noValidate>
              <Field
                label="Current password"
                htmlFor="currentPassword"
                required
                error={errors.currentPassword?.message}
              >
                <Input
                  id="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  {...register('currentPassword')}
                />
              </Field>
              <Field
                label="New password"
                htmlFor="newPassword"
                required
                error={errors.newPassword?.message}
                hint="At least 10 characters with upper and lower case, a digit and a symbol."
              >
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  {...register('newPassword')}
                />
              </Field>
              <Field
                label="Confirm new password"
                htmlFor="confirmPassword"
                required
                error={errors.confirmPassword?.message}
              >
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  {...register('confirmPassword')}
                />
              </Field>

              <div className="flex gap-2">
                <Button type="submit" loading={isSubmitting}>
                  <KeyRound className="h-4 w-4" />
                  Change password
                </Button>
                {!forceChange && (
                  <Button type="button" variant="outline" onClick={() => router.back()}>
                    Back
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your permissions</CardTitle>
          <CardDescription>
            These are enforced on the server for every request, not just in this interface.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {[...user.permissions].sort().map((permission) => (
              <Badge key={permission} variant="muted" className="font-mono text-[11px]">
                {permission}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
