import 'server-only';
import { paged, withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { systemClock } from '@/shared/utils/clock';
import {
  parseWithFieldErrors,
  resolveActorRooms,
} from '@/modules/property-membership/application/index';
import { roomListQuery } from '@/modules/property-membership/application/routeSchemas';

export const GET = withApi(
  async (request, ctx) => {
    requireActiveActor(ctx.actor);
    const url = new URL(request.url);
    const query = parseWithFieldErrors(roomListQuery, {
      query: url.searchParams.get('query') ?? undefined,
      buildingId: url.searchParams.get('buildingId') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
    });
    const rooms = await resolveActorRooms(ctx.actor, systemClock.now());
    const filtered = rooms.filter(
      (room) =>
        (query.buildingId === undefined || room.buildingId === query.buildingId) &&
        (query.status === undefined || room.status === query.status) &&
        (query.query === undefined ||
          `${room.name} ${room.roomCode}`.toLowerCase().includes(query.query.toLowerCase())),
    );
    const total = filtered.length;
    const start = (query.page - 1) * query.pageSize;
    const page = filtered.slice(start, start + query.pageSize);
    if (query.buildingId !== undefined && ctx.actor.isSystemAdmin === false && total === 0) {
      throw new AppError('RESOURCE_NOT_FOUND');
    }
    return paged(
      page.map((room) => ({
        id: room.id,
        floorId: room.floorId,
        buildingId: room.buildingId,
        roomCode: room.roomCode,
        name: room.name,
        areaSqm: room.areaSqm,
        status: room.status,
      })),
      { page: query.page, pageSize: query.pageSize, total },
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
