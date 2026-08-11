'use client';

import * as React from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { AppShell, AppShellSkeleton } from '@/components/layout/app-shell';

/**
 * Client-side route guard.
 *
 * This is a redirect for user experience, not a security boundary: every API call is
 * authorised independently on the server, so an unauthenticated user who reaches a
 * page here simply sees empty, erroring panels rather than data.
 */
function Guard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      // The query string is read from the browser rather than `useSearchParams`, so
      // this layout does not force every page beneath it out of static rendering.
      const search = typeof window !== 'undefined' ? window.location.search : '';
      router.replace(`/login?next=${encodeURIComponent(`${pathname}${search}`)}`);
      return;
    }

    // A seeded or administrator-created account must set its own password first.
    if (user?.mustChangePassword && pathname !== '/account') {
      router.replace('/account?forceChange=1');
    }
  }, [isAuthenticated, isLoading, user, pathname, router]);

  if (isLoading || !isAuthenticated) return <AppShellSkeleton />;

  return <AppShell>{children}</AppShell>;
}

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  // Several pages beneath this layout read search parameters; a boundary here means
  // each of them can bail out to client rendering without failing the build.
  return (
    <React.Suspense fallback={<AppShellSkeleton />}>
      <Guard>{children}</Guard>
    </React.Suspense>
  );
}
