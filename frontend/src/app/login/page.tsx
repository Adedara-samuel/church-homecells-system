'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AlertCircle, Eye, EyeOff } from 'lucide-react';
import { LogoStacked } from '@/components/brand/logo';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/primitives';

const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(3, 'Enter your email address or phone number'),
  password: z.string().min(1, 'Enter your password'),
});

type LoginValues = z.infer<typeof loginSchema>;

/** `useSearchParams` needs a boundary so the shell can still be prerendered. */
export default function LoginPage() {
  return (
    <React.Suspense fallback={<LoginFallback />}>
      <LoginForm />
    </React.Suspense>
  );
}

function LoginFallback() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-[420px] space-y-4">
        <div className="mx-auto h-14 w-14 animate-pulse rounded-xl bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    </main>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, isAuthenticated, isLoading } = useAuth();

  const [showPassword, setShowPassword] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: '', password: '' },
  });

  // Someone already signed in should never be looking at this page.
  React.useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(searchParams.get('next') || '/dashboard');
    }
  }, [isAuthenticated, isLoading, router, searchParams]);

  const onSubmit = async (values: LoginValues) => {
    setFormError(null);
    try {
      const user = await login(values.identifier, values.password);
      toast.success(`Welcome back, ${user.firstName}`);
      router.replace(
        user.mustChangePassword ? '/account?forceChange=1' : searchParams.get('next') || '/dashboard',
      );
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : 'Sign-in failed. Please check your connection and try again.',
      );
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 motion-safe:animate-rise">
          <LogoStacked />
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Sign in to continue to your dashboard
          </p>
        </div>

        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
            {formError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="identifier">Email address or phone number</Label>
              <Input
                id="identifier"
                autoComplete="username"
                inputMode="email"
                placeholder="you@church.org"
                aria-invalid={Boolean(errors.identifier)}
                aria-describedby={errors.identifier ? 'identifier-error' : undefined}
                {...register('identifier')}
              />
              {errors.identifier && (
                <p id="identifier-error" className="text-xs text-destructive">
                  {errors.identifier.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  className="pr-11"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  {...register('password')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-1 top-1 rounded-md p-2 text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && (
                <p id="password-error" className="text-xs text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>

            <Button type="submit" className="w-full" loading={isSubmitting}>
              Sign in
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Access is restricted to authorised church personnel. All activity is logged.
        </p>
      </div>
    </main>
  );
}
