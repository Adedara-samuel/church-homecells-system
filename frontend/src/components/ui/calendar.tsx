'use client';

import * as React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { cn } from '@/lib/utils';

/**
 * Calendar — react-day-picker styled with the application's own tokens.
 *
 * The month and year are dropdowns rather than arrows-only navigation: a date of
 * birth is thirty-odd years back, and nobody should tap "previous month" 400 times
 * to reach it. `startMonth` / `endMonth` bound those dropdowns and default to a
 * range wide enough for both birthdays and near-future scheduling.
 *
 * No stylesheet is imported from the package; every element is class-named here so
 * the calendar inherits light/dark theming from the same CSS variables as the rest
 * of the UI.
 */
export type CalendarProps = DayPickerProps;

const NAV_BUTTON =
  'inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40';

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  captionLayout = 'dropdown',
  startMonth,
  endMonth,
  ...props
}: CalendarProps) {
  const currentYear = new Date().getFullYear();

  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      captionLayout={captionLayout}
      startMonth={startMonth ?? new Date(currentYear - 100, 0)}
      endMonth={endMonth ?? new Date(currentYear + 5, 11)}
      className={cn('p-3', className)}
      classNames={{
        // `relative` anchors the absolutely positioned nav, which react-day-picker
        // renders as the first child of this element.
        months: 'relative flex flex-col gap-4 sm:flex-row',
        month: 'flex flex-col gap-4',
        month_caption: 'flex h-8 items-center justify-center px-8',
        caption_label: cn(
          'flex select-none items-center gap-1 text-sm font-medium',
          // With dropdowns the label is a visual shell for the invisible <select>.
          captionLayout === 'label' ? '' : 'h-8 rounded-md px-2 hover:bg-accent',
        ),
        dropdowns: 'flex items-center gap-1.5 text-sm font-medium',
        dropdown_root:
          'relative rounded-md border border-input bg-background transition-colors hover:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
        // The native select stays in the layout for keyboard and screen-reader use,
        // but is transparent so the styled label below shows through.
        dropdown: 'absolute inset-0 z-10 w-full cursor-pointer opacity-0',
        nav: 'absolute inset-x-0 top-0 z-20 flex items-center justify-between',
        button_previous: NAV_BUTTON,
        button_next: NAV_BUTTON,
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday:
          'w-9 rounded-md text-[0.7rem] font-medium uppercase tracking-wide text-muted-foreground',
        week: 'mt-1 flex w-full',
        day: 'h-9 w-9 p-0 text-center text-sm',
        day_button: cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-md p-0 font-normal transition-colors',
          'hover:bg-accent hover:text-accent-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          'disabled:pointer-events-none disabled:opacity-30 aria-selected:opacity-100',
        ),
        selected:
          '[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:shadow-sm [&>button]:hover:bg-primary [&>button]:hover:text-primary-foreground',
        today: '[&>button]:font-semibold [&>button]:text-primary [&>button]:ring-1 [&>button]:ring-inset [&>button]:ring-primary/40',
        outside: 'text-muted-foreground/50',
        disabled: 'text-muted-foreground/40',
        hidden: 'invisible',
        range_start:
          '[&>button]:rounded-r-none [&>button]:bg-primary [&>button]:text-primary-foreground',
        range_end:
          '[&>button]:rounded-l-none [&>button]:bg-primary [&>button]:text-primary-foreground',
        range_middle:
          'bg-accent [&>button]:rounded-none [&>button]:bg-transparent [&>button]:text-accent-foreground',
        footer: 'pt-3 text-center text-xs text-muted-foreground',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName, ...chevronProps }) => {
          const Icon =
            orientation === 'left' ? ChevronLeft : orientation === 'right' ? ChevronRight : ChevronDown;
          return (
            <Icon
              className={cn(orientation === 'down' ? 'h-4 w-4 opacity-60' : 'h-4 w-4', chevronClassName)}
              {...chevronProps}
            />
          );
        },
      }}
      {...props}
    />
  );
}
