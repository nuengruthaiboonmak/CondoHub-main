import { createHash } from 'node:crypto';
import { AppError } from './errors';
import { isUuid } from './uuid';
export { UUID_REGEX, isUuid } from './uuid';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';

export type HeaderReader =
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>;

function readHeader(headers: HeaderReader, name: string): string | null {
  if ('get' in headers && typeof headers.get === 'function') return headers.get(name);
  const record = headers as Record<string, string | string[] | undefined>;
  const direct = record[name] ?? record[name.toLowerCase()] ?? record[name.toUpperCase()];
  if (direct === undefined) {
    const match = Object.keys(record).find((key) => key.toLowerCase() === name.toLowerCase());
    if (match === undefined) return null;
    const value = record[match];
    if (value === undefined) return null;
    return Array.isArray(value) ? (value[0] ?? null) : value;
  }
  return Array.isArray(direct) ? (direct[0] ?? null) : direct;
}

export function getIdempotencyKey(headers: HeaderReader): string | null {
  const raw = readHeader(headers, IDEMPOTENCY_KEY_HEADER);
  if (raw === null) return null;
  const key = raw.trim();
  if (key === '') return null;
  if (!isUuid(key)) {
    throw new AppError('VALIDATION_ERROR', 'The Idempotency-Key header must be a UUID.');
  }
  return key;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const sorted: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of entries) sorted[entryKey] = canonicalize(entryValue);
    return sorted;
  }
  return value;
}

export function hashRequestBody(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(body)) ?? 'null')
    .digest('hex');
}
