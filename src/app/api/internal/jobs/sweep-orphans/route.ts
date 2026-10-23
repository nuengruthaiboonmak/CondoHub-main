import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/shared/db/client';
import {
  acquireJobLease,
  finishJobLease,
  heartbeatJobLease,
} from '@/shared/db/jobLease';
import { verifyJobSecret } from '@/shared/auth/jobAuth';
import { AppError, toErrorEnvelope } from '@/shared/utils/errors';
import { parseWithFieldErrors } from '@/shared/utils/parseBody';
import {
  RATE_LIMIT_PRESETS,
  RETRY_AFTER_HEADER,
  retryAfterSeconds,
  sharedRateLimiter,
} from '@/shared/utils/rateLimit';
import { childLogger } from '@/shared/observability/logger';
import { REQUEST_ID_HEADER, resolveRequestId } from '@/shared/observability/requestId';
import { formatProjectDate, projectDateParts } from '@/shared/utils/clock';
import {
  SWEEP_ORPHANS_MAX_ROWS,
  createMediaCtx,
  sweepOrphanImages,
} from '@/modules/media-attachments/application/index';

const jobTriggerBody = z
  .object({
    triggerSource: z.enum(['CRON', 'MANUAL', 'STARTUP_DEFERRED']),
    fromCycle: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    toCycle: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    batchSize: z.number().int().min(1).max(500).optional(),
  })
  .strict();

function sweepRateLimitKey(): string {
  return 'job-trigger:sweep-orphans';
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = resolveRequestId(request.headers);
  const log = childLogger({ requestId });
  const startedAt = Date.now();
  try {
    const verdict = sharedRateLimiter.consume(
      sweepRateLimitKey(),
      RATE_LIMIT_PRESETS.jobTrigger ?? { capacity: 10, windowMs: 60_000 },
    );
    if (!verdict.allowed) {
      const envelope = toErrorEnvelope(new AppError('RATE_LIMITED'), requestId);
      const limited = NextResponse.json(envelope, { status: 429 });
      limited.headers.set(RETRY_AFTER_HEADER, String(retryAfterSeconds(verdict.retryAfterMs)));
      limited.headers.set(REQUEST_ID_HEADER, requestId);
      return limited;
    }
    verifyJobSecret(request);
    const body = parseWithFieldErrors(jobTriggerBody, await request.json().catch(() => ({})));
    const runDate = formatProjectDate(projectDateParts(new Date()));
    const lease = await acquireJobLease(db, 'sweep-orphans', runDate, body.triggerSource);
    if (!lease.acquired) {
      const response = NextResponse.json({ data: { skipped: 'already-running' } });
      response.headers.set(REQUEST_ID_HEADER, requestId);
      return response;
    }
    const mediaCtx = createMediaCtx({ requestId });
    try {
      await heartbeatJobLease(db, 'sweep-orphans', runDate, lease.attempt);
      const sweep = await sweepOrphanImages(mediaCtx, {
        heartbeat: () => heartbeatJobLease(db, 'sweep-orphans', runDate, lease.attempt),
      });
      await finishJobLease(db, 'sweep-orphans', runDate, lease.attempt, {
        state: 'DONE',
        result: {
          transitioned: sweep.transitioned,
          skippedYoung: sweep.skippedYoung,
          skippedRaced: sweep.skippedRaced,
          s3Deleted: sweep.s3Deleted,
          s3Failures: sweep.s3Failures,
          caughtUp: sweep.caughtUp,
        },
      });
      log.info(
        {
          job: 'sweep-orphans',
          businessKey: runDate,
          transitioned: sweep.transitioned,
          skippedYoung: sweep.skippedYoung,
          skippedRaced: sweep.skippedRaced,
          s3Deleted: sweep.s3Deleted,
          s3Failures: sweep.s3Failures,
          maxRows: SWEEP_ORPHANS_MAX_ROWS,
        },
        'sweep-orphans done',
      );
      const response = NextResponse.json({
        data: {
          created: 0,
          skipped: sweep.skippedYoung + sweep.skippedRaced,
          reviewRequired: sweep.transitioned,
          caughtUp: sweep.caughtUp,
        },
      });
      response.headers.set(REQUEST_ID_HEADER, requestId);
      return response;
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
      const message = error instanceof Error ? error.message : 'Sweep run failed.';
      await finishJobLease(db, 'sweep-orphans', runDate, lease.attempt, {
        state: 'ERROR',
        error: { code, message },
      });
      throw error;
    }
  } catch (error) {
    const envelope = toErrorEnvelope(error, requestId);
    const status = error instanceof AppError ? error.httpStatus : 500;
    if (status >= 500) log.error({ err: error }, 'sweep-orphans error');
    const response = NextResponse.json(envelope, { status });
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  } finally {
    log.info(
      { method: 'POST', path: '/api/internal/jobs/sweep-orphans', elapsedMs: Date.now() - startedAt },
      'api request',
    );
  }
}
