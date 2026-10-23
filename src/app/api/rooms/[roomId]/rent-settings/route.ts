import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { isUuid } from '@/shared/utils/idempotency';
import {
  createBillingCtx,
  parseWithFieldErrors,
  rentSettingsBody,
  saveRentSettings,
} from '@/modules/billing-payments/application/index';
export const PUT = withApi(async (request, ctx, route) => {
  requireActiveActor(ctx.actor);
  const roomId = (await route?.params)?.roomId;
  if (!roomId || !isUuid(roomId)) throw new AppError('VALIDATION_ERROR');
  const input = parseWithFieldErrors(rentSettingsBody, await request.json());
  return saveRentSettings(ctx.actor, roomId, input, createBillingCtx({ requestId: ctx.requestId }));
});
