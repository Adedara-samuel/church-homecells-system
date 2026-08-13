'use client';

import * as React from 'react';
import { AlertTriangle, Download, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { paymentsService } from '@/services';
import { ApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Shows the receipt for a settled payment inline, the moment it is available.
 *
 * The endpoint is authenticated, so the PDF cannot be pointed at with an `<iframe
 * src>` — the browser would send no Authorization header and get a 401. It is fetched
 * as a blob and shown from an object URL instead.
 *
 * Not every browser renders a PDF inline (iOS Safari in particular), so the download
 * and print actions sit outside the frame and work regardless of whether it displays.
 */
export function ReceiptPreview({
  reference,
  className,
}: {
  reference: string;
  className?: string;
}) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    (async () => {
      try {
        const blob = await paymentsService.receiptBlob(reference);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof ApiError && err.status === 409
            ? 'The receipt will be available as soon as the payment is confirmed.'
            : 'The receipt could not be loaded.',
        );
      }
    })();

    return () => {
      cancelled = true;
      // Object URLs pin the blob in memory until revoked.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [reference]);

  if (error) {
    return (
      <div className={cn('rounded-lg border border-warning/40 bg-warning/5 p-4 text-sm', className)}>
        <p className="flex items-center gap-2 text-muted-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
          {error}
        </p>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="overflow-hidden rounded-lg border bg-muted/30">
        {url ? (
          <iframe
            src={url}
            title={`Receipt ${reference}`}
            className="h-[460px] w-full"
            // The frame only ever renders our own generated PDF.
            sandbox="allow-same-origin"
          />
        ) : (
          <div className="flex h-[460px] items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Preparing your receipt…
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          className="flex-1"
          disabled={!url}
          onClick={async () => {
            try {
              await paymentsService.downloadReceipt(reference);
            } catch {
              toast.error('The receipt could not be downloaded.');
            }
          }}
        >
          <Download className="h-4 w-4" />
          Download receipt
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          disabled={!url}
          onClick={() => {
            // Opening in a tab gives the browser's own print and share controls,
            // which is more reliable than printing a cross-document iframe.
            if (url) window.open(url, '_blank', 'noopener');
          }}
        >
          <Printer className="h-4 w-4" />
          Open / print
        </Button>
      </div>
    </div>
  );
}
