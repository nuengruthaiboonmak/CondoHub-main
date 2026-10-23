export function deniedCopy(unavailable: string): (code: string | undefined) => string | null {
  return (code: string | undefined): string | null => {
    if (code === 'RESOURCE_NOT_FOUND' || code === 'ACCESS_DENIED') return unavailable;
    return null;
  };
}

export function rateLimitedCopy(copy: string): (code: string | undefined) => string | null {
  return (code: string | undefined): string | null => {
    if (code === 'RATE_LIMITED') return copy;
    return null;
  };
}

export function firstOf(
  code: string | undefined,
  fallback: string,
  ...mappers: Array<(code: string | undefined) => string | null>
): string {
  for (const map of mappers) {
    const hit = map(code);
    if (hit !== null) return hit;
  }
  return fallback;
}

export interface ErrorCopies {
  denied: string;
  rateLimited: string;
  fallback: string;
}

export function resolveErrorCopy(
  code: string | undefined,
  payload: unknown,
  copies: ErrorCopies,
): string {
  return firstOf(
    code,
    serverErrorMessage(payload, copies.fallback),
    deniedCopy(copies.denied),
    rateLimitedCopy(copies.rateLimited),
  );
}

export function serverErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== 'object' || payload === null) return fallback;
  const error = (payload as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return fallback;
  const record = error as { message?: unknown; fieldErrors?: unknown };
  if (typeof record.fieldErrors === 'object' && record.fieldErrors !== null) {
    for (const messages of Object.values(record.fieldErrors)) {
      if (Array.isArray(messages)) {
        for (const message of messages) {
          if (typeof message === 'string' && message !== '') return message;
        }
      }
    }
  }
  if (typeof record.message === 'string' && record.message !== '') return record.message;
  return fallback;
}
