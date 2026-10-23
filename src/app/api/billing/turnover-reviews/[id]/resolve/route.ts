import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { getIdempotencyKey, isUuid } from '@/shared/utils/idempotency';
import {
  createBillingCtx,
  parseWithFieldErrors,
  resolveTurnoverBody,
  resolveTurnoverReview,
} from '@/modules/billing-payments/application/index';

export const POST = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || !isUuid(id)) {
      throw new AppError('VALIDATION_ERROR', 'The turnover review id is invalid.');
    }
    const body = parseWithFieldErrors(resolveTurnoverBody, await request.json());
    const idempotencyKey = getIdempotencyKey(request.headers);
    const billingCtx = createBillingCtx({ requestId: ctx.requestId });
    if (body.decision === 'NO_CHARGE') {
      return resolveTurnoverReview(
        ctx.actor,
        id,
        {
          decision: 'NO_CHARGE',
          selectedTenancyIds: [],
          reason: body.reason,
          expectedVersion: body.expectedVersion,
          ...(idempotencyKey !== null ? { idempotencyKey } : {}),
        },
        billingCtx,
      );
    }
    return resolveTurnoverReview(
      ctx.actor,
      id,
      {
        decision: 'ISSUE_INVOICES',
        selectedTenancyIds: body.selectedTenancyIds,
        perInvoice: body.perInvoice.map((entry) => ({
          tenancyId: entry.tenancyId,
          dueDate: entry.dueDate,
          ...(entry.confirmPastDueDate !== undefined
            ? { confirmPastDueDate: entry.confirmPastDueDate }
            : {}),
          ...(entry.amountOverride !== undefined ? { amountOverride: entry.amountOverride } : {}),
          ...(entry.overrideReason !== undefined ? { overrideReason: entry.overrideReason } : {}),
        })),
        expectedVersion: body.expectedVersion,
        ...(idempotencyKey !== null ? { idempotencyKey } : {}),
      },
      billingCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
