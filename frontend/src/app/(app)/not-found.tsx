'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LayoutDashboard, SearchX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/common/states';
import { PageHeader } from '@/components/common/page';

/**
 * 404 inside the authenticated shell, so the sidebar and navigation stay available.
 * Reached when a record id in the URL does not exist, or a path is mistyped.
 */
export default function AppNotFound() {
  const router = useRouter();

  return (
    <>
      <PageHeader
        title="Page not found"
        description="We could not find anything at this address."
      />
      <EmptyState
        icon={SearchX}
        title="This page does not exist"
        description="The link may be out of date, or the record it referred to may have been moved, reversed or removed. Everything else is still available from the navigation."
        action={
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4" />
              Go back
            </Button>
            <Button asChild>
              <Link href="/dashboard">
                <LayoutDashboard className="h-4 w-4" />
                Dashboard
              </Link>
            </Button>
          </div>
        }
      />
    </>
  );
}
