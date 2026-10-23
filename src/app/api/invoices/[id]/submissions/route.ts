import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { isUuid } from '@/shared/utils/idempotency';
import {
  createBillingCtx,
  parseWithFieldErrors,
  paymentSubmitBody,
  submitPayment,
} from '@/modules/billing-payments/application/index';

export const POST = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || !isUuid(id)) {
      throw new AppError('VALIDATION_ERROR', 'The invoice id is invalid.');
    }
    const body = parseWithFieldErrors(paymentSubmitBody, await request.json());
    const billingCtx = createBillingCtx({ requestId: ctx.requestId });
    return submitPayment(ctx.actor, id, { imageId: body.imageId }, billingCtx);
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
