'use client';

import * as React from 'react';
import { Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LogoMark } from '@/components/brand/logo';

/**
 * Branded loading screen.
 *
 * Rather than an anonymous spinner, this narrates what the application is actually
 * doing — restoring the session, loading the church configuration, resolving the
 * user's organisational scope. Each stage is a real step in the boot sequence, so a
 * slow step tells the user (and support) where the delay is.
 */
export type BootStage =
  | 'connecting'
  | 'session'
  | 'configuration'
  | 'scope'
  | 'ready';

const STAGES: { key: BootStage; label: string; detail: string }[] = [
  {
    key: 'connecting',
    label: 'Reaching the server',
    detail: 'Opening a secure connection to the church API',
  },
  {
    key: 'session',
    label: 'Restoring your session',
    detail: 'Verifying your access token',
  },
  {
    key: 'configuration',
    label: 'Loading church configuration',
    detail: 'Currency, thresholds, approval chains and message templates',
  },
  {
    key: 'scope',
    label: 'Resolving your access',
    detail: 'Working out which zones, areas and homecells you can see',
  },
];

const STAGE_ORDER: BootStage[] = ['connecting', 'session', 'configuration', 'scope', 'ready'];

export interface SplashScreenProps {
  stage: BootStage;
  churchName?: string;
  /** Shown instead of the stage list when something has gone wrong. */
  error?: string | null;
  onRetry?: () => void;
}

export function SplashScreen({ stage, churchName, error, onRetry }: SplashScreenProps) {
  const currentIndex = STAGE_ORDER.indexOf(stage);
  const progress = Math.round((currentIndex / (STAGE_ORDER.length - 1)) * 100);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-background px-4">
      {/* Soft, slowly drifting background wash — motion without distraction. */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl motion-safe:animate-drift-slow" />
        <div className="absolute -bottom-24 -right-16 h-80 w-80 rounded-full bg-chart-4/10 blur-3xl motion-safe:animate-drift-slower" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Emblem */}
        <div className="flex flex-col items-center text-center">
          <div className="relative">
            {/* Two concentric rings expanding outward, like a slow pulse. */}
            <span
              aria-hidden
              className="absolute inset-2 rounded-full bg-primary/15 motion-safe:animate-halo"
            />
            <span
              aria-hidden
              className="absolute inset-2 rounded-full bg-[#C9A227]/15 motion-safe:animate-halo [animation-delay:1s]"
            />
            <LogoMark
              className="relative h-20 w-20"
              navy="hsl(var(--primary))"
              gold="#C9A227"
            />
          </div>

          <h1 className="mt-4 text-xl font-semibold tracking-tight motion-safe:animate-rise">
            Homecell<span className="text-[#C9A227]">MS</span>
          </h1>
          <p
            className="mt-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground motion-safe:animate-rise"
            style={{ animationDelay: '80ms' }}
          >
            {churchName ?? 'Church Homecell Management System'}
          </p>
          <p
            className="mt-3 text-sm text-muted-foreground motion-safe:animate-rise"
            style={{ animationDelay: '140ms' }}
          >
            {error ? 'We could not finish loading' : 'Connecting & equipping the body'}
          </p>
        </div>

        {/* Progress rail */}
        <div className="mt-8">
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full transition-[width] duration-700 ease-out',
                error ? 'bg-destructive' : 'bg-primary',
              )}
              style={{ width: `${error ? 100 : Math.max(progress, 8)}%` }}
            />
          </div>
        </div>

        {/* Stage list */}
        {error ? (
          <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-3 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
              >
                Try again
              </button>
            )}
          </div>
        ) : (
          <ol className="mt-6 space-y-3">
            {STAGES.map((item, index) => {
              const done = index < currentIndex;
              const active = index === currentIndex;

              return (
                <li
                  key={item.key}
                  className={cn(
                    'flex items-start gap-3 transition-opacity duration-500 motion-safe:animate-rise',
                    !done && !active && 'opacity-40',
                  )}
                  style={{ animationDelay: `${index * 90 + 180}ms` }}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors',
                      done && 'border-success bg-success text-success-foreground',
                      active && 'border-primary text-primary',
                      !done && !active && 'border-muted-foreground/30',
                    )}
                  >
                    {done ? (
                      <Check className="h-3 w-3" strokeWidth={3} />
                    ) : active ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : null}
                  </span>
                  <div className="min-w-0">
                    <p className={cn('text-sm', (done || active) && 'font-medium')}>{item.label}</p>
                    {active && (
                      <p className="text-xs text-muted-foreground">{item.detail}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Zone · Area · Homecell · Members
        </p>
      </div>
    </div>
  );
}

/**
 * Advances through the boot stages while the real work happens.
 *
 * The stage is driven by genuine signals where they exist (`isLoading` finishing,
 * settings arriving); the intermediate steps advance on a short timer so the sequence
 * reads smoothly rather than snapping from 0 to 100 on a fast connection.
 */
export function useBootStage({
  authResolved,
  configurationResolved,
}: {
  authResolved: boolean;
  configurationResolved: boolean;
}): BootStage {
  const [stage, setStage] = React.useState<BootStage>('connecting');

  React.useEffect(() => {
    // Give the first stage a beat so it is legible rather than a flash.
    const timer = setTimeout(() => {
      setStage((current) => (current === 'connecting' ? 'session' : current));
    }, 350);
    return () => clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    if (!authResolved) return;
    setStage('configuration');
    const timer = setTimeout(() => setStage('scope'), 300);
    return () => clearTimeout(timer);
  }, [authResolved]);

  React.useEffect(() => {
    if (!authResolved || !configurationResolved) return;
    const timer = setTimeout(() => setStage('ready'), 250);
    return () => clearTimeout(timer);
  }, [authResolved, configurationResolved]);

  return stage;
}
