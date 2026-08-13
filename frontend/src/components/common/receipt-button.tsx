'use client';

import * as React from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { paymentsService } from '@/services';
import { ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';

/**
 * Downloads the receipt for a settled online payment.
 *
 * One button for every kind of payment: the API resolves a remittance or dues payment
 * to its richer receipt and falls back to the general form, so nothing here needs to
 * know what the payment was for.
 *
 * It is only rendered for settled payments — the server refuses a receipt for anything
 * unsettled, because a document that looks like proof of a payment that has not
 * happened is worse than no document at all.
 */
export function PaymentReceiptButton({
  reference,
  variant = 'ghost',
  size = 'sm',
  label,
}: {
  reference: string;
  variant?: 'ghost' | 'outline' | 'default';
  size?: 'sm' | 'default' | 'lg';
  label?: string;
}) {
  const [downloading, setDownloading] = React.useState(false);

  return (
    <Button
      variant={variant}
      size={size}
      disabled={downloading}
      title="Download receipt"
      onClick={async (event) => {
        // Rows are often clickable; downloading must not also navigate.
        event.stopPropagation();
        setDownloading(true);
        try {
          await paymentsService.downloadReceipt(reference);
        } catch (err) {
          toast.error(
            err instanceof ApiError && err.status === 409
              ? 'This payment has not been confirmed yet, so no receipt can be issued.'
              : 'The receipt could not be downloaded.',
          );
        } finally {
          setDownloading(false);
        }
      }}
    >
      {downloading ? <Loader2 className="animate-spin" /> : <Download className="h-4 w-4" />}
      {label}
    </Button>
  );
}
