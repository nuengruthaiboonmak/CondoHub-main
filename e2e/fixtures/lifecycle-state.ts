import { runUsername } from './run-context';
import { requireScopedAdministrator } from './scoped-administrator';
import { loadDotenv } from '../../src/config/dotenv';
loadDotenv('.env.local');

async function main() {
  const runId = process.argv[2] ?? '';
  const administrator = await requireScopedAdministrator(runId);
  const { db } = await import('../../src/shared/db/client');
  const { sql } = await import('drizzle-orm');
  const buildingName = `E2E-${runId}-Lifecycle`;
  const username = runUsername(runId, `lifecycle`);
  const announcementTitle = `E2E-${runId}-LifecycleAnnouncement`;
  if (process.argv[3] === 'seed-payee') {
    const { assertSeedAllowed } = await import('../../scripts/seed-common');
    assertSeedAllowed();
    const roomId = process.argv[4];
    const adminId = process.argv[5];
    if (!roomId || !adminId) throw new Error('Scoped seed identifiers are required.');
    const owned = await db.execute(
      sql`select id from room where id = ${roomId} and building_id in (select id from building where name in (${buildingName}, ${`E2E-${runId}-ScheduledRental`})) and deleted_at is null`,
    );
    const admins = await db.execute(
      sql`select id from "user" where id = ${adminId} and id = ${administrator.id}`,
    );
    if (owned.rows.length !== 1 || admins.rows.length !== 1)
      throw new Error('The seed is outside the lifecycle fixture.');
    const { createBillingCtx, seedPayeeInstruction } = await import(
      '../../src/modules/billing-payments/application/index'
    );
    await seedPayeeInstruction(
      { userId: adminId, isSystemAdmin: true, accountStatus: 'ACTIVE', mustChangePassword: false },
      {
        payeeType: 'PROJECT',
        payeeId: roomId,
        bankName: 'Lifecycle test bank',
        accountName: 'Lifecycle receiving account',
        accountNumber: '111-000-3333',
        effectiveFrom: new Date('2023-01-01T00:00:00Z'),
      },
      createBillingCtx({ requestId: `lifecycle-${runId}`, isSeedActor: true }),
    );
    process.stdout.write(JSON.stringify({ ready: true }));
    return;
  }
  const result = await db.execute(sql`select
    (select count(*)::int from building where name = ${buildingName} and deleted_at is not null) as buildings,
    (select count(*)::int from floor where building_id in (select id from building where name = ${buildingName}) and deleted_at is not null) as floors,
    (select count(*)::int from room where building_id in (select id from building where name = ${buildingName}) and deleted_at is not null) as rooms,
    (select count(*)::int from rental_period where room_id in (select id from room where building_id in (select id from building where name = ${buildingName})) and state='ENDED') as rentals,
    (select count(*)::int from room_membership where room_id in (select id from room where building_id in (select id from building where name = ${buildingName})) and end_at is not null) as memberships,
    (select count(*)::int from invoice where room_id in (select id from room where building_id in (select id from building where name = ${buildingName}))) as invoices,
    (select count(*)::int from "user" where username = ${username} and deleted_at is not null and account_status='SUSPENDED') as users,
    (select count(*)::int from session where user_id in (select id from "user" where username = ${username} and deleted_at is not null)) as sessions,
    (select count(*)::int from announcement where title = ${announcementTitle} and deleted_at is not null) as announcements
  `);
  process.stdout.write(JSON.stringify(result.rows[0]));
}
void main().then(
  () => process.exit(0),
  () => {
    process.stderr.write('Could not inspect the scoped lifecycle fixture.');
    process.exit(1);
  },
);
