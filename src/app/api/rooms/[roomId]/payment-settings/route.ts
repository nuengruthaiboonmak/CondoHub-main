import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { AppError } from '@/shared/utils/errors';
import { isUuid } from '@/shared/utils/idempotency';
import { requireActiveActor } from '@/shared/auth/guards';
import {
  createBillingCtx,
  parseWithFieldErrors,
  paymentSettingsBody,
  saveRoomPaymentSettings,
} from '@/modules/billing-payments/application/index';

export const PUT = withApi(async (request, ctx, route) => {
  requireActiveActor(ctx.actor);
  const roomId = (await route?.params)?.roomId;
  if (!roomId || !isUuid(roomId)) throw new AppError('VALIDATION_ERROR', 'The room id is invalid.');
  const input = parseWithFieldErrors(paymentSettingsBody, await request.json());
  return saveRoomPaymentSettings(
    ctx.actor,
    roomId,
    input,
    createBillingCtx({ requestId: ctx.requestId }),
  );
});
