import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  commonFeeEventCreateBody,
  createBillingCtx,
  createCommonFeeEvent,
  parseWithFieldErrors,
} from '@/modules/billing-payments/application/index';

export const POST = withApi(
  async (request, ctx) => {
    requireAdmin(ctx.actor);
    const body = parseWithFieldErrors(commonFeeEventCreateBody, await request.json());
    const billingCtx = createBillingCtx({ requestId: ctx.requestId });
    const created = await createCommonFeeEvent(
      ctx.actor,
      {
        eventEffectiveDate: body.eventEffectiveDate,
        status: body.status,
        ...(body.sourceRuleId !== undefined ? { sourceRuleId: body.sourceRuleId } : {}),
        ...(body.configuredAmount !== undefined ? { configuredAmount: body.configuredAmount } : {}),
        ...(body.chargeContext !== undefined ? { chargeContext: body.chargeContext } : {}),
      },
      billingCtx,
    );
    return created;
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
