import 'server-only';
import { and, asc, desc, eq, gt, gte, isNull, ilike, inArray, lte, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/shared/db/transaction';
import {
  booking,
  bookingSlot,
  facility,
  facilityClosure,
  facilityConfig,
  quotaAdjustment,
  quotaPeriodLock,
  type BookingSlotState,
  type FacilityStatus,
  type QuotaKind,
} from './schema';

export interface FacilityRecord {
  id: string;
  projectId: string;
  code: string;
  name: string;
  description: string | null;
  status: FacilityStatus;
  capacity: number;
}

function toFacilityRow(row: typeof facility.$inferSelect): FacilityRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    code: row.code,
    name: row.name,
    description: row.description,
    status: row.status,
    capacity: row.capacity,
  };
}

export async function findFacilityById(conn: Db, id: string): Promise<FacilityRecord | null> {
  const rows = await conn
    .select()
    .from(facility)
    .where(and(eq(facility.id, id), isNull(facility.deletedAt)))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toFacilityRow(row);
}

export async function listFacilities(conn: Db): Promise<FacilityRecord[]> {
  const rows = await conn
    .select()
    .from(facility)
    .where(isNull(facility.deletedAt))
    .orderBy(asc(facility.name), asc(facility.id));
  return rows.map(toFacilityRow);
}

export async function insertFacility(
  tx: Tx,
  input: {
    projectId: string;
    code: string;
    name: string;
    description?: string | null | undefined;
    status: FacilityStatus;
    capacity: number;
  },
): Promise<FacilityRecord> {
  const rows = await tx
    .insert(facility)
    .values({
      projectId: input.projectId,
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      status: input.status,
      capacity: input.capacity,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Facility insert returned no row.');
  return toFacilityRow(row);
}

export async function updateFacility(
  tx: Tx,
  id: string,
  input: {
    name?: string | undefined;
    description?: string | null | undefined;
    status?: FacilityStatus | undefined;
    capacity?: number | undefined;
  },
): Promise<FacilityRecord | null> {
  const rows = await tx
    .update(facility)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
    })
    .where(and(eq(facility.id, id), isNull(facility.deletedAt)))
    .returning();
  const row = rows[0];
  return row === undefined ? null : toFacilityRow(row);
}

export interface FacilityConfigRecord {
  id: string;
  facilityId: string;
  version: number;
  effectiveAt: Date;
  isPending: boolean;
  scheduleJson: unknown;
  slotMinutes: number;
  quotaKind: QuotaKind;
  quotaLimit: number;
  advanceDays: number;
  createdAt: Date;
}

function toConfigRow(row: typeof facilityConfig.$inferSelect): FacilityConfigRecord {
  return {
    id: row.id,
    facilityId: row.facilityId,
    version: row.version,
    effectiveAt: row.effectiveAt,
    isPending: row.isPending,
    scheduleJson: row.scheduleJson,
    slotMinutes: row.slotMinutes,
    quotaKind: row.quotaKind,
    quotaLimit: row.quotaLimit,
    advanceDays: row.advanceDays,
    createdAt: row.createdAt,
  };
}

export async function findEffectiveConfig(
  conn: Db,
  facilityId: string,
  at: Date,
): Promise<FacilityConfigRecord | null> {
  const rows = await conn
    .select()
    .from(facilityConfig)
    .where(and(eq(facilityConfig.facilityId, facilityId), lte(facilityConfig.effectiveAt, at)))
    .orderBy(desc(facilityConfig.effectiveAt), desc(facilityConfig.version))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toConfigRow(row);
}

