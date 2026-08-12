'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, LayoutDashboard, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/common/page';

/**
 * Error boundary for the authenticated area.
 *
 * Catches a render-time failure in any page so the whole application does not go
 * blank. The digest is Next.js's server-side error identifier — quoting it lets an
 * administrator find the matching entry in the server logs.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    // Surfaced in the browser console for whoever is debugging.
    console.error('Unhandled error in the application shell:', error);
  }, [error]);

  return (
    <>
      <PageHeader title="Something went wrong" description="This screen could not be displayed." />

      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-14 text-center">
        <div className="rounded-full bg-destructive/10 p-3">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>

        <div className="space-y-1">
          <p className="font-medium">An unexpected error occurred</p>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Your data is safe — nothing was saved or changed by this failure. Try again, and if it
            keeps happening, quote the reference below to your administrator.
          </p>
          {error.digest && (
            <p className="pt-1 font-mono text-xs text-muted-foreground/80">
              Reference: {error.digest}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={reset}>
            <RefreshCw className="h-4 w-4" />
            Try again
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard">
              <LayoutDashboard className="h-4 w-4" />
              Back to dashboard
            </Link>
          </Button>
        </div>
      </div>
    </>
  );
}
