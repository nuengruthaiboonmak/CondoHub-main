import { describe, expect, it } from 'vitest';
import {
  assertRedactedJobResult,
  assertSweeperJobResult,
  emptyJobCounts,
  redactJobResult,
} from './jobRedaction';

describe('D06-A job result redaction', () => {
  it('strips private counts from the admin shape', () => {
    const redacted = redactJobResult({
      created: 10,
      skipped: 4,
      reviewRequired: 3,
      caughtUp: true,
      privateRentCreated: 6,
      privateRentSkipped: 1,
      privateReviews: 2,
      cycleErrors: 0,
    });
    expect(redacted).toEqual({ created: 4, skipped: 3, reviewRequired: 1, caughtUp: true });
    expect(JSON.stringify(redacted)).not.toContain('private');
  });

  it('preserves nextFromCycle in the redacted shape', () => {
    const redacted = redactJobResult({
      ...emptyJobCounts(false),
      nextFromCycle: '2026-09',
    });
    expect(redacted.nextFromCycle).toBe('2026-09');
  });

  it('never returns negative counts after stripping', () => {
    const redacted = redactJobResult({
      created: 1,
      skipped: 0,
      reviewRequired: 0,
      caughtUp: true,
      privateRentCreated: 5,
      privateRentSkipped: 2,
      privateReviews: 3,
      cycleErrors: 1,
    });
    expect(redacted).toEqual({ created: 0, skipped: 0, reviewRequired: 0, caughtUp: true });
  });

  it('rejects stored results carrying private fields', () => {
    expect(() =>
      assertRedactedJobResult(
        {
          created: 4,
          skipped: 0,
          reviewRequired: 0,
          caughtUp: true,
          privateRentCreated: 1,
        },
        'generate-invoices',
      ),
    ).toThrowError();
    expect(() => assertRedactedJobResult({ created: 1 }, 'generate-invoices')).toThrowError();
    expect(assertRedactedJobResult(null, 'generate-invoices')).toBeNull();
    expect(
      assertRedactedJobResult(
        { created: 1, skipped: 0, reviewRequired: 0, caughtUp: false, nextFromCycle: '2026-09' },
        'generate-invoices',
      ),
    ).toEqual({ created: 1, skipped: 0, reviewRequired: 0, caughtUp: false, nextFromCycle: '2026-09' });
  });

  it('accepts the sweeper count shape and rejects unknown jobs', () => {
    expect(
      assertRedactedJobResult(
        {
          transitioned: 2,
          skippedYoung: 1,
          skippedRaced: 0,
          s3Deleted: 2,
          s3Failures: 0,
          caughtUp: true,
        },
        'sweep-orphans',
      ),
    ).toEqual({
      transitioned: 2,
      skippedYoung: 1,
      skippedRaced: 0,
      s3Deleted: 2,
      s3Failures: 0,
      caughtUp: true,
    });
    expect(() =>
      assertSweeperJobResult({ transitioned: 1, caughtUp: true }),
    ).toThrowError();
    expect(() =>
      assertRedactedJobResult({ created: 1, skipped: 0, reviewRequired: 0, caughtUp: true }, 'nightly-vacuum'),
    ).toThrowError();
  });
});
