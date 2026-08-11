import crypto from 'node:crypto';
import type { RequestHandler } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { env } from '../config/env';
import { AppError, ErrorCode } from '../utils/errors';

/** Correlates every log line, audit record and error response for one request. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.headers['x-request-id'];
  req.requestId = (Array.isArray(incoming) ? incoming[0] : incoming) || crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
};

function limiter(max: number, windowMs: number, message: string, extra: Partial<Options> = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.isTest,
    handler: (_req, _res, next) => {
      next(new AppError(message, 429, ErrorCode.RATE_LIMITED));
    },
    ...extra,
  });
}

/** Baseline limit applied to the whole API surface. */
export const apiLimiter = limiter(
  env.RATE_LIMIT_MAX,
  env.RATE_LIMIT_WINDOW_MS,
  'Too many requests. Please slow down and try again shortly.',
);

/** Tight limit on credential endpoints to blunt brute-force attempts. */
export const authLimiter = limiter(
  env.AUTH_RATE_LIMIT_MAX,
  env.RATE_LIMIT_WINDOW_MS,
  'Too many authentication attempts. Please try again later.',
  {
    // Key on email as well as IP so one office NAT does not lock everyone out,
    // and one attacker cannot spread attempts across addresses for a single account.
    keyGenerator: (req) => {
      const email = (req.body as { identifier?: string } | undefined)?.identifier ?? '';
      return `${req.ip}:${String(email).toLowerCase()}`;
    },
    skipSuccessfulRequests: true,
  },
);

/** Money movement is rate limited independently of ordinary reads. */
export const financeLimiter = limiter(
  60,
  60_000,
  'Too many financial operations. Please wait a moment and try again.',
);

/**
 * Strips `$`-prefixed and dotted keys from user input before it reaches Mongoose.
 * `sanitizeFilter` covers query operators; this covers update/insert payloads.
 */
export const sanitizeInput: RequestHandler = (req, _res, next) => {
  const clean = (value: unknown, depth = 0): unknown => {
    if (depth > 8 || value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith('$') || key.includes('.')) continue;
      out[key] = clean(val, depth + 1);
    }
    return out;
  };

  if (req.body && typeof req.body === 'object') req.body = clean(req.body) as typeof req.body;
  next();
};
