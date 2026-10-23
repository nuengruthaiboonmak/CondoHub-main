import { AppError } from './errors';
import { isUuid } from './idempotency';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;
export const CHAT_DEFAULT_LIMIT = 30;
export const CHAT_MAX_LIMIT = 50;

export interface PageParams {
  page: number;
  pageSize: number;
}

export interface PageMeta extends PageParams {
  total: number;
}

function parsePositiveInt(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new AppError('VALIDATION_ERROR', `The ${field} must be a positive integer.`, {
      fieldErrors: { [field]: [`The ${field} must be a positive integer.`] },
    });
  }
  return parsed;
}

export function parsePageParams(query: {
  page?: unknown;
  pageSize?: unknown;
}): PageParams {
  const page = parsePositiveInt(query.page, 'page') ?? 1;
  const requested = parsePositiveInt(query.pageSize, 'pageSize') ?? DEFAULT_PAGE_SIZE;
  return { page, pageSize: Math.min(requested, MAX_PAGE_SIZE) };
}

export function parseChatLimit(limit: unknown): number {
  const parsed = parsePositiveInt(limit, 'limit') ?? CHAT_DEFAULT_LIMIT;
  return Math.min(parsed, CHAT_MAX_LIMIT);
}

export interface ChatCursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(cursor: { createdAt: Date | string; id: string }): string {
  const rawCreatedAt = cursor.createdAt instanceof Date ? cursor.createdAt.toISOString() : cursor.createdAt;
  if (typeof rawCreatedAt !== 'string' || Number.isNaN(Date.parse(rawCreatedAt))) {
    throw new AppError('VALIDATION_ERROR', 'The cursor timestamp is invalid.');
  }
  if (!isUuid(cursor.id)) {
    throw new AppError('VALIDATION_ERROR', 'The cursor id is invalid.');
  }
  const payload: ChatCursor = { createdAt: new Date(rawCreatedAt).toISOString(), id: cursor.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(value: unknown): ChatCursor {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new AppError('VALIDATION_ERROR', 'The cursor is invalid.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('VALIDATION_ERROR', 'The cursor is invalid.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new AppError('VALIDATION_ERROR', 'The cursor is invalid.');
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.createdAt !== 'string' ||
    Number.isNaN(Date.parse(record.createdAt)) ||
    !isUuid(record.id)
  ) {
    throw new AppError('VALIDATION_ERROR', 'The cursor is invalid.');
  }
  return { createdAt: new Date(record.createdAt).toISOString(), id: record.id };
}
