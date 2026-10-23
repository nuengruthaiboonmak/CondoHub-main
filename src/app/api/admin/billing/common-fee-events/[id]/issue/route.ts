import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { isUuid } from '@/shared/utils/idempotency';
import {
  commonFeeEventIssueBody,
  createBillingCtx,
  issueCommonFeeEvent,
  parseWithFieldErrors,
} from '@/modules/billing-payments/application/index';

export const POST = withApi(async (request, ctx, route) => {
  requireAdmin(ctx.actor);
  const id = (await route?.params)?.id;
  if (!id || !isUuid(id)) throw new AppError('VALIDATION_ERROR', 'The charge event id is invalid.');
  const body = parseWithFieldErrors(commonFeeEventIssueBody, await request.json());
  return issueCommonFeeEvent(ctx.actor, id, body, createBillingCtx({ requestId: ctx.requestId }));
});
