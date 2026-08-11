import crypto from 'node:crypto';
import { Types } from 'mongoose';

const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTVWXYZ'; // Crockford base32 (no I, O, U)

/** Cryptographically random, human-transcribable token. */
export function randomToken(length = 12): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/**
 * Business references shown to humans and sent to payment providers.
 * Format: `PREFIX-YYMMDD-XXXXXXXX` — sortable by eye, collision-resistant in practice,
 * and additionally protected by a unique index on every reference column.
 */
export function businessReference(prefix: string, at: Date = new Date()): string {
  const y = String(at.getUTCFullYear()).slice(2);
  const m = String(at.getUTCMonth() + 1).padStart(2, '0');
  const d = String(at.getUTCDate()).padStart(2, '0');
  return `${prefix}-${y}${m}${d}-${randomToken(8)}`;
}

export const references = {
  transaction: () => businessReference('TXN'),
  payment: () => businessReference('PAY'),
  remittance: () => businessReference('RMT'),
  expense: () => businessReference('EXP'),
  offering: () => businessReference('OFR'),
  transfer: () => businessReference('TRF'),
  member: (sequence: number) => `MBR-${String(sequence).padStart(6, '0')}`,
};

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && Types.ObjectId.isValid(value) && String(new Types.ObjectId(value)) === value;
}

export function toObjectId(value: string | Types.ObjectId): Types.ObjectId {
  return typeof value === 'string' ? new Types.ObjectId(value) : value;
}

export function idString(value: unknown): string {
  if (!value) return '';
  if (value instanceof Types.ObjectId) return value.toHexString();
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && '_id' in (value as Record<string, unknown>)) {
    return idString((value as { _id: unknown })._id);
  }
  return String(value);
}

/** Constant-time string comparison for signatures and tokens. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
