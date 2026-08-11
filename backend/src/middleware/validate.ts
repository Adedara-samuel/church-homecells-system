import type { RequestHandler } from 'express';
import { ZodError, type ZodTypeAny, z } from 'zod';
import { ValidationError } from '../utils/errors';

export interface RequestSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function formatZodError(error: ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Parses and *replaces* the request parts with their validated, coerced output.
 * Downstream handlers therefore only ever see data that matched the schema —
 * unknown keys are stripped, so mass-assignment is impossible by construction.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      if (schemas.query) {
        const parsed = schemas.query.parse(req.query) as Record<string, unknown>;
        // Express 5 makes req.query a getter; assign per-key to stay compatible.
        Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        return next(new ValidationError('The submitted data is invalid.', formatZodError(err)));
      }
      next(err);
    }
  };
}

// ---------------------------------------------------------------------------
// Shared primitives reused by every module schema
// ---------------------------------------------------------------------------

export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'A valid identifier is required');

export const idParamSchema = z.object({ id: objectIdSchema });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.string().max(60).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().trim().max(120).optional(),
});

export const orgFilterSchema = z.object({
  zoneId: objectIdSchema.optional(),
  areaId: objectIdSchema.optional(),
  homecellId: objectIdSchema.optional(),
});

export const dateRangeSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

export const listQuerySchema = paginationSchema.merge(orgFilterSchema).merge(dateRangeSchema);

export type ListQuery = z.infer<typeof listQuerySchema>;

/** Amounts cross the API in major units (naira) and are converted at the boundary. */
export const amountMajorSchema = z
  .number({ invalid_type_error: 'Amount must be a number' })
  .positive('Amount must be greater than zero')
  .max(1_000_000_000, 'Amount exceeds the permitted maximum');

export const phoneSchema = z
  .string()
  .trim()
  .min(7, 'A valid phone number is required')
  .max(20)
  .regex(/^\+?[0-9\s-]{7,20}$/, 'A valid phone number is required');

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters long')
  .max(128)
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/\d/, 'Password must contain a digit')
  .regex(/[^A-Za-z0-9]/, 'Password must contain a symbol');

/** Builds a `{ field: 1 | -1 }` sort object restricted to an allow-list. */
export function buildSort(
  sort: string | undefined,
  order: 'asc' | 'desc',
  allowed: string[],
  fallback: string,
): Record<string, 1 | -1> {
  const field = sort && allowed.includes(sort) ? sort : fallback;
  return { [field]: order === 'asc' ? 1 : -1 };
}
