import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from '@/modules/identity-access/infrastructure/betterAuthSchema';
import { room } from '@/modules/property-membership/infrastructure/schema';

export const facilityStatus = pgEnum('facility_status', ['ACTIVE', 'INACTIVE']);

export type FacilityStatus = (typeof facilityStatus.enumValues)[number];

export const quotaKind = pgEnum('quota_kind', ['DAILY', 'WEEKLY', 'MONTHLY']);

export type QuotaKind = (typeof quotaKind.enumValues)[number];

export const bookingSlotState = pgEnum('booking_slot_state', [
  'CONFIRMED',
  'RESIDENT_CANCELLED',
  'ADMIN_CANCELLED',
]);

export type BookingSlotState = (typeof bookingSlotState.enumValues)[number];

export const quotaAdjustmentType = pgEnum('quota_adjustment_type', ['REFUND_CREDIT']);

export type QuotaAdjustmentType = (typeof quotaAdjustmentType.enumValues)[number];

export const facility = pgTable(
  'facility',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    status: facilityStatus('status').notNull(),
    capacity: integer('capacity').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    unique('facility_project_code_uq').on(table.projectId, table.code),
    check('facility_capacity_positive_ck', sql`"capacity" > 0`),
  ],
);

export type FacilityRow = typeof facility.$inferSelect;
export type FacilityInsert = typeof facility.$inferInsert;

export const facilityConfig = pgTable(
  'facility_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facility.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
    isPending: boolean('is_pending').notNull(),
    scheduleJson: jsonb('schedule_json').notNull(),
    slotMinutes: integer('slot_minutes').notNull(),
    quotaKind: quotaKind('quota_kind').notNull(),
    quotaLimit: integer('quota_limit').notNull(),
    advanceDays: integer('advance_days').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('facility_config_pending_puq')
      .on(table.facilityId)
      .where(sql`"is_pending"`),
    unique('facility_config_version_uq').on(table.facilityId, table.version),
    check('facility_config_slot_positive_ck', sql`"slot_minutes" > 0`),
    check('facility_config_quota_limit_ck', sql`"quota_limit" >= 0`),
    check('facility_config_advance_days_ck', sql`"advance_days" >= 0`),
    index('facility_config_facility_idx').on(table.facilityId, table.effectiveAt),
  ],
);

export type FacilityConfigRow = typeof facilityConfig.$inferSelect;
export type FacilityConfigInsert = typeof facilityConfig.$inferInsert;

export const facilityClosure = pgTable(
  'facility_closure',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facility.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    reason: text('reason').notNull(),
    author: text('author').references(() => user.id, { onDelete: 'set null' }),
  },
  (table) => [
    check('facility_closure_interval_ck', sql`"ends_at" > "starts_at"`),
    index('facility_closure_facility_idx').on(table.facilityId, table.startsAt),
  ],
);

export type FacilityClosureRow = typeof facilityClosure.$inferSelect;
export type FacilityClosureInsert = typeof facilityClosure.$inferInsert;

export const booking = pgTable(
  'booking',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'restrict' }),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facility.id, { onDelete: 'restrict' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('booking_room_idx').on(table.roomId),
    index('booking_facility_idx').on(table.facilityId),
  ],
);

export type BookingRow = typeof booking.$inferSelect;
export type BookingInsert = typeof booking.$inferInsert;

export const bookingSlot = pgTable(
  'booking_slot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => booking.id, { onDelete: 'restrict' }),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facility.id, { onDelete: 'restrict' }),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    state: bookingSlotState('state').notNull(),
    canceledBy: text('canceled_by').references(() => user.id, { onDelete: 'set null' }),
    refundQuota: boolean('refund_quota').notNull().default(false),
  },
  (table) => [
    check('booking_slot_interval_ck', sql`"ends_at" > "starts_at"`),
    index('booking_slot_facility_idx').on(table.facilityId, table.startsAt),
    index('booking_slot_room_idx').on(table.roomId, table.facilityId, table.startsAt),
    index('booking_slot_state_idx').on(table.state),
    index('booking_slot_booking_idx').on(table.bookingId),
  ],
);

export type BookingSlotRow = typeof bookingSlot.$inferSelect;
export type BookingSlotInsert = typeof bookingSlot.$inferInsert;

export const quotaAdjustment = pgTable(
  'quota_adjustment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    bookingSlotId: uuid('booking_slot_id')
      .notNull()
      .references(() => bookingSlot.id, { onDelete: 'restrict' }),
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'restrict' }),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facility.id, { onDelete: 'restrict' }),
    periodKey: text('period_key').notNull(),
    adjustmentType: quotaAdjustmentType('adjustment_type').notNull(),
    signedSlots: integer('signed_slots').notNull(),
    reason: text('reason').notNull(),
    actorId: text('actor_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('quota_adjustment_slot_type_uq').on(table.bookingSlotId, table.adjustmentType),
    check('quota_adjustment_signed_positive_ck', sql`"signed_slots" > 0`),
    index('quota_adjustment_period_idx').on(table.roomId, table.facilityId, table.periodKey),
  ],
);

export type QuotaAdjustmentRow = typeof quotaAdjustment.$inferSelect;
export type QuotaAdjustmentInsert = typeof quotaAdjustment.$inferInsert;

export const quotaPeriodLock = pgTable(
  'quota_period_lock',
  {
    roomId: uuid('room_id')
      .notNull()
      .references(() => room.id, { onDelete: 'restrict' }),
    facilityId: uuid('facility_id')
      .notNull()
      .references(() => facility.id, { onDelete: 'restrict' }),
    periodKey: text('period_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.roomId, table.facilityId, table.periodKey] })],
);

export type QuotaPeriodLockRow = typeof quotaPeriodLock.$inferSelect;
export type QuotaPeriodLockInsert = typeof quotaPeriodLock.$inferInsert;
