import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { getIdempotencyKey, isUuid } from '@/shared/utils/idempotency';
import {
  approvePaymentSubmission,
  createBillingCtx,
  parseWithFieldErrors,
  paymentApproveBody,
} from '@/modules/billing-payments/application/index';

export const POST = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || !isUuid(id)) {
      throw new AppError('VALIDATION_ERROR', 'The payment submission id is invalid.');
    }
    const body = parseWithFieldErrors(paymentApproveBody, await request.json());
    const idempotencyKey = getIdempotencyKey(request.headers);
    const billingCtx = createBillingCtx({ requestId: ctx.requestId });
    return approvePaymentSubmission(
      ctx.actor,
      id,
      {
        amount: body.amount,
        ...(idempotencyKey !== null ? { idempotencyKey } : {}),
      },
      billingCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
