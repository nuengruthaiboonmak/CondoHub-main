import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { systemClock } from '@/shared/utils/clock';
import {
  listRoomBookings,
  parseWithFieldErrors,
  roomBookingsQuery,
} from '@/modules/facility-booking/application/index';

export const GET = withApi(
  async (request, ctx) => {
    requireActiveActor(ctx.actor);
    const url = new URL(request.url);
    const query = parseWithFieldErrors(roomBookingsQuery, {
      roomId: url.searchParams.get('roomId') ?? undefined,
      facilityId: url.searchParams.get('facilityId') ?? undefined,
    });
    const rows = await listRoomBookings(
      ctx.actor,
      { roomId: query.roomId, facilityId: query.facilityId },
      systemClock.now(),
    );
    return { bookings: rows };
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
