'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { settingsService } from '@/services';
import { queryKeys } from '@/hooks/use-api';
import { AppShell } from '@/components/layout/app-shell';
import { SplashScreen, useBootStage } from '@/components/common/splash';

/**
 * Client-side route guard and boot sequence.
 *
 * The redirect here is for user experience, not security: every API call is authorised
 * independently on the server, so an unauthenticated user who reaches a page sees
 * erroring panels rather than data.
 */
function Guard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  // Church configuration is needed by nearly every screen (currency, thresholds), so
  // it is fetched once during boot and shared from the cache thereafter.
  const settings = useQuery({
    queryKey: [...queryKeys.settings],
    queryFn: settingsService.get,
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });

  const stage = useBootStage({
    authResolved: !isLoading,
    configurationResolved: !isAuthenticated || settings.isFetched,
  });

  React.useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      // Read the query string from the browser rather than `useSearchParams`, so this
      // layout does not opt every page beneath it out of static rendering.
      const search = typeof window !== 'undefined' ? window.location.search : '';
      router.replace(`/login?next=${encodeURIComponent(`${pathname}${search}`)}`);
      return;
    }

    // A seeded or administrator-created account must set its own password first.
    if (user?.mustChangePassword && pathname !== '/account') {
      router.replace('/account?forceChange=1');
    }
  }, [isAuthenticated, isLoading, user, pathname, router]);

  if (isLoading || !isAuthenticated || stage !== 'ready') {
    return <SplashScreen stage={stage} churchName={settings.data?.churchName} />;
  }

  return <AppShell>{children}</AppShell>;
}

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  // Several pages beneath this layout read search parameters; a boundary here lets
  // each of them bail out to client rendering without failing the build.
  return (
    <React.Suspense fallback={<SplashScreen stage="connecting" />}>
      <Guard>{children}</Guard>
    </React.Suspense>
  );
}
