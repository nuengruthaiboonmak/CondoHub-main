import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { isUuid } from '@/shared/utils/idempotency';
import { getCommonFeeEvent } from '@/modules/billing-payments/application/index';
import {
  cancelCommonFeeEvent,
  commonFeeEventCancelBody,
  createBillingCtx,
  parseWithFieldErrors,
} from '@/modules/billing-payments/application/index';

export const PATCH = withApi(async (request, ctx, route) => {
  requireAdmin(ctx.actor);
  const id = (await route?.params)?.id;
  if (!id || !isUuid(id)) throw new AppError('VALIDATION_ERROR', 'The charge event id is invalid.');
  parseWithFieldErrors(commonFeeEventCancelBody, await request.json());
  return cancelCommonFeeEvent(ctx.actor, id, createBillingCtx({ requestId: ctx.requestId }));
});

export const GET = withApi(
  async (_request, ctx, route) => {
    requireAdmin(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || !isUuid(id)) {
      throw new AppError('VALIDATION_ERROR', 'The charge event id is invalid.');
    }
    const detail = await getCommonFeeEvent(ctx.actor, id);
    if (detail === null) throw new AppError('RESOURCE_NOT_FOUND');
    return detail;
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
