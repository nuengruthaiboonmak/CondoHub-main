import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { getIdempotencyKey, isUuid } from '@/shared/utils/idempotency';
import {
  createMaintenanceCtx,
  parseWithFieldErrors,
  postTicketComment,
  ticketCommentBody,
} from '@/modules/maintenance/application/index';

export const dynamic = 'force-dynamic';

export const POST = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || !isUuid(id)) {
      throw new AppError('VALIDATION_ERROR', 'The ticket id is invalid.');
    }
    const body = parseWithFieldErrors(ticketCommentBody, await request.json());
    const idempotencyKey = getIdempotencyKey(request.headers);
    const maintenanceCtx = createMaintenanceCtx({ requestId: ctx.requestId });
    return postTicketComment(
      ctx.actor,
      id,
      {
        body: body.body,
        imageIds: body.imageIds,
        ...(idempotencyKey !== null ? { idempotencyKey } : {}),
      },
      maintenanceCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
