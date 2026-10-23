import 'server-only';
import { NextResponse } from 'next/server';
import { db } from '@/shared/db/client';
import {
  acquireJobLease,
  finishJobLease,
  heartbeatJobLease,
} from '@/shared/db/jobLease';
import { verifyJobSecret } from '@/shared/auth/jobAuth';
import { AppError, toErrorEnvelope } from '@/shared/utils/errors';
import {
  RATE_LIMIT_PRESETS,
  RETRY_AFTER_HEADER,
  retryAfterSeconds,
  sharedRateLimiter,
} from '@/shared/utils/rateLimit';
import { childLogger } from '@/shared/observability/logger';
import { REQUEST_ID_HEADER, resolveRequestId } from '@/shared/observability/requestId';
import {
  createBillingCtx,
  generateInvoicesJobBody,
  parseWithFieldErrors,
  resolveGenerateWindow,
  runGenerateInvoices,
} from '@/modules/billing-payments/application/index';

function generateRateLimitKey(): string {
  return 'job-trigger:generate-invoices';
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestId = resolveRequestId(request.headers);
  const log = childLogger({ requestId });
  const startedAt = Date.now();
  try {
    const verdict = sharedRateLimiter.consume(
      generateRateLimitKey(),
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
    const body = parseWithFieldErrors(generateInvoicesJobBody, await request.json().catch(() => ({})));
    const window = await resolveGenerateWindow(
      {
        ...(body.fromCycle !== undefined ? { fromCycle: body.fromCycle } : {}),
        ...(body.toCycle !== undefined ? { toCycle: body.toCycle } : {}),
      },
      new Date(),
      db,
    );
    const businessKey = window.businessKey;
    const lease = await acquireJobLease(db, 'generate-invoices', businessKey, body.triggerSource);
    if (!lease.acquired) {
      const response = NextResponse.json({ data: { skipped: 'already-running' } });
      response.headers.set(REQUEST_ID_HEADER, requestId);
      return response;
    }
    const billingCtx = createBillingCtx({ requestId });
    const systemActor = {
      userId: 'system',
      isSystemAdmin: true,
      accountStatus: 'ACTIVE' as const,
      mustChangePassword: false,
    };
    try {
      await heartbeatJobLease(db, 'generate-invoices', businessKey, lease.attempt);
      const outcome = await runGenerateInvoices(
        systemActor,
        {
          ...(body.fromCycle !== undefined ? { fromCycle: body.fromCycle } : {}),
          ...(body.toCycle !== undefined ? { toCycle: body.toCycle } : {}),
        },
        billingCtx,
        {
          heartbeat: () => heartbeatJobLease(db, 'generate-invoices', businessKey, lease.attempt),
        },
      );
      await finishJobLease(db, 'generate-invoices', businessKey, lease.attempt, {
        state: 'DONE',
        result: outcome.redacted as unknown as Record<string, unknown>,
      });
      const response = NextResponse.json({
        data: {
          created: outcome.redacted.created,
          skipped: outcome.redacted.skipped,
          reviewRequired: outcome.redacted.reviewRequired,
          caughtUp: outcome.redacted.caughtUp,
          ...(outcome.redacted.nextFromCycle !== undefined
            ? { nextFromCycle: outcome.redacted.nextFromCycle }
            : {}),
        },
      });
      response.headers.set(REQUEST_ID_HEADER, requestId);
      return response;
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
      const message = error instanceof Error ? error.message : 'Generate run failed.';
      await finishJobLease(db, 'generate-invoices', businessKey, lease.attempt, {
        state: 'ERROR',
        error: { code, message },
      });
      throw error;
    }
  } catch (error) {
    const envelope = toErrorEnvelope(error, requestId);
    const status = error instanceof AppError ? error.httpStatus : 500;
    if (status >= 500) log.error({ err: error }, 'generate-invoices error');
    const response = NextResponse.json(envelope, { status });
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  } finally {
    log.info(
      { method: 'POST', path: '/api/internal/jobs/generate-invoices', elapsedMs: Date.now() - startedAt },
      'api request',
    );
  }
}
