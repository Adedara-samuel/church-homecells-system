/**
 * Money handling.
 *
 * All monetary amounts are stored and computed in **minor units** (kobo for NGN)
 * as integers. Floating point naira never touches the ledger. The API accepts and
 * returns major units (naira) for ergonomics and converts at the boundary.
 */

export const MINOR_UNITS_PER_MAJOR = 100;

export function toMinor(major: number): number {
  if (!Number.isFinite(major)) throw new Error('Amount must be a finite number');
  // Round through a string to avoid 19.99 * 100 === 1998.9999999999998
  return Math.round(Number((major * MINOR_UNITS_PER_MAJOR).toFixed(4)));
}

export function toMajor(minor: number): number {
  return Number((minor / MINOR_UNITS_PER_MAJOR).toFixed(2));
}

export function formatMoney(minor: number, currency = 'NGN'): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? `${currency} `;
  const value = toMajor(minor).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${value}`;
}

export const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: '₦',
  USD: '$',
  GBP: '£',
  EUR: '€',
};

/** Guards every amount entering the ledger. */
export function assertPositiveMinor(minor: number, label = 'Amount'): void {
  if (!Number.isInteger(minor)) {
    throw new Error(`${label} must be a whole number of minor units`);
  }
  if (minor <= 0) {
    throw new Error(`${label} must be greater than zero`);
  }
}