export async function lockEffectiveConfigForUpdate(
  tx: Tx,
  facilityId: string,
  at: Date,
): Promise<FacilityConfigRecord | null> {
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT id FROM "facility_config"
    WHERE "facility_id" = ${facilityId} AND "effective_at" <= ${at}
    ORDER BY "effective_at" DESC, "version" DESC
    LIMIT 1
    FOR UPDATE
  `);
  const id = (rows.rows[0] as { id: string } | undefined)?.id;
  if (id === undefined) return null;
  return findConfigById(tx, id);
}

export async function findConfigById(conn: Db, id: string): Promise<FacilityConfigRecord | null> {
  const rows = await conn.select().from(facilityConfig).where(eq(facilityConfig.id, id)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toConfigRow(row);
}

export async function findPendingConfig(
  conn: Db,
  facilityId: string,
): Promise<FacilityConfigRecord | null> {
  const rows = await conn
    .select()
    .from(facilityConfig)
    .where(and(eq(facilityConfig.facilityId, facilityId), eq(facilityConfig.isPending, true)))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toConfigRow(row);
}

export async function listFacilityConfigs(
  conn: Db,
  facilityId: string,
): Promise<FacilityConfigRecord[]> {
  const rows = await conn
    .select()
    .from(facilityConfig)
    .where(eq(facilityConfig.facilityId, facilityId))
    .orderBy(desc(facilityConfig.effectiveAt), desc(facilityConfig.version));
  return rows.map(toConfigRow);
}

export async function maxConfigVersion(conn: Db, facilityId: string): Promise<number> {
  const rows = await conn
    .select()
    .from(facilityConfig)
    .where(eq(facilityConfig.facilityId, facilityId))
    .orderBy(desc(facilityConfig.version))
    .limit(1);
  return rows[0]?.version ?? 0;
}

export async function insertFacilityConfig(
  tx: Tx,
  input: {
    facilityId: string;
    version: number;
    effectiveAt: Date;
    isPending: boolean;
    scheduleJson: unknown;
    slotMinutes: number;
    quotaKind: QuotaKind;
    quotaLimit: number;
    advanceDays: number;
  },
): Promise<FacilityConfigRecord> {
  const rows = await tx
    .insert(facilityConfig)
    .values({
      facilityId: input.facilityId,
      version: input.version,
      effectiveAt: input.effectiveAt,
      isPending: input.isPending,
      scheduleJson: input.scheduleJson as Record<string, unknown>,
      slotMinutes: input.slotMinutes,
      quotaKind: input.quotaKind,
      quotaLimit: input.quotaLimit,
      advanceDays: input.advanceDays,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Facility config insert returned no row.');
  return toConfigRow(row);
}

export async function clearPendingFlag(
  tx: Tx,
  configId: string,
): Promise<FacilityConfigRecord | null> {
  const rows = await tx
    .update(facilityConfig)
    .set({ isPending: false })
    .where(eq(facilityConfig.id, configId))
    .returning();
  const row = rows[0];
  return row === undefined ? null : toConfigRow(row);
}

export interface ClosureRecord {
  id: string;
  facilityId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  author: string | null;
}

function toClosureRow(row: typeof facilityClosure.$inferSelect): ClosureRecord {
  return {
    id: row.id,
    facilityId: row.facilityId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    reason: row.reason,
    author: row.author,
  };
}

export async function listClosuresForFacility(
  conn: Db,
  facilityId: string,
): Promise<ClosureRecord[]> {
  const rows = await conn
    .select()
    .from(facilityClosure)
    .where(eq(facilityClosure.facilityId, facilityId))
    .orderBy(asc(facilityClosure.startsAt), asc(facilityClosure.id));
  return rows.map(toClosureRow);
}

export async function listClosuresOverlapping(
  conn: Db,
  facilityId: string,
  rangeStart: Date,
  rangeEnd: Date,
): Promise<ClosureRecord[]> {
  const rows = await conn
    .select()
    .from(facilityClosure)
    .where(
      and(
        eq(facilityClosure.facilityId, facilityId),
        sql`"starts_at" < ${rangeEnd} AND "ends_at" > ${rangeStart}`,
      ),
    )
    .orderBy(asc(facilityClosure.startsAt), asc(facilityClosure.id));
  return rows.map(toClosureRow);
}

export async function findClosureById(conn: Db, id: string): Promise<ClosureRecord | null> {
  const rows = await conn.select().from(facilityClosure).where(eq(facilityClosure.id, id)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toClosureRow(row);
}

export async function insertClosure(
  tx: Tx,
  input: {
    facilityId: string;
    startsAt: Date;
    endsAt: Date;
    reason: string;
    author: string | null;
  },
): Promise<ClosureRecord> {
  const rows = await tx
    .insert(facilityClosure)
    .values({
      facilityId: input.facilityId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      reason: input.reason,
      author: input.author,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Closure insert returned no row.');
  return toClosureRow(row);
}

export interface BookingRecord {
  id: string;
  roomId: string;
  facilityId: string;
  createdBy: string | null;
  createdAt: Date;
}

function toBookingRow(row: typeof booking.$inferSelect): BookingRecord {
  return {
    id: row.id,
    roomId: row.roomId,
    facilityId: row.facilityId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

export async function findBookingById(conn: Db, id: string): Promise<BookingRecord | null> {
  const rows = await conn.select().from(booking).where(eq(booking.id, id)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toBookingRow(row);
}

export async function insertBooking(
  tx: Tx,
  input: { roomId: string; facilityId: string; createdBy: string | null },
): Promise<BookingRecord> {
  const rows = await tx
    .insert(booking)
    .values({ roomId: input.roomId, facilityId: input.facilityId, createdBy: input.createdBy })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Booking insert returned no row.');
  return toBookingRow(row);
}

export async function listBookingsForRoom(
  conn: Db,
  input: { roomId: string; facilityId?: string | undefined; limit?: number | undefined },
): Promise<BookingRecord[]> {
  const rows = await conn
    .select()
    .from(booking)
    .where(
      input.facilityId === undefined
        ? eq(booking.roomId, input.roomId)
        : and(eq(booking.roomId, input.roomId), eq(booking.facilityId, input.facilityId)),
    )
    .orderBy(desc(booking.createdAt), desc(booking.id))
    .limit(input.limit ?? 200);
  return rows.map(toBookingRow);
}

export async function listBookingsForFacility(
  conn: Db,
  facilityId: string,
): Promise<BookingRecord[]> {
  const rows = await conn
    .select()
    .from(booking)
    .where(eq(booking.facilityId, facilityId))
    .orderBy(desc(booking.createdAt), desc(booking.id))
    .limit(500);
  return rows.map(toBookingRow);
}

export interface BookingSlotRecord {
  id: string;
  bookingId: string;
  facilityId: string;
  roomId: string;
  startsAt: Date;
  endsAt: Date;
  state: BookingSlotState;
  canceledBy: string | null;
  refundQuota: boolean;
}

export function toBookingSlotRow(row: typeof bookingSlot.$inferSelect): BookingSlotRecord {
  return {
    id: row.id,
    bookingId: row.bookingId,
    facilityId: row.facilityId,
    roomId: row.roomId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    state: row.state,
    canceledBy: row.canceledBy,
    refundQuota: row.refundQuota,
  };
}

export async function findBookingSlotById(conn: Db, id: string): Promise<BookingSlotRecord | null> {
  const rows = await conn.select().from(bookingSlot).where(eq(bookingSlot.id, id)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toBookingSlotRow(row);
}

export async function lockBookingSlotForUpdate(
  tx: Tx,
  id: string,
): Promise<BookingSlotRecord | null> {
  const rows = await tx.execute<{ id: string }>(sql`
    SELECT id FROM "booking_slot" WHERE "id" = ${id} FOR UPDATE
  `);
  const found = (rows.rows[0] as { id: string } | undefined)?.id;
  if (found === undefined) return null;
  return findBookingSlotById(tx, found);
}

export async function listSlotsForBooking(
  conn: Db,
  bookingId: string,
): Promise<BookingSlotRecord[]> {
  const rows = await conn
    .select()
    .from(bookingSlot)
    .where(eq(bookingSlot.bookingId, bookingId))
    .orderBy(asc(bookingSlot.startsAt), asc(bookingSlot.id));
  return rows.map(toBookingSlotRow);
}

export async function listConfirmedSlotsInRange(
  conn: Db,
  input: { facilityId: string; rangeStart: Date; rangeEnd: Date },
): Promise<BookingSlotRecord[]> {
  const rows = await conn
    .select()
    .from(bookingSlot)
    .where(
      and(
        eq(bookingSlot.facilityId, input.facilityId),
        eq(bookingSlot.state, 'CONFIRMED'),
        sql`"starts_at" < ${input.rangeEnd} AND "ends_at" > ${input.rangeStart}`,
      ),
    )
    .orderBy(asc(bookingSlot.startsAt), asc(bookingSlot.id));
  return rows.map(toBookingSlotRow);
}

export async function listQuotaConsumingSlots(
  conn: Db,
  input: { roomId: string; facilityId: string },
): Promise<Pick<BookingSlotRecord, 'id' | 'startsAt' | 'state'>[]> {
  const rows = await conn
    .select({ id: bookingSlot.id, startsAt: bookingSlot.startsAt, state: bookingSlot.state })
    .from(bookingSlot)
    .where(and(eq(bookingSlot.roomId, input.roomId), eq(bookingSlot.facilityId, input.facilityId)));
  return rows;
}

export async function listConfirmedFutureSlots(
  conn: Db,
  input: { facilityId: string; from: Date },
): Promise<BookingSlotRecord[]> {
  const rows = await conn
    .select()
    .from(bookingSlot)
    .where(
      and(
        eq(bookingSlot.facilityId, input.facilityId),
        eq(bookingSlot.state, 'CONFIRMED'),
        gte(bookingSlot.startsAt, input.from),
      ),
    )
    .orderBy(asc(bookingSlot.startsAt), asc(bookingSlot.id))
    .limit(2000);
  return rows.map(toBookingSlotRow);
}

export async function insertBookingSlots(
  tx: Tx,
  input: Array<{
    bookingId: string;
    facilityId: string;
    roomId: string;
    startsAt: Date;
    endsAt: Date;
  }>,
): Promise<BookingSlotRecord[]> {
  if (input.length === 0) return [];
  const rows = await tx
    .insert(bookingSlot)
    .values(
      input.map((slot) => ({
        bookingId: slot.bookingId,
        facilityId: slot.facilityId,
        roomId: slot.roomId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        state: 'CONFIRMED' as const,
        refundQuota: false,
      })),
    )
    .returning();
  return rows.map(toBookingSlotRow);
}

export async function updateBookingSlotState(
  tx: Tx,
  input: {
    slotId: string;
    expectedState: BookingSlotState;
    nextState: BookingSlotState;
    canceledBy: string | null;
    refundQuota: boolean;
  },
): Promise<BookingSlotRecord | null> {
  const rows = await tx
    .update(bookingSlot)
    .set({ state: input.nextState, canceledBy: input.canceledBy, refundQuota: input.refundQuota })
    .where(and(eq(bookingSlot.id, input.slotId), eq(bookingSlot.state, input.expectedState)))
    .returning();
  const row = rows[0];
  return row === undefined ? null : toBookingSlotRow(row);
}

export interface QuotaAdjustmentRecord {
  id: string;
  bookingSlotId: string;
  roomId: string;
  facilityId: string;
  periodKey: string;
  signedSlots: number;
  reason: string;
  actorId: string | null;
  createdAt: Date;
}

function toAdjustmentRow(row: typeof quotaAdjustment.$inferSelect): QuotaAdjustmentRecord {
  return {
    id: row.id,
    bookingSlotId: row.bookingSlotId,
    roomId: row.roomId,
    facilityId: row.facilityId,
    periodKey: row.periodKey,
    signedSlots: row.signedSlots,
    reason: row.reason,
    actorId: row.actorId,
    createdAt: row.createdAt,
  };
}

export async function listAdjustmentsForRoomFacility(
  conn: Db,
  input: { roomId: string; facilityId: string; periodKey?: string | undefined },
): Promise<QuotaAdjustmentRecord[]> {
  const rows = await conn
    .select()
    .from(quotaAdjustment)
    .where(
      input.periodKey === undefined
        ? and(
            eq(quotaAdjustment.roomId, input.roomId),
            eq(quotaAdjustment.facilityId, input.facilityId),
          )
        : and(
            eq(quotaAdjustment.roomId, input.roomId),
            eq(quotaAdjustment.facilityId, input.facilityId),
            eq(quotaAdjustment.periodKey, input.periodKey),
          ),
    );
  return rows.map(toAdjustmentRow);
}

export async function findAdjustmentForSlot(
  conn: Db,
  bookingSlotId: string,
): Promise<QuotaAdjustmentRecord | null> {
  const rows = await conn
    .select()
    .from(quotaAdjustment)
    .where(eq(quotaAdjustment.bookingSlotId, bookingSlotId))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toAdjustmentRow(row);
}

export async function insertRefundCredit(
  tx: Tx,
  input: {
    bookingSlotId: string;
    roomId: string;
    facilityId: string;
    periodKey: string;
    reason: string;
    actorId: string | null;
  },
): Promise<QuotaAdjustmentRecord> {
  const rows = await tx
    .insert(quotaAdjustment)
    .values({
      bookingSlotId: input.bookingSlotId,
      roomId: input.roomId,
      facilityId: input.facilityId,
      periodKey: input.periodKey,
      adjustmentType: 'REFUND_CREDIT',
      signedSlots: 1,
      reason: input.reason,
      actorId: input.actorId,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Quota adjustment insert returned no row.');
  return toAdjustmentRow(row);
}

export async function ensureQuotaPeriodLocks(
  tx: Tx,
  input: { roomId: string; facilityId: string; periodKeys: string[] },
): Promise<void> {
  const ordered = [...new Set(input.periodKeys)].sort();
  for (const periodKey of ordered) {
    await tx
      .insert(quotaPeriodLock)
      .values({ roomId: input.roomId, facilityId: input.facilityId, periodKey })
      .onConflictDoNothing();
  }
  if (ordered.length === 0) return;
  for (const periodKey of ordered) {
    await tx.execute(sql`
      SELECT "period_key" FROM "quota_period_lock"
      WHERE "room_id" = ${input.roomId}
        AND "facility_id" = ${input.facilityId}
        AND "period_key" = ${periodKey}
      FOR UPDATE
    `);
  }
}

export async function queryFacilityPage(
  conn: Db,
  input: {
    status?: 'ACTIVE' | 'INACTIVE' | undefined;
    query?: string | undefined;
    page: number;
    pageSize: number;
  },
) {
  const search = input.query?.trim();
  const where = and(
    isNull(facility.deletedAt),
    input.status ? eq(facility.status, input.status) : undefined,
    search ? ilike(facility.name, `%${search.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
  );
  const [rows, counted] = await Promise.all([
    conn
      .select()
      .from(facility)
      .where(where)
      .orderBy(asc(facility.name), asc(facility.id))
      .limit(input.pageSize)
      .offset((input.page - 1) * input.pageSize),
    conn
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(facility)
      .where(where),
  ]);
  return { rows: rows.map(toFacilityRow), total: counted[0]?.total ?? 0 };
}

