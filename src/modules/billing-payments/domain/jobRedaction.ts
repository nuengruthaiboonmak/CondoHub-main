import { AppError } from '@/shared/utils/errors';

export interface JobCounts {
  created: number;
  skipped: number;
  reviewRequired: number;
  caughtUp: boolean;
  nextFromCycle?: string | undefined;
  privateRentCreated: number;
  privateRentSkipped: number;
  privateReviews: number;
  cycleErrors: number;
}

export interface RedactedJobResult {
  created: number;
  skipped: number;
  reviewRequired: number;
  caughtUp: boolean;
  nextFromCycle?: string | undefined;
}

export interface SweeperJobResult {
  transitioned: number;
  skippedYoung: number;
  skippedRaced: number;
  s3Deleted: number;
  s3Failures: number;
  caughtUp: boolean;
}

export type AdminJobResult = RedactedJobResult | SweeperJobResult;

const REDACTED_KEYS = ['created', 'skipped', 'reviewRequired', 'caughtUp', 'nextFromCycle'];

const SWEEPER_KEYS = [
  'transitioned',
  'skippedYoung',
  'skippedRaced',
  's3Deleted',
  's3Failures',
  'caughtUp',
];

const YEAR_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export function redactJobResult(counts: JobCounts): RedactedJobResult {
  const result: RedactedJobResult = {
    created: Math.max(0, counts.created - counts.privateRentCreated),
    skipped: Math.max(0, counts.skipped - counts.privateRentSkipped),
    reviewRequired: Math.max(0, counts.reviewRequired - counts.privateReviews),
    caughtUp: counts.caughtUp,
  };
  if (counts.nextFromCycle !== undefined) result.nextFromCycle = counts.nextFromCycle;
  return result;
}

export function emptyJobCounts(caughtUp: boolean): JobCounts {
  return {
    created: 0,
    skipped: 0,
    reviewRequired: 0,
    caughtUp,
    privateRentCreated: 0,
    privateRentSkipped: 0,
    privateReviews: 0,
    cycleErrors: 0,
  };
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function assertSweeperJobResult(value: unknown): SweeperJobResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError('INTERNAL_ERROR', 'The job result shape is invalid.');
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!SWEEPER_KEYS.includes(key)) {
      throw new AppError('INTERNAL_ERROR', 'The job result shape is invalid.');
    }
  }
  if (
    !isNonNegativeInt(record.transitioned) ||
    !isNonNegativeInt(record.skippedYoung) ||
    !isNonNegativeInt(record.skippedRaced) ||
    !isNonNegativeInt(record.s3Deleted) ||
    !isNonNegativeInt(record.s3Failures) ||
    typeof record.caughtUp !== 'boolean'
  ) {
    throw new AppError('INTERNAL_ERROR', 'The job result shape is invalid.');
  }
  return {
    transitioned: record.transitioned,
    skippedYoung: record.skippedYoung,
    skippedRaced: record.skippedRaced,
    s3Deleted: record.s3Deleted,
    s3Failures: record.s3Failures,
    caughtUp: record.caughtUp,
  };
}

export function assertRedactedJobResult(value: unknown, jobName: string): AdminJobResult | null {
  if (value === null || value === undefined) return null;
  if (jobName === 'sweep-orphans') return assertSweeperJobResult(value);
  if (jobName !== 'generate-invoices') {
    throw new AppError('INTERNAL_ERROR', 'The job result shape is invalid.');
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('INTERNAL_ERROR', 'The job result shape is invalid.');
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!REDACTED_KEYS.includes(key)) {
      throw new AppError('INTERNAL_ERROR', 'The job result shape is invalid.');
    }
  }
  if (
    !isNonNegativeInt(record.created) ||
    !isNonNegativeInt(record.skipped) ||
    !isNonNegativeInt(record.reviewRequired) ||
    typeof record.caughtUp !== 'boolean'
  ) {
    throw new AppError('INTERNAL_ERROR', 'The job result shape is invalid.');
  }
  const result: RedactedJobResult = {
    created: record.created,
    skipped: record.skipped,
    reviewRequired: record.reviewRequired,
    caughtUp: record.caughtUp,
  };
  if (record.nextFromCycle !== undefined) {
    if (typeof record.nextFromCycle !== 'string' || !YEAR_MONTH_REGEX.test(record.nextFromCycle)) {
      throw new AppError('INTERNAL_ERROR', 'The job result shape is invalid.');
    }
    result.nextFromCycle = record.nextFromCycle;
  }
  return result;
}
