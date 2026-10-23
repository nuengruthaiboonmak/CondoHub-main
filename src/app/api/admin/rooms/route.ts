import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import {
  createPropertyCtx,
  createRoom,
  parseWithFieldErrors,
} from '@/modules/property-membership/application/index';
import { roomBody } from '@/modules/property-membership/application/routeSchemas';

export const POST = withApi(
  async (request, ctx) => {
    requireAdmin(ctx.actor);
    const body = parseWithFieldErrors(roomBody, await request.json());
    const propertyCtx = createPropertyCtx({ requestId: ctx.requestId });
    return createRoom(
      ctx.actor,
      {
        floorId: body.floorId,
        buildingId: body.buildingId,
        roomCode: body.roomCode,
        name: body.name,
        areaSqm: body.areaSqm,
        status: body.status,
      },
      propertyCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
