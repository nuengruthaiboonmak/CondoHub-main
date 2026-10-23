import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { getIdempotencyKey, hashRequestBody, isUuid } from './idempotency';

const KEY = '01934f3a-1b2c-7d4e-8f90-abcdef123456';

describe('shared idempotency helper', () => {
  it('validates UUID values', () => {
    expect(isUuid(KEY)).toBe(true);
    expect(isUuid(KEY.toUpperCase())).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  it('reads the header case-insensitively', () => {
    expect(getIdempotencyKey({ 'idempotency-key': KEY })).toBe(KEY);
    expect(getIdempotencyKey({ 'Idempotency-Key': KEY })).toBe(KEY);
    expect(getIdempotencyKey({ 'IDEMPOTENCY-KEY': [KEY] })).toBe(KEY);
    expect(
      getIdempotencyKey({ get: (name: string) => (name === 'idempotency-key' ? KEY : null) }),
    ).toBe(KEY);
  });

  it('returns null for missing or blank headers', () => {
    expect(getIdempotencyKey({})).toBeNull();
    expect(getIdempotencyKey({ 'idempotency-key': '   ' })).toBeNull();
    expect(getIdempotencyKey({ get: () => null })).toBeNull();
  });

  it('rejects malformed header values with VALIDATION_ERROR', () => {
    try {
      getIdempotencyKey({ 'idempotency-key': 'not-a-uuid' });
      expect.unreachable('malformed key should reject');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('VALIDATION_ERROR');
    }
  });

  it('hashes request bodies in key order', () => {
    const left = hashRequestBody({ b: 2, a: 1, nested: { y: 2, x: 1 } });
    const right = hashRequestBody({ nested: { x: 1, y: 2 }, a: 1, b: 2 });
    expect(left).toBe(right);
    expect(hashRequestBody({ a: 1 })).not.toBe(hashRequestBody({ a: 2 }));
    expect(left).toMatch(/^[0-9a-f]{64}$/);
  });
});