export async function queryFacilityBookingPage(
  conn: Db,
  facilityId: string,
  page: number,
  pageSize: number,
) {
  const [rows, counted] = await Promise.all([
    conn
      .select()
      .from(booking)
      .where(eq(booking.facilityId, facilityId))
      .orderBy(desc(booking.createdAt), desc(booking.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    conn
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(booking)
      .where(eq(booking.facilityId, facilityId)),
  ]);
  const slots =
    rows.length === 0
      ? []
      : await conn
          .select()
          .from(bookingSlot)
          .where(
            inArray(
              bookingSlot.bookingId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(asc(bookingSlot.startsAt), asc(bookingSlot.id));
  return {
    rows: rows.map((row) => ({
      booking: toBookingRow(row),
      slots: slots.filter((slot) => slot.bookingId === row.id).map(toBookingSlotRow),
    })),
    total: counted[0]?.total ?? 0,
  };
}

export async function lockFacilityForUpdate(tx: Tx, id: string): Promise<FacilityRecord | null> {
  const [row] = await tx
    .select()
    .from(facility)
    .where(and(eq(facility.id, id), isNull(facility.deletedAt)))
    .for('update');
  return row ? toFacilityRow(row) : null;
}

export async function hasUpcomingConfirmedSlots(
  conn: Db,
  facilityId: string,
  at: Date,
): Promise<boolean> {
  const [slot] = await conn
    .select({ id: bookingSlot.id })
    .from(bookingSlot)
    .where(
      and(
        eq(bookingSlot.facilityId, facilityId),
        eq(bookingSlot.state, 'CONFIRMED'),
        gt(bookingSlot.endsAt, at),
      ),
    )
    .limit(1);
  return slot !== undefined;
}

export async function markFacilityDeleted(tx: Tx, id: string, at: Date): Promise<void> {
  await tx
    .update(facility)
    .set({ deletedAt: at, status: 'INACTIVE' })
    .where(and(eq(facility.id, id), isNull(facility.deletedAt)));
}

export async function listBookingFacilityLabels(conn: Db, facilityIds: string[]) {
  if (facilityIds.length === 0) return [];
  return conn
    .select({ id: facility.id, name: facility.name, deletedAt: facility.deletedAt })
    .from(facility)
    .where(inArray(facility.id, facilityIds));
}
