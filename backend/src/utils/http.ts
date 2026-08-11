import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Uniform envelope returned by every successful API response. */
export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface Paginated<T> {
  items: T[];
  pagination: PaginationMeta;
}

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>): Response {
  const body: ApiSuccess<T> = { success: true, data, ...(meta ? { meta } : {}) };
  return res.status(200).json(body);
}

export function created<T>(res: Response, data: T, meta?: Record<string, unknown>): Response {
  const body: ApiSuccess<T> = { success: true, data, ...(meta ? { meta } : {}) };
  return res.status(201).json(body);
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}

export function paginated<T>(
  res: Response,
  result: Paginated<T>,
  meta?: Record<string, unknown>,
): Response {
  return res.status(200).json({
    success: true,
    data: result.items,
    meta: { pagination: result.pagination, ...(meta ?? {}) },
  });
}

export function buildPagination(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && total > 0,
  };
}

/**
 * Wraps an async handler so rejected promises reach the central error middleware
 * instead of producing an unhandled rejection.
 */
export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response,
>(fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req as unknown as Req, res as unknown as Res, next)).catch(next);
  };
}
