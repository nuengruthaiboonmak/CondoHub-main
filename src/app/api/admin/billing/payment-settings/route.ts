import 'server-only';
import { requireActiveActor } from '@/shared/auth/guards';
import { withApi } from '@/shared/auth/withApi';
import {
  createBillingCtx,
  parseWithFieldErrors,
  paymentSettingsBody,
  saveProjectPaymentSettings,
} from '@/modules/billing-payments/application/index';

export const PUT = withApi(async (request, ctx) => {
  requireActiveActor(ctx.actor);
  const input = parseWithFieldErrors(paymentSettingsBody, await request.json());
  return saveProjectPaymentSettings(
    ctx.actor,
    input,
    createBillingCtx({ requestId: ctx.requestId }),
  );
});
