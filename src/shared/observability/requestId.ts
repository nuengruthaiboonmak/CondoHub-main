import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

export type RequestIdReader =
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>;

function readIncoming(headers: RequestIdReader | undefined): string | null {
  if (headers === undefined) return null;
  if ('get' in headers && typeof headers.get === 'function') return headers.get(REQUEST_ID_HEADER);
  const record = headers as Record<string, string | string[] | undefined>;
  const value = record[REQUEST_ID_HEADER] ?? record[REQUEST_ID_HEADER.toUpperCase()];
  if (value === undefined) {
    const match = Object.keys(record).find(
      (key) => key.toLowerCase() === REQUEST_ID_HEADER,
    );
    if (match === undefined) return null;
    const resolved = record[match];
    if (resolved === undefined) return null;
    return Array.isArray(resolved) ? (resolved[0] ?? null) : resolved;
  }
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export function resolveRequestId(headers?: RequestIdReader): string {
  const incoming = readIncoming(headers);
  if (incoming !== null && incoming.trim() !== '') return incoming.trim().slice(0, 128);
  return randomUUID();
}

export function requestLogBindings(requestId: string): { requestId: string } {
  return { requestId };
}
