/**
 * Application error hierarchy.
 *
 * Every error thrown intentionally by the domain layer is an `AppError`, which carries
 * an HTTP status, a stable machine-readable `code` and an optional `details` payload.
 * Anything else that reaches the error handler is treated as an unexpected 500 and its
 * message is never leaked to the client in production.
 */

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  OUT_OF_SCOPE: 'OUT_OF_SCOPE',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  DUPLICATE: 'DUPLICATE',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  ALREADY_PROCESSED: 'ALREADY_PROCESSED',
  PAYMENT_VERIFICATION_FAILED: 'PAYMENT_VERIFICATION_FAILED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',
  RATE_LIMITED: 'RATE_LIMITED',
  UPLOAD_ERROR: 'UPLOAD_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;
  public readonly expose: boolean;

  constructor(
    message: string,
    statusCode = 500,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = statusCode < 500;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'The submitted data is invalid.', details?: unknown) {
    super(message, 422, ErrorCode.VALIDATION_ERROR, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication is required.', code: ErrorCode = ErrorCode.UNAUTHENTICATED) {
    super(message, 401, code);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(message = 'Invalid credentials') {
    super(message, 401, ErrorCode.INVALID_CREDENTIALS);
  }
}

export class AccountDisabledError extends AppError {
  constructor(message = 'This account is not permitted to sign in. Please contact an administrator.') {
    super(message, 403, ErrorCode.ACCOUNT_DISABLED);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.', details?: unknown) {
    super(message, 403, ErrorCode.FORBIDDEN, details);
  }
}

export class OutOfScopeError extends AppError {
  constructor(
    message = 'This record is outside your assigned organisational scope.',
    details?: unknown,
  ) {
    super(message, 403, ErrorCode.OUT_OF_SCOPE, details);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Record') {
    super(`${resource} not found.`, 404, ErrorCode.NOT_FOUND);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'The request conflicts with the current state of the record.', details?: unknown) {
    super(message, 409, ErrorCode.CONFLICT, details);
  }
}

export class DuplicateError extends AppError {
  constructor(message = 'A record with these details already exists.', details?: unknown) {
    super(message, 409, ErrorCode.DUPLICATE, details);
  }
}

export class BusinessRuleError extends AppError {
  /** @param rule the SRS business-rule identifier, e.g. `BR-005`. */
  constructor(message: string, rule?: string) {
    super(message, 422, ErrorCode.BUSINESS_RULE_VIOLATION, rule ? { rule } : undefined);
  }
}

export class InsufficientBalanceError extends AppError {
  constructor(available: number, requested: number, currency = 'NGN') {
    super(
      'Insufficient available balance.',
      422,
      ErrorCode.INSUFFICIENT_BALANCE,
      { available, requested, currency },
    );
  }
}

export class AlreadyProcessedError extends AppError {
  constructor(message = 'Transaction already processed.', details?: unknown) {
    super(message, 409, ErrorCode.ALREADY_PROCESSED, details);
  }
}

export class PaymentVerificationError extends AppError {
  constructor(message = 'Payment verification failed.', details?: unknown) {
    super(message, 422, ErrorCode.PAYMENT_VERIFICATION_FAILED, details);
  }
}

export class ProviderError extends AppError {
  constructor(provider: string, message: string, details?: unknown) {
    super(`${provider}: ${message}`, 502, ErrorCode.PROVIDER_ERROR, details);
  }
}

export class UnsupportedOperationError extends AppError {
  constructor(message = 'This operation is not supported by the active provider.') {
    super(message, 501, ErrorCode.UNSUPPORTED_OPERATION);
  }
}

export class UploadError extends AppError {
  constructor(message = 'The file could not be uploaded.', details?: unknown) {
    super(message, 422, ErrorCode.UPLOAD_ERROR, details);
  }
}
