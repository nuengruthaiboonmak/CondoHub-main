import { randomUUID } from 'node:crypto';
import { assertSeedAllowed, loadDotenv } from '../../scripts/seed-common';
loadDotenv('.env.local');
async function main() {
  assertSeedAllowed();
  const [facilityId, roomId, userId, runId] = process.argv.slice(2);
  if (!facilityId || !roomId || !userId || !runId) throw new Error('Missing fixture arguments.');
  const booking = await import('../../src/modules/facility-booking/application/index');
  const property = await import('../../src/modules/property-membership/application/index');
  const actor = {
    userId,
    isSystemAdmin: true,
    accountStatus: 'ACTIVE' as const,
    mustChangePassword: false,
  };
  const detail = await booking.getFacilityDetail(actor, facilityId, new Date());
  const room = await property.getRoomDetail(roomId);
  if (!detail?.code.startsWith(`E2E-${runId}-delete`) || !room.roomCode.startsWith(`E2E-${runId}-`))
    throw new Error('Fixture is outside this run.');
  const now = Date.now();
  const slots = [-2, 2].map((days) => ({
    startsAt: new Date(now + days * 86400000),
    endsAt: new Date(now + days * 86400000 + 3600000),
  }));
  const result = await booking.seedDirectBooking(
    actor,
    { facilityId, roomId, slots, createdBy: userId },
    booking.createBookingCtx({ requestId: randomUUID(), isSeedActor: true }),
  );
  console.log(JSON.stringify(result));
}
void main().then(
  () => process.exit(0),
  () => {
    console.error('Facility deletion booking fixture failed.');
    process.exit(1);
  },
);
