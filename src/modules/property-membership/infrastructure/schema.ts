import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from '@/modules/identity-access/infrastructure/betterAuthSchema';

export const buildingStatus = pgEnum('building_status', ['ACTIVE', 'INACTIVE']);

export type BuildingStatus = (typeof buildingStatus.enumValues)[number];

export const roomStatus = pgEnum('room_status', ['ACTIVE', 'INACTIVE']);

export type RoomStatus = (typeof roomStatus.enumValues)[number];

export const building = pgTable(
  'building',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    status: buildingStatus('status').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('building_project_code_uq').on(table.projectId, table.code)],
);

export const floor = pgTable(
  'floor',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    buildingId: uuid('building_id')
      .notNull()
      .references(() => building.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    label: text('label').notNull(),
    status: buildingStatus('status').notNull().default('ACTIVE'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    unique('floor_building_code_uq').on(table.buildingId, table.code),
    unique('floor_id_building_uq').on(table.id, table.buildingId),
  ],
);

export const room = pgTable(
  'room',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    floorId: uuid('floor_id').notNull(),
    buildingId: uuid('building_id').notNull(),
    roomCode: text('room_code').notNull(),
    name: text('name').notNull().default(''),
    areaSqm: numeric('area_sqm').notNull(),
    status: roomStatus('status').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    unique('room_building_code_uq').on(table.buildingId, table.roomCode),
    foreignKey({
      name: 'room_floor_building_fk',
      columns: [table.floorId, table.buildingId],
      foreignColumns: [floor.id, floor.buildingId],
    })
      .onDelete('restrict')
      .onUpdate('cascade'),
    check('room_area_positive_ck', sql`"area_sqm" > 0`),
  ],
);

export const rentalState = pgEnum('rental_state', ['ACTIVE', 'ENDED', 'CANCELLED']);

export type RentalState = (typeof rentalState.enumValues)[number];

export const managementMode = pgEnum('management_mode', [
  'PROJECT_MANAGED',
  'PRIVATE_OWNER_MANAGED',
]);

export type ManagementMode = (typeof managementMode.enumValues)[number];

export const memberRole = pgEnum('member_role', ['MAIN', 'SUB']);

export type MemberRole = (typeof memberRole.enumValues)[number];

export const roomOwnership = pgTable(
  'room_ownership',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }),
    grantedBy: text('granted_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('room_ownership_interval_ck', sql`"end_at" IS NULL OR "end_at" > "start_at"`),
    index('room_ownership_room_idx').on(table.roomId),
    index('room_ownership_user_idx').on(table.userId),
  ],
);

export type RoomOwnershipRow = typeof roomOwnership.$inferSelect;
export type RoomOwnershipInsert = typeof roomOwnership.$inferInsert;

export const rentalPeriod = pgTable(
  'rental_period',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    state: rentalState('state').notNull(),
    managementMode: managementMode('management_mode').notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (table) => [
    check('rental_period_interval_ck', sql`"ends_at" IS NULL OR "ends_at" > "starts_at"`),
    index('rental_period_room_idx').on(table.roomId),
  ],
);

export type RentalPeriodRow = typeof rentalPeriod.$inferSelect;
export type RentalPeriodInsert = typeof rentalPeriod.$inferInsert;

export const roomMembership = pgTable(
  'room_membership',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'restrict' }),
    tenancyId: uuid('tenancy_id').references(() => rentalPeriod.id, { onDelete: 'restrict' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    memberRole: memberRole('member_role').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('room_membership_interval_ck', sql`"end_at" IS NULL OR "end_at" > "start_at"`),
    uniqueIndex('room_membership_active_tenancy_puq')
      .on(table.roomId, table.userId, table.tenancyId)
      .where(sql`"end_at" IS NULL`),
    uniqueIndex('room_membership_active_direct_puq')
      .on(table.roomId, table.userId)
      .where(sql`"end_at" IS NULL AND "tenancy_id" IS NULL`),
    index('room_membership_room_idx').on(table.roomId),
    index('room_membership_user_idx').on(table.userId),
    index('room_membership_tenancy_idx').on(table.tenancyId),
  ],
);

export type RoomMembershipRow = typeof roomMembership.$inferSelect;
export type RoomMembershipInsert = typeof roomMembership.$inferInsert;
