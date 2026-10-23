import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CODES, ERROR_HTTP_STATUS, mapPgError, toErrorEnvelope } from './errors';

describe('shared errors pg map', () => {
  it('covers the frozen error code table with HTTP statuses', () => {
    expect(ERROR_CODES).toContain('VALIDATION_ERROR');
    expect(ERROR_HTTP_STATUS.VALIDATION_ERROR).toBe(400);
    expect(ERROR_HTTP_STATUS.RESOURCE_NOT_FOUND).toBe(404);
    expect(ERROR_HTTP_STATUS.VERSION_CONFLICT).toBe(409);
    expect(ERROR_HTTP_STATUS.FILE_TOO_LARGE).toBe(413);
    expect(ERROR_HTTP_STATUS.RATE_LIMITED).toBe(429);
    expect(ERROR_HTTP_STATUS.INTERNAL_ERROR).toBe(500);
  });

  it('keeps AppError instances untouched', () => {
    const original = new AppError('VERSION_CONFLICT');
    expect(mapPgError(original)).toBe(original);
  });

  it('maps unique and exclusion violations through the allowlist', () => {
    const unique = mapPgError(
      { code: '23505', constraint: 'payment_submission_invoice_id_pending_idx' },
      { constraintCodes: { payment_submission_invoice_id_pending_idx: 'PENDING_PAYMENT_EXISTS' } },
    );
    expect(unique.code).toBe('PENDING_PAYMENT_EXISTS');
    expect(unique.httpStatus).toBe(409);

    const unmappedUnique = mapPgError({ code: '23505', constraint: 'unknown_uq' });
    expect(unmappedUnique.code).toBe('INTERNAL_ERROR');

    const exclusion = mapPgError(
      { code: '23P01', constraint: 'rental_period_no_overlap' },
      { constraintCodes: { rental_period_no_overlap: 'VERSION_CONFLICT' } },
    );
    expect(exclusion.code).toBe('VERSION_CONFLICT');
  });

  it('maps foreign-key, check, and numeric overflow states', () => {
    expect(mapPgError({ code: '23503' }).code).toBe('VALIDATION_ERROR');
    expect(mapPgError({ code: '23514' }).code).toBe('VALIDATION_ERROR');
    expect(mapPgError({ code: '22003' }).code).toBe('VALIDATION_ERROR');
    expect(mapPgError({ code: '23503' }, { fallbackCodes: { '23503': 'RESOURCE_NOT_FOUND' } }).code).toBe(
      'RESOURCE_NOT_FOUND',
    );
  });

  it('falls back to INTERNAL_ERROR for unknown shapes', () => {
    expect(mapPgError({ code: 'XX000' }).code).toBe('INTERNAL_ERROR');
    expect(mapPgError(new Error('boom')).code).toBe('INTERNAL_ERROR');
    expect(mapPgError(null).code).toBe('INTERNAL_ERROR');
  });

  it('builds the frozen error envelope', () => {
    const envelope = toErrorEnvelope(
      new AppError('VALIDATION_ERROR', 'Bad input.', {
        fieldErrors: { amount: ['Invalid.'] },
      }),
      'req-1',
    );
    expect(envelope).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Bad input.',
        fieldErrors: { amount: ['Invalid.'] },
        requestId: 'req-1',
      },
    });
    const internal = toErrorEnvelope(new Error('boom'), 'req-2');
    expect(internal.error.code).toBe('INTERNAL_ERROR');
    expect(internal.error.requestId).toBe('req-2');
  });
});
