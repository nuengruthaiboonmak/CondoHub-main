import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireAdmin } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { systemClock } from '@/shared/utils/clock';
import { getFacilityDetail } from '@/modules/facility-booking/application/index';
import {
  listBookingsForFacility,
  listSlotsForBooking,
} from '@/modules/facility-booking/infrastructure/facilityRepository';
import { db } from '@/shared/db/client';

export const GET = withApi(
  async (_request, ctx, route) => {
    requireAdmin(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || id === '') {
      throw new AppError('VALIDATION_ERROR', 'The facility id is invalid.');
    }
    const detail = await getFacilityDetail(ctx.actor, id, systemClock.now());
    if (detail === null) throw new AppError('RESOURCE_NOT_FOUND');
    const bookings = await listBookingsForFacility(db, id);
    const rows = [];
    for (const booking of bookings) {
      const slots = await listSlotsForBooking(db, booking.id);
      rows.push({
        id: booking.id,
        roomId: booking.roomId,
        createdAt: booking.createdAt.toISOString(),
        slots: slots.map((slot) => ({
          id: slot.id,
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
          state: slot.state,
          refundQuota: slot.refundQuota,
        })),
      });
    }
    return { bookings: rows };
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
