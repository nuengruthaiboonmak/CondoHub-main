import { describe, expect, it } from 'vitest';
import { RATE_LIMIT_PRESETS, TokenBucketLimiter, retryAfterSeconds } from './rateLimit';

describe('shared rate limiter token bucket', () => {
  it('allows bursts up to capacity then denies', () => {
    const limiter = new TokenBucketLimiter();
    const bucket = { capacity: 2, windowMs: 60_000 };
    expect(limiter.consume('user-1', bucket, 0).allowed).toBe(true);
    expect(limiter.consume('user-1', bucket, 0).allowed).toBe(true);
    const denied = limiter.consume('user-1', bucket, 0);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(retryAfterSeconds(denied.retryAfterMs)).toBeGreaterThanOrEqual(1);
  });

  it('refills over time', () => {
    const limiter = new TokenBucketLimiter();
    const bucket = { capacity: 1, windowMs: 60_000 };
    expect(limiter.consume('user-2', bucket, 0).allowed).toBe(true);
    expect(limiter.consume('user-2', bucket, 30_000).allowed).toBe(false);
    expect(limiter.consume('user-2', bucket, 60_000).allowed).toBe(true);
  });

  it('isolates keys and freezes job buckets', () => {
    const limiter = new TokenBucketLimiter();
    expect(RATE_LIMIT_PRESETS.jobTrigger).toEqual({ capacity: 10, windowMs: 60_000 });
    expect(RATE_LIMIT_PRESETS.chatSend).toEqual({ capacity: 30, windowMs: 60_000 });
    const bucket = { capacity: 1, windowMs: 60_000 };
    expect(limiter.consume('a', bucket, 0).allowed).toBe(true);
    expect(limiter.consume('b', bucket, 0).allowed).toBe(true);
  });
});
