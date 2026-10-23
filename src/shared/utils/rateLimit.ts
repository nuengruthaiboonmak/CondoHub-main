export const RETRY_AFTER_HEADER = 'Retry-After';

export interface RateLimitBucket {
  capacity: number;
  windowMs: number;
}

export const RATE_LIMIT_PRESETS: Record<string, RateLimitBucket> = {
  login: { capacity: 5, windowMs: 15 * 60 * 1000 },
  provision: { capacity: 10, windowMs: 60 * 60 * 1000 },
  passwordReset: { capacity: 10, windowMs: 60 * 60 * 1000 },
  imageIntent: { capacity: 30, windowMs: 60 * 60 * 1000 },
  chatSend: { capacity: 30, windowMs: 60 * 1000 },
  generalApi: { capacity: 300, windowMs: 60 * 1000 },
  jobTrigger: { capacity: 10, windowMs: 60 * 1000 },
};

export interface RateLimitVerdict {
  allowed: boolean;
  retryAfterMs: number;
  remaining: number;
}

interface BucketState {
  tokens: number;
  updatedAtMs: number;
}

export interface TokenBucketOptions {
  maxEntries?: number;
}

export class TokenBucketLimiter {
  private readonly states = new Map<string, BucketState>();
  private readonly maxEntries: number;

  constructor(opts?: TokenBucketOptions) {
    this.maxEntries = opts?.maxEntries ?? 10_000;
  }

  consume(key: string, bucket: RateLimitBucket, nowMs = Date.now()): RateLimitVerdict {
    const refillPerMs = bucket.capacity / bucket.windowMs;
    const state = this.states.get(key) ?? { tokens: bucket.capacity, updatedAtMs: nowMs };
    const elapsed = Math.max(0, nowMs - state.updatedAtMs);
    const refilled = Math.min(bucket.capacity, state.tokens + elapsed * refillPerMs);
    if (refilled >= 1) {
      const remaining = Math.floor(refilled - 1);
      this.store(key, { tokens: refilled - 1, updatedAtMs: nowMs });
      return { allowed: true, retryAfterMs: 0, remaining };
    }
    const deficit = 1 - refilled;
    const retryAfterMs = Math.ceil(deficit / refillPerMs);
    this.store(key, { tokens: refilled, updatedAtMs: nowMs });
    return { allowed: false, retryAfterMs, remaining: 0 };
  }

  reset(key: string): void {
    this.states.delete(key);
  }

  resetAll(): void {
    this.states.clear();
  }

  private store(key: string, state: BucketState): void {
    if (!this.states.has(key) && this.states.size >= this.maxEntries) {
      const oldest = this.states.keys().next();
      if (!oldest.done) this.states.delete(oldest.value);
    }
    this.states.delete(key);
    this.states.set(key, state);
  }
}

export function retryAfterSeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

export const sharedRateLimiter = new TokenBucketLimiter();
