'use client';

import * as React from 'react';
import { CalendarDays, X } from 'lucide-react';
import type { Matcher } from 'react-day-picker';
import { cn, formatDate, toDateInput } from '@/lib/utils';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';

/**
 * Date picker built on the Calendar, speaking the `YYYY-MM-DD` strings that every
 * form, API filter and Zod schema in this app already use.
 *
 * It replaces `<input type="date">`, whose control is rendered by the browser: Chrome,
 * Safari and Firefox each draw a different widget, none of them themeable, and on
 * desktop Safari there is no picker at all. This one looks identical everywhere and
 * in both colour themes.
 */

/**
 * `YYYY-MM-DD` is parsed as *local* midnight. `new Date('2026-08-11')` is parsed as
 * UTC, which lands on the previous day for anyone west of Greenwich — the classic
 * "birthday is one day early" bug. Serialisation goes back through `toDateInput`,
 * which is local-time too.
 */
function parseDateInput(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export interface DatePickerProps {
  /** `YYYY-MM-DD`, or empty/undefined for no selection. */
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  /** Earliest and latest selectable day, both `YYYY-MM-DD`. */
  min?: string;
  max?: string;
  /** Extra unselectable days — e.g. `{ dayOfWeek: [1, 2, 3, 4, 5, 6] }` for Sundays only. */
  disabledDates?: Matcher | Matcher[];
  placeholder?: string;
  /** Shows an inline clear button once a date is chosen. */
  clearable?: boolean;
  /** "Today" shortcut in the popover footer; hidden when today is out of range. */
  showToday?: boolean;
  id?: string;
  name?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  /** Fired when the popover closes, so react-hook-form can mark the field touched. */
  onBlur?: () => void;
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  disabledDates,
  placeholder = 'Select a date',
  clearable = true,
  showToday = true,
  id,
  name,
  disabled,
  invalid,
  className,
  onBlur,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);

  const selected = parseDateInput(value);
  const minDate = parseDateInput(min);
  const maxDate = parseDateInput(max);

  const matchers: Matcher[] = [];
  if (minDate) matchers.push({ before: minDate });
  if (maxDate) matchers.push({ after: maxDate });
  if (Array.isArray(disabledDates)) matchers.push(...disabledDates);
  else if (disabledDates) matchers.push(disabledDates);

  const today = new Date();
  const todayInput = toDateInput(today);
  const todayAllowed =
    showToday && (!min || todayInput >= min) && (!max || todayInput <= max);

  const commit = (next: Date | undefined) => {
    onChange(next ? toDateInput(next) : undefined);
    setOpen(false);
    onBlur?.();
  };

  return (
    <div className={cn('relative', className)}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) onBlur?.();
        }}
      >
        <PopoverTrigger asChild>
          {/* `aria-invalid` is a global ARIA state, valid on any element; the lint
              rule's per-role allow-list is out of date. */}
          {/* eslint-disable-next-line jsx-a11y/role-supports-aria-props */}
          <button
            type="button"
            id={id}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            className={cn(
              'flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors',
              'hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:ring-destructive',
              // Room for the clear button so a long date never sits underneath it.
              clearable && selected ? 'pr-9' : '',
              !selected && 'text-muted-foreground',
            )}
          >
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{selected ? formatDate(selected) : placeholder}</span>
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? maxDate ?? today}
            onSelect={commit}
            disabled={matchers.length ? matchers : undefined}
            startMonth={minDate}
            endMonth={maxDate}
            autoFocus
          />
          {(todayAllowed || (clearable && selected)) && (
            <div className="flex items-center justify-between gap-2 border-t p-2">
              {todayAllowed ? (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-accent"
                  onClick={() => commit(today)}
                >
                  Today
                </button>
              ) : (
                <span />
              )}
              {clearable && selected && (
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
                  onClick={() => commit(undefined)}
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>

      {/* Outside the trigger: a button inside a button is invalid HTML and breaks
          keyboard navigation. */}
      {clearable && selected && !disabled && (
        <button
          type="button"
          aria-label="Clear date"
          onClick={() => {
            onChange(undefined);
            onBlur?.();
          }}
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Keeps the value in the DOM for non-JS form serialisation and E2E selectors. */}
      {name && <input type="hidden" name={name} value={value ?? ''} readOnly />}
    </div>
  );
}
