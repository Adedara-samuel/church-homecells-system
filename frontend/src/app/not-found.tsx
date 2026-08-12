import Link from 'next/link';
import { ArrowLeft, LayoutDashboard, SearchX } from 'lucide-react';

/**
 * Root 404.
 *
 * Reached only for a URL outside the authenticated shell, so it deliberately avoids
 * the sidebar and offers a way back into the application instead.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
          <SearchX className="h-8 w-8 text-muted-foreground" />
        </div>

        <p className="mt-6 text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Error 404
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">This page does not exist</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The address may have been mistyped, or the record it pointed to may have been moved or
          removed.
        </p>

        <div className="mt-8 flex flex-col justify-center gap-2 sm:flex-row">
          <Link
            href="/dashboard"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <LayoutDashboard className="h-4 w-4" />
            Go to dashboard
          </Link>
          <Link
            href="/login"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm font-medium transition-colors hover:bg-accent"
          >
            <ArrowLeft className="h-4 w-4" />
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
