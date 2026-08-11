'use client';

import * as React from 'react';
import { Clock, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';

/**
 * Time picker — three snap-scrolling columns (hour, minute, AM/PM) in a popover.
 *
 * The value is always a 24-hour `HH:mm` string, which is what an API stores and sorts
 * cleanly; the 12-hour AM/PM presentation is display-only and controlled by `hour12`.
 * `<input type="time">` is replaced for the same reason as the date input: its widget
 * is drawn by the browser and cannot be themed or made consistent across platforms.
 */

function parseTime(value: string | undefined): { hour: number; minute: number } | undefined {
  if (!value) return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  return { hour, minute };
}

const pad = (value: number) => String(value).padStart(2, '0');

export function formatTime(value: string | undefined, hour12 = true): string {
  const parsed = parseTime(value);
  if (!parsed) return '';
  if (!hour12) return `${pad(parsed.hour)}:${pad(parsed.minute)}`;
  const period = parsed.hour < 12 ? 'AM' : 'PM';
  const hour = parsed.hour % 12 === 0 ? 12 : parsed.hour % 12;
  return `${hour}:${pad(parsed.minute)} ${period}`;
}

/** One scrolling column. Kept local — nothing else needs this shape. */
function Column({
  options,
  value,
  onSelect,
  label,
}: {
  options: { value: number | string; label: string }[];
  value: number | string | undefined;
  onSelect: (value: number | string) => void;
  label: string;
}) {
  const selectedRef = React.useRef<HTMLButtonElement>(null);

  // Opens with the current choice in view rather than at the top of the list.
  React.useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'center' });
  }, []);

  return (
    <div className="flex flex-col" role="group" aria-label={label}>
      <div className="px-2 pb-1 text-center text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="h-52 overflow-y-auto scroll-smooth px-1 [scrollbar-width:thin]">
        <div className="flex flex-col gap-0.5 pb-24">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                ref={isSelected ? selectedRef : undefined}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(option.value)}
                className={cn(
                  'w-12 rounded-md px-2 py-1.5 text-center text-sm tabular-nums transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isSelected
                    ? 'bg-primary font-medium text-primary-foreground'
                    : 'hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export interface TimePickerProps {
  /** 24-hour `HH:mm`, or empty/undefined for no selection. */
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  /** Minutes offered in the middle column: 5 gives :00, :05, :10 … */
  minuteStep?: number;
  /** Display only — the stored value stays 24-hour. */
  hour12?: boolean;
  placeholder?: string;
  clearable?: boolean;
  id?: string;
  name?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  onBlur?: () => void;
}

export function TimePicker({
  value,
  onChange,
  minuteStep = 5,
  hour12 = true,
  placeholder = 'Select a time',
  clearable = true,
  id,
  name,
  disabled,
  invalid,
  className,
  onBlur,
}: TimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const parsed = parseTime(value);

  // Editing one column must not clear the others, so an unset field starts from a
  // sensible whole hour instead of forcing all three to be chosen in order.
  const current = parsed ?? { hour: 9, minute: 0 };
  const period: 'AM' | 'PM' = current.hour < 12 ? 'AM' : 'PM';
  const displayHour = current.hour % 12 === 0 ? 12 : current.hour % 12;

  const emit = (hour: number, minute: number) => onChange(`${pad(hour)}:${pad(minute)}`);

  const hourOptions = hour12
    ? Array.from({ length: 12 }, (_, index) => {
        const hour = index + 1;
        return { value: hour, label: String(hour) };
      })
    : Array.from({ length: 24 }, (_, hour) => ({ value: hour, label: pad(hour) }));

  const minuteOptions = Array.from(
    { length: Math.ceil(60 / minuteStep) },
    (_, index) => index * minuteStep,
  ).map((minute) => ({ value: minute, label: pad(minute) }));

  const handleHour = (next: number | string) => {
    const hour = Number(next);
    emit(hour12 ? (hour % 12) + (period === 'PM' ? 12 : 0) : hour, current.minute);
  };

  const handlePeriod = (next: number | string) => {
    const hour24 = next === 'PM' ? (current.hour % 12) + 12 : current.hour % 12;
    emit(hour24, current.minute);
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
              clearable && parsed ? 'pr-9' : '',
              !parsed && 'text-muted-foreground',
            )}
          >
            <Clock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{parsed ? formatTime(value, hour12) : placeholder}</span>
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-auto p-2" align="start">
          <div className="flex divide-x">
            <Column
              label="Hour"
              options={hourOptions}
              value={hour12 ? displayHour : current.hour}
              onSelect={handleHour}
            />
            <Column
              label="Min"
              options={minuteOptions}
              value={current.minute}
              onSelect={(next) => emit(current.hour, Number(next))}
            />
            {hour12 && (
              <Column
                label="AM/PM"
                options={[
                  { value: 'AM', label: 'AM' },
                  { value: 'PM', label: 'PM' },
                ]}
                value={period}
                onSelect={handlePeriod}
              />
            )}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-accent"
              onClick={() => {
                const now = new Date();
                // Snapped to the grid, otherwise "Now" selects a minute the column
                // does not offer and nothing looks selected.
                const minute = Math.round(now.getMinutes() / minuteStep) * minuteStep;
                const rollover = minute >= 60;
                emit((now.getHours() + (rollover ? 1 : 0)) % 24, rollover ? 0 : minute);
              }}
            >
              Now
            </button>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent"
              onClick={() => {
                onChange(undefined);
                setOpen(false);
              }}
            >
              Clear
            </button>
          </div>
        </PopoverContent>
      </Popover>

      {clearable && parsed && !disabled && (
        <button
          type="button"
          aria-label="Clear time"
          onClick={() => {
            onChange(undefined);
            onBlur?.();
          }}
          className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {name && <input type="hidden" name={name} value={value ?? ''} readOnly />}
    </div>
  );
}
