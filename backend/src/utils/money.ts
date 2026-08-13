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

const UNITS = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen',
];
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

function threeDigitsToWords(value: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;
  if (hundreds) parts.push(`${UNITS[hundreds]} Hundred`);
  if (rest) {
    if (parts.length) parts.push('and');
    if (rest < 20) parts.push(UNITS[rest]);
    else {
      const tens = Math.floor(rest / 10);
      const unit = rest % 10;
      parts.push(unit ? `${TENS[tens]}-${UNITS[unit]}` : TENS[tens]);
    }
  }
  return parts.join(' ');
}

function integerToWords(value: number): string {
  if (value === 0) return 'Zero';
  const groups: string[] = [];
  let remaining = value;
  let scale = 0;
  while (remaining > 0 && scale < SCALES.length) {
    const group = remaining % 1000;
    if (group) {
      groups.unshift(`${threeDigitsToWords(group)}${SCALES[scale] ? ` ${SCALES[scale]}` : ''}`);
    }
    remaining = Math.floor(remaining / 1000);
    scale += 1;
  }
  return groups.join(' ');
}

const CURRENCY_WORDS: Record<string, { major: string; minor: string }> = {
  NGN: { major: 'Naira', minor: 'Kobo' },
  USD: { major: 'Dollars', minor: 'Cents' },
  GBP: { major: 'Pounds', minor: 'Pence' },
  EUR: { major: 'Euro', minor: 'Cents' },
};

/**
 * "Two Hundred and Fifty Thousand Naira Only" — the amount in words that every
 * printed receipt carries, so a figure cannot be altered after the fact without the
 * discrepancy being obvious.
 */
export function amountToWords(minor: number, currency = 'NGN'): string {
  const names = CURRENCY_WORDS[currency] ?? { major: currency, minor: 'Cents' };
  const whole = Math.floor(Math.abs(minor) / MINOR_UNITS_PER_MAJOR);
  const fraction = Math.abs(minor) % MINOR_UNITS_PER_MAJOR;

  const head = `${integerToWords(whole)} ${names.major}`;
  const tail = fraction ? ` and ${integerToWords(fraction)} ${names.minor}` : '';
  return `${minor < 0 ? 'Minus ' : ''}${head}${tail} Only`;
}

/** Guards every amount entering the ledger. */
export function assertPositiveMinor(minor: number, label = 'Amount'): void {
  if (!Number.isInteger(minor)) {
    throw new Error(`${label} must be a whole number of minor units`);
  }
  if (minor <= 0) {
    throw new Error(`${label} must be greater than zero`);
  }
}
