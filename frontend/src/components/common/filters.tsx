'use client';

import * as React from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { areasService, homecellsService, zonesService } from '@/services';
import { queryKeys } from '@/hooks/use-api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Input, Label } from '@/components/ui/primitives';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/overlays';

/** Radix Select cannot hold an empty string, so "no filter" needs a sentinel. */
export const ALL = 'ALL';

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  placeholder = 'All',
  disabled,
  className,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select
        value={value ?? ALL}
        onValueChange={(next) => onChange(next === ALL ? undefined : next)}
        disabled={disabled}
      >
        <SelectTrigger className="h-9">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{placeholder}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function DateFilter({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="date"
        className="h-9"
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    </div>
  );
}

/**
 * Cascading Zone → Area → Homecell selector.
 *
 * The lists come from `/options` endpoints that are already scope-filtered by the API,
 * so a coordinator only ever sees units they are allowed to work with. Choosing a Zone
 * clears the Area and Homecell below it, preventing impossible combinations.
 */
export function OrgFilters({
  zoneId,
  areaId,
  homecellId,
  onChange,
  show = ['zone', 'area', 'homecell'],
  className,
}: {
  zoneId?: string;
  areaId?: string;
  homecellId?: string;
  onChange: (key: 'zoneId' | 'areaId' | 'homecellId', value: string | undefined) => void;
  show?: ('zone' | 'area' | 'homecell')[];
  className?: string;
}) {
  const zones = useQuery({
    queryKey: [...queryKeys.zones, 'options'],
    queryFn: zonesService.options,
    enabled: show.includes('zone'),
  });

  const areas = useQuery({
    queryKey: [...queryKeys.areas, 'options', zoneId ?? 'all'],
    queryFn: () => areasService.options(zoneId),
    enabled: show.includes('area'),
  });

  const homecells = useQuery({
    queryKey: [...queryKeys.homecells, 'options', zoneId ?? 'all', areaId ?? 'all'],
    queryFn: () => homecellsService.options({ zoneId, areaId }),
    enabled: show.includes('homecell'),
  });

  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {show.includes('zone') && (
        <FilterSelect
          label="Zone"
          placeholder="All zones"
          value={zoneId}
          onChange={(value) => {
            onChange('zoneId', value);
            onChange('areaId', undefined);
            onChange('homecellId', undefined);
          }}
          options={(zones.data ?? []).map((zone) => ({
            value: zone._id,
            label: `${zone.name} (${zone.code})`,
          }))}
        />
      )}
      {show.includes('area') && (
        <FilterSelect
          label="Area"
          placeholder="All areas"
          value={areaId}
          onChange={(value) => {
            onChange('areaId', value);
            onChange('homecellId', undefined);
          }}
          options={(areas.data ?? []).map((area) => ({
            value: area._id,
            label: `${area.name} (${area.code})`,
          }))}
        />
      )}
      {show.includes('homecell') && (
        <FilterSelect
          label="Homecell"
          placeholder="All homecells"
          value={homecellId}
          onChange={(value) => onChange('homecellId', value)}
          options={(homecells.data ?? []).map((homecell) => ({
            value: homecell._id,
            label: `${homecell.name} (${homecell.code})`,
          }))}
        />
      )}
    </div>
  );
}

/**
 * Search plus a collapsible filter drawer.
 * Filters stay out of the way on a phone but are one tap from the toolbar.
 */
export function FilterBar({
  search,
  onSearchChange,
  searchPlaceholder = 'Search…',
  activeFilterCount = 0,
  onReset,
  children,
  actions,
}: {
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  activeFilterCount?: number;
  onReset?: () => void;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {onSearchChange && (
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search ?? ''}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder={searchPlaceholder}
              className="pl-9"
              aria-label={searchPlaceholder}
            />
          </div>
        )}

        <div className="flex items-center gap-2">
          {children && (
            <Button
              variant="outline"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 && (
                <Badge variant="default" className="ml-1">
                  {activeFilterCount}
                </Badge>
              )}
            </Button>
          )}
          {actions}
        </div>
      </div>

      {open && children && (
        <div className="rounded-lg border bg-card p-4">
          {children}
          {onReset && activeFilterCount > 0 && (
            <div className="mt-3 flex justify-end">
              <Button variant="ghost" size="sm" onClick={onReset}>
                <X className="h-4 w-4" />
                Clear filters
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Confirmation dialog trigger for destructive or financially significant actions. */
export function ConfirmButton({
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  requireReason,
  reasonLabel = 'Reason',
  variant = 'default',
  size,
  disabled,
  loading,
  children,
}: {
  /** The return value is ignored; the dialog simply awaits it before closing. */
  onConfirm: (reason: string) => unknown;
  title: string;
  description: string;
  confirmLabel?: string;
  requireReason?: boolean;
  reasonLabel?: string;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'success';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  disabled?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  const canSubmit = !requireReason || reason.trim().length >= 5;

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onConfirm(reason.trim());
      setOpen(false);
      setReason('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        loading={loading}
        onClick={() => setOpen(true)}
      >
        {children}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-hidden />
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="relative w-full max-w-md rounded-t-xl border bg-background p-6 shadow-lg sm:rounded-xl"
          >
            <h2 id="confirm-title" className="text-lg font-semibold">
              {title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>

            {requireReason && (
              <div className="mt-4 space-y-1.5">
                <Label htmlFor="confirm-reason">{reasonLabel}</Label>
                <Input
                  id="confirm-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Explain why — this is recorded in the audit trail"
                  autoFocus
                />
                {reason.length > 0 && reason.trim().length < 5 && (
                  <p className="text-xs text-destructive">Please give at least 5 characters.</p>
                )}
              </div>
            )}

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant={variant === 'outline' ? 'default' : variant}
                onClick={() => void handleConfirm()}
                disabled={!canSubmit}
                loading={submitting}
              >
                {confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
