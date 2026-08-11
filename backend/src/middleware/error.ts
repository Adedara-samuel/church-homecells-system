import type { ErrorRequestHandler, RequestHandler } from 'express';
import mongoose from 'mongoose';
import { MongoServerError } from 'mongodb';
import multer from 'multer';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError, ErrorCode, NotFoundError } from '../utils/errors';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl}`));
};

interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/**
 * Central error handler.
 *
 * Domain errors are translated to their intended status and message. Everything else
 * becomes a generic 500 — internal messages, stack traces and driver details never
 * reach the client in production.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let statusCode = 500;
  let code: string = ErrorCode.INTERNAL_ERROR;
  let message = 'Something went wrong. Please try again.';
  let details: unknown;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    statusCode = 422;
    code = ErrorCode.VALIDATION_ERROR;
    message = 'The submitted data is invalid.';
    details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  } else if (err instanceof mongoose.Error.ValidationError) {
    statusCode = 422;
    code = ErrorCode.VALIDATION_ERROR;
    message = 'The submitted data is invalid.';
    details = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    statusCode = 400;
    code = ErrorCode.VALIDATION_ERROR;
    message = `Invalid value supplied for "${err.path}".`;
  } else if (err instanceof MongoServerError && err.code === 11000) {
    statusCode = 409;
    code = ErrorCode.DUPLICATE;
    const fields = Object.keys((err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {});
    message = duplicateMessage(fields);
    details = { fields };
  } else if (err instanceof multer.MulterError) {
    statusCode = 422;
    code = ErrorCode.UPLOAD_ERROR;
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? `The file is larger than the ${env.UPLOAD_MAX_FILE_SIZE_MB}MB limit.`
        : 'The file could not be uploaded.';
  }

  const log = statusCode >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
  log(
    {
      err: statusCode >= 500 ? err : { name: (err as Error)?.name, message: (err as Error)?.message },
      statusCode,
      code,
      method: req.method,
      url: req.originalUrl,
      userId: req.user?.id,
      requestId: req.requestId,
    },
    'Request failed',
  );

  const body: ErrorBody = {
    success: false,
    error: { code, message, ...(details ? { details } : {}), requestId: req.requestId },
  };

  // Stack traces are a development aid only.
  if (!env.isProduction && statusCode >= 500 && err instanceof Error) {
    (body.error as Record<string, unknown>).stack = err.stack;
  }

  res.status(statusCode).json(body);
};

function duplicateMessage(fields: string[]): string {
  if (fields.includes('email')) return 'An account with this email address already exists.';
  if (fields.includes('phone')) return 'An account with this phone number already exists.';
  if (fields.includes('code')) return 'This code is already in use.';
  if (fields.includes('memberId')) return 'This member ID is already in use.';
  if (fields.includes('idempotencyKey')) return 'Transaction already processed.';
  if (fields.includes('transactionRef') || fields.includes('reference'))
    return 'This reference has already been used.';
  if (fields.includes('member') && fields.includes('type') && fields.includes('date'))
    return 'Attendance has already been recorded for this member on this date.';
  if (fields.includes('homecell') && fields.includes('date'))
    return 'A record already exists for this Homecell on this date.';
  return 'A record with these details already exists.';
}
