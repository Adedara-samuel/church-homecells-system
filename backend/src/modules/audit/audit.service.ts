import type { Request } from 'express';
import type { Types } from 'mongoose';
import { logger } from '../../config/logger';
import type { AuditAction, AuditModule } from '../../types/enums';
import { AuditLog } from './audit.model';

const REDACTED_KEYS = new Set([
  'password',
  'passwordhash',
  'newpassword',
  'currentpassword',
  'confirmpassword',
  'token',
  'refreshtoken',
  'accesstoken',
  'secret',
  'secretkey',
  'apikey',
  'authorization',
  'passwordresettokenhash',
]);

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 4) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

/**
 * Produces a minimal before/after pair containing only the keys that actually changed.
 * Storing whole documents would make the audit trail unreadable and enormous.
 */
export function diffValues(
  previous: object | null | undefined,
  next: object | null | undefined,
): { previousValues: Record<string, unknown>; newValues: Record<string, unknown> } {
  const prev = (previous ?? {}) as Record<string, unknown>;
  const cur = (next ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(prev), ...Object.keys(cur)]);
  const previousValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const key of keys) {
    if (key === 'updatedAt' || key === '__v' || key === 'id') continue;
    const a = prev[key];
    const b = cur[key];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (a !== undefined) previousValues[key] = redact(a);
    if (b !== undefined) newValues[key] = redact(b);
  }
  return { previousValues, newValues };
}

export interface AuditInput {
  action: AuditAction;
  module: AuditModule;
  description: string;
  entityModel?: string;
  entityId?: Types.ObjectId | string | null;
  entityLabel?: string | null;
  previousValues?: object | null;
  newValues?: object | null;
  homecell?: Types.ObjectId | string | null;
  area?: Types.ObjectId | string | null;
  zone?: Types.ObjectId | string | null;
  success?: boolean;
  /** Explicit actor for jobs and webhooks where there is no `req.user`. */
  actor?: { id?: string; name?: string; role?: string } | null;
}

export function requestContext(req?: Request) {
  if (!req) return {};
  return {
    ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || req.ip || null,
    userAgent: (req.headers['user-agent'] as string) ?? null,
    requestId: req.requestId ?? null,
  };
}

/**
 * Writes an audit record.
 *
 * Auditing must never break the operation it is recording, so failures are logged
 * rather than thrown. Financial paths that require a guaranteed audit entry call
 * `recordAuditOrThrow` inside their transaction instead.
 */
export async function recordAudit(input: AuditInput, req?: Request): Promise<void> {
  try {
    await writeAudit(input, req);
  } catch (err) {
    logger.error({ err, action: input.action, module: input.module }, 'Failed to write audit log');
  }
}

export async function recordAuditOrThrow(input: AuditInput, req?: Request): Promise<void> {
  await writeAudit(input, req);
}

async function writeAudit(input: AuditInput, req?: Request): Promise<void> {
  const actor = input.actor ?? {
    id: req?.user?.id,
    name: req?.user?.fullName,
    role: req?.user?.role,
  };
  await AuditLog.create({
    user: actor?.id ?? null,
    userName: actor?.name ?? 'System',
    userRole: actor?.role ?? 'SYSTEM',
    action: input.action,
    module: input.module,
    entityModel: input.entityModel ?? null,
    entityId: input.entityId ?? null,
    entityLabel: input.entityLabel ?? null,
    previousValues: input.previousValues ? (redact(input.previousValues) as object) : null,
    newValues: input.newValues ? (redact(input.newValues) as object) : null,
    description: input.description,
    homecell: input.homecell ?? null,
    area: input.area ?? null,
    zone: input.zone ?? null,
    success: input.success ?? true,
    ...requestContext(req),
  });
}
