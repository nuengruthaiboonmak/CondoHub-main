import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { isUuid } from '@/shared/utils/idempotency';
import {
  createMaintenanceCtx,
  getTicket,
  parseWithFieldErrors,
  ticketTransitionBody,
  transitionTicket,
} from '@/modules/maintenance/application/index';

export const dynamic = 'force-dynamic';

export const GET = withApi(
  async (_request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || !isUuid(id)) {
      throw new AppError('VALIDATION_ERROR', 'The ticket id is invalid.');
    }
    const detail = await getTicket(ctx.actor, id);
    if (detail === null) throw new AppError('RESOURCE_NOT_FOUND');
    return detail;
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);

export const PATCH = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || !isUuid(id)) {
      throw new AppError('VALIDATION_ERROR', 'The ticket id is invalid.');
    }
    const body = parseWithFieldErrors(ticketTransitionBody, await request.json());
    const maintenanceCtx = createMaintenanceCtx({ requestId: ctx.requestId });
    return transitionTicket(
      ctx.actor,
      id,
      {
        status: body.status,
        expectedVersion: body.expectedVersion,
        ...(body.reason !== undefined ? { reason: body.reason } : {}),
      },
      maintenanceCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
