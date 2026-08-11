'use client';

import * as React from 'react';
import { Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { uploadsService } from '@/services';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/primitives';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlays';

/** Label + control + error, so every form field in the app is spaced identically. */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        )}
      </Label>
      {children}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-4 rounded-lg border bg-card p-5', className)}>
      <div className="space-y-1">
        <h2 className="font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Uncontrolled-friendly select for use with React Hook Form's `setValue`. */
export function SelectField({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  disabled,
  id,
}: {
  value: string | undefined;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <Select value={value ?? ''} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * File upload to Cloudinary (or the local fallback when Cloudinary is unconfigured).
 *
 * The file is validated for size in the browser for a fast response, and again by
 * content sniffing on the server — the client check is convenience, not security.
 */
export function FileUploadField({
  value,
  onChange,
  folder,
  accept = 'image/jpeg,image/png,image/webp,application/pdf',
  maxSizeMb = 5,
  label = 'Upload file',
  className,
}: {
  value: { url: string; publicId: string } | null;
  onChange: (value: { url: string; publicId: string } | null) => void;
  folder: 'members' | 'receipts' | 'documents';
  accept?: string;
  maxSizeMb?: number;
  label?: string;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);

  const handleFile = async (file: File) => {
    if (file.size > maxSizeMb * 1024 * 1024) {
      toast.error(`The file is larger than the ${maxSizeMb}MB limit.`);
      return;
    }
    setUploading(true);
    try {
      const result = await uploadsService.upload(file, folder);
      onChange({ url: result.url, publicId: result.publicId });
      toast.success('File uploaded');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'The upload failed.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const isImage = value?.url && !/\.pdf($|\?)/i.test(value.url);

  return (
    <div className={cn('space-y-2', className)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {value ? (
        <div className="flex items-center gap-3 rounded-md border p-3">
          {isImage ? (
            // Cloudinary and local URLs are both remote to Next's optimiser, and the
            // preview is incidental, so a plain <img> avoids the config overhead.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value.url}
              alt="Uploaded file preview"
              className="h-14 w-14 rounded object-cover"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded bg-muted text-xs font-medium">
              PDF
            </div>
          )}
          <div className="min-w-0 flex-1">
            <a
              href={value.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-sm text-primary hover:underline"
            >
              View uploaded file
            </a>
            <p className="truncate text-xs text-muted-foreground">{value.publicId}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(null)}
            aria-label="Remove file"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          loading={uploading}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="h-4 w-4" />
          {label}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        JPG, PNG, WebP or PDF · up to {maxSizeMb}MB
      </p>
    </div>
  );
}

/** Amount input that keeps the currency symbol visible while typing. */
export function MoneyInput({
  currency = '₦',
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { currency?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        {currency}
      </span>
      <Input
        type="number"
        step="0.01"
        min="0"
        inputMode="decimal"
        className={cn('pl-8 tabular', className)}
        {...props}
      />
    </div>
  );
}
