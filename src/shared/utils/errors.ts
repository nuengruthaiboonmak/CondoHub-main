export const ERROR_CODES = [
  'AUTH_REQUIRED',
  'FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED',
  'ACCESS_DENIED',
  'RESOURCE_NOT_FOUND',
  'VALIDATION_ERROR',
  'ROOM_ACCESS_REVOKED',
  'BOOKING_SLOT_UNAVAILABLE',
  'BOOKING_QUOTA_EXCEEDED',
  'INVOICE_ALREADY_PAID',
  'PAST_DUE_DATE_CONFIRMATION_REQUIRED',
  'PAYMENT_ALREADY_REVIEWED',
  'PAYMENT_APPROVED_AMOUNT_EXCEEDS_OUTSTANDING',
  'PENDING_PAYMENT_EXISTS',
  'VERSION_CONFLICT',
  'CONFIG_IMPACT_CHANGED',
  'FILE_NOT_ALLOWED',
  'FILE_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  AUTH_REQUIRED: 401,
  FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED: 403,
  ACCESS_DENIED: 403,
  RESOURCE_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  ROOM_ACCESS_REVOKED: 403,
  BOOKING_SLOT_UNAVAILABLE: 409,
  BOOKING_QUOTA_EXCEEDED: 409,
  INVOICE_ALREADY_PAID: 409,
  PAST_DUE_DATE_CONFIRMATION_REQUIRED: 400,
  PAYMENT_ALREADY_REVIEWED: 409,
  PAYMENT_APPROVED_AMOUNT_EXCEEDS_OUTSTANDING: 409,
  PENDING_PAYMENT_EXISTS: 409,
  VERSION_CONFLICT: 409,
  CONFIG_IMPACT_CHANGED: 409,
  FILE_NOT_ALLOWED: 400,
  FILE_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export const DEFAULT_ERROR_MESSAGES: Record<ErrorCode, string> = {
  AUTH_REQUIRED: 'Authentication is required.',
  FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED: 'You must change your password before continuing.',
  ACCESS_DENIED: 'You do not have permission to perform this action.',
  RESOURCE_NOT_FOUND: 'The requested resource was not found.',
  VALIDATION_ERROR: 'The request is invalid.',
  ROOM_ACCESS_REVOKED: 'Your access to this room was revoked.',
  BOOKING_SLOT_UNAVAILABLE: 'The selected slot is no longer available.',
  BOOKING_QUOTA_EXCEEDED: 'The booking quota for this period is exceeded.',
  INVOICE_ALREADY_PAID: 'The invoice is already paid.',
  PAST_DUE_DATE_CONFIRMATION_REQUIRED: 'The due date is in the past. Please confirm to proceed.',
  PAYMENT_ALREADY_REVIEWED: 'The payment submission was already reviewed.',
  PAYMENT_APPROVED_AMOUNT_EXCEEDS_OUTSTANDING: 'The approved amount exceeds the outstanding balance.',
  PENDING_PAYMENT_EXISTS: 'A payment submission is already awaiting review.',
  VERSION_CONFLICT: 'Someone else changed this record. Please reload and retry.',
  CONFIG_IMPACT_CHANGED: 'The configuration preview is stale. Please re-preview before committing.',
  FILE_NOT_ALLOWED: 'This file type is not allowed. Supported types: JPEG, PNG, WebP.',
  FILE_TOO_LARGE: 'The file exceeds the allowed size limit.',
  RATE_LIMITED: 'Too many requests. Please retry later.',
  INTERNAL_ERROR: 'An unexpected error occurred.',
};

export type FieldErrors = Record<string, string[]>;

export interface AppErrorOptions {
  httpStatus?: number;
  fieldErrors?: FieldErrors;
  requestId?: string;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly fieldErrors?: FieldErrors | undefined;
  readonly requestId?: string | undefined;
  readonly errorCause?: unknown;

  constructor(code: ErrorCode, message?: string, opts?: AppErrorOptions) {
    super(message ?? DEFAULT_ERROR_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = opts?.httpStatus ?? ERROR_HTTP_STATUS[code];
    this.fieldErrors = opts?.fieldErrors;
    this.requestId = opts?.requestId;
    this.errorCause = opts?.cause;
  }
}

export interface PgErrorLike {
  code?: string | undefined;
  constraint?: string | undefined;
}

export interface PgErrorMapOptions {
  constraintCodes?: Record<string, ErrorCode>;
  fallbackCodes?: Partial<Record<string, ErrorCode>>;
}

function asPgErrorLike(error: unknown): PgErrorLike | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null) return null;
    const record = current as Record<string, unknown>;
    if (typeof record.code === 'string') {
      return {
        code: record.code,
        constraint: typeof record.constraint === 'string' ? record.constraint : undefined,
      };
    }
    if (!('cause' in record)) return null;
    current = record.cause;
  }
  return null;
}

export function mapPgError(error: unknown, opts?: PgErrorMapOptions): AppError {
  if (error instanceof AppError) return error;
  const pg = asPgErrorLike(error);
  const sqlState = pg?.code;
  if (sqlState === '23505' || sqlState === '23P01') {
    const mapped =
      (pg?.constraint !== undefined ? opts?.constraintCodes?.[pg.constraint] : undefined) ??
      opts?.fallbackCodes?.[sqlState];
    if (mapped !== undefined) return new AppError(mapped, undefined, { cause: error });
    return new AppError('INTERNAL_ERROR', undefined, { cause: error });
  }
  if (sqlState === '23503') {
    const mapped = opts?.fallbackCodes?.[sqlState] ?? 'VALIDATION_ERROR';
    return new AppError(mapped, undefined, { cause: error });
  }
  if (sqlState === '23514' || sqlState === '22003') {
    return new AppError('VALIDATION_ERROR', undefined, { cause: error });
  }
  const mapped = sqlState !== undefined ? opts?.fallbackCodes?.[sqlState] : undefined;
  if (mapped !== undefined) return new AppError(mapped, undefined, { cause: error });
  return new AppError('INTERNAL_ERROR', undefined, { cause: error });
}

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors?: FieldErrors;
    requestId?: string;
  };
}

export function toErrorEnvelope(error: unknown, requestId: string): ErrorEnvelope {
  const mapped = error instanceof AppError ? error : mapPgError(error);
  return {
    error: {
      code: mapped.code,
      message: mapped.message,
      ...(mapped.fieldErrors !== undefined ? { fieldErrors: mapped.fieldErrors } : {}),
      requestId: mapped.requestId ?? requestId,
    },
  };
}
