import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: '₦',
  USD: '$',
  GBP: '£',
  EUR: '€',
};

/** Formats a **minor-unit** amount (kobo) for display. */
export function formatMinor(minor: number | null | undefined, currency = 'NGN'): string {
  if (minor === null || minor === undefined || Number.isNaN(minor)) return '—';
  return formatMoney(minor / 100, currency);
}

/** Formats a **major-unit** amount (naira) for display. */
export function formatMoney(amount: number | null | undefined, currency = 'NGN'): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return '—';
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  return `${symbol}${amount.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Compact form for chart axes and dense KPI tiles. */
export function formatCompactMoney(amount: number, currency = 'NGN'): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? '';
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `${symbol}${(amount / 1_000_000_000).toFixed(1)}b`;
  if (abs >= 1_000_000) return `${symbol}${(amount / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${symbol}${(amount / 1_000).toFixed(0)}k`;
  return `${symbol}${amount.toFixed(0)}`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-NG');
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatDate(value: string | Date | null | undefined, withTime = false): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-NG', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

/** "3 days ago" / "in 2 hours" — used in activity feeds and notification lists. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / 60_000);

  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
  ];

  let value_ = diffMinutes;
  let unit: Intl.RelativeTimeFormatUnit = 'minute';
  for (const [nextUnit, divisor] of units) {
    if (Math.abs(value_) < divisor) {
      unit = nextUnit;
      break;
    }
    value_ = Math.round(value_ / divisor);
    unit = nextUnit;
  }
  return formatter.format(value_, unit);
}

/** Turns `PENDING_APPROVAL` into `Pending approval` for display. */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  const spaced = value.replace(/_/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function age(dateOfBirth: string | Date | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const dob = typeof dateOfBirth === 'string' ? new Date(dateOfBirth) : dateOfBirth;
  if (Number.isNaN(dob.getTime())) return null;
  const diff = Date.now() - dob.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}

/** `YYYY-MM-DD` in local time — the format every date input and API filter expects. */
export function toDateInput(value: Date | string = new Date()): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

/** Most recent past (or today's) occurrence of a weekday: 0 = Sunday. */
export function mostRecentWeekday(weekday: number, from: Date = new Date()): string {
  const date = new Date(from);
  while (date.getDay() !== weekday) date.setDate(date.getDate() - 1);
  return toDateInput(date);
}

export function debounce<T extends (...args: never[]) => void>(fn: T, delay = 300) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
