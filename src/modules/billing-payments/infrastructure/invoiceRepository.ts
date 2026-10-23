import 'server-only';
import { and, desc, eq, inArray, not, or, sql } from 'drizzle-orm';
import type { InvoiceListView } from '../domain/invoicePolicy';
import type { Db, Tx } from '@/shared/db/transaction';
import {
  membershipOverlapsServiceWindow,
  roomResidencyScope,
  tenantOverlapScope,
} from '@/modules/property-membership/application/index';
import {
  commonFeeInvoiceResponsibleOwner,
  invoice,
  paymentSubmission,
  privateRentInvoiceReviewer,
  type InvoiceKind,
} from './schema';

export interface InvoiceRecord {
  id: string;
  roomId: string;
  tenancyId: string | null;
  kind: InvoiceKind;
  sourceRuleId: string | null;
  sourceTurnoverReviewId: string | null;
  oneTimeChargeEventId: string | null;
  periodStart: string;
  periodEnd: string;
  serviceStart: Date;
  serviceEndExclusive: Date;
  total: bigint;
  dueDate: string;
  snapshotBoundaryAt: Date;
  snapshotTimezone: string;
  issuerId: string | null;
  issuedAt: Date | null;
  version: number;
  pastDueDateConfirmed: boolean | null;
  pastDueDateConfirmedAt: Date | null;
  createdAt: Date;
}

function toRecord(row: typeof invoice.$inferSelect): InvoiceRecord {
  return {
    id: row.id,
    roomId: row.roomId,
    tenancyId: row.tenancyId,
    kind: row.kind,
    sourceRuleId: row.sourceRuleId,
    sourceTurnoverReviewId: row.sourceTurnoverReviewId,
    oneTimeChargeEventId: row.oneTimeChargeEventId,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    serviceStart: row.serviceStart,
    serviceEndExclusive: row.serviceEndExclusive,
    total: row.total,
    dueDate: row.dueDate,
    snapshotBoundaryAt: row.snapshotBoundaryAt,
    snapshotTimezone: row.snapshotTimezone,
    issuerId: row.issuerId,
    issuedAt: row.issuedAt,
    version: row.version,
    pastDueDateConfirmed: row.pastDueDateConfirmed,
    pastDueDateConfirmedAt: row.pastDueDateConfirmedAt,
    createdAt: row.createdAt,
  };
}

export async function findInvoiceById(conn: Db, id: string): Promise<InvoiceRecord | null> {
  const rows = await conn.select().from(invoice).where(eq(invoice.id, id)).limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function lockInvoiceForUpdate(tx: Tx, id: string): Promise<InvoiceRecord | null> {
  const rows = await tx.select().from(invoice).where(eq(invoice.id, id)).for('update').limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function updateInvoiceTotal(
  tx: Tx,
  input: { id: string; fromVersion: number; newTotal: bigint },
): Promise<InvoiceRecord | null> {
  const rows = await tx
    .update(invoice)
    .set({ total: input.newTotal, version: input.fromVersion + 1, updatedAt: new Date() })
    .where(and(eq(invoice.id, input.id), eq(invoice.version, input.fromVersion)))
    .returning();
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export interface InvoiceBalanceRow {
  approvedTotal: bigint;
  pendingCount: number;
}

export async function readInvoiceBalance(tx: Tx, invoiceId: string): Promise<InvoiceBalanceRow> {
  const rows = await tx
    .select({
      approvedTotal: sql<string | null>`sum("approved_amount") filter (where "state" = 'APPROVED')`,
      pendingCount: sql<number>`count(*) filter (where "state" = 'PENDING')`,
    })
    .from(paymentSubmission)
    .where(eq(paymentSubmission.invoiceId, invoiceId));
  return {
    approvedTotal: BigInt(rows[0]?.approvedTotal ?? '0'),
    pendingCount: Number(rows[0]?.pendingCount ?? 0),
  };
}

function tenantOverlapExists(userId: string, at: Date) {
  void at;
  return tenantOverlapScope({
    userId,
    tenancyRef: sql`"invoice"."tenancy_id"`,
    serviceStartRef: sql`"invoice"."service_start"`,
    serviceEndExclusiveRef: sql`"invoice"."service_end_exclusive"`,
  });
}

function membershipRoomEntitled(userId: string, at: Date) {
  return roomResidencyScope({ userId, roomRef: sql`"invoice"."room_id"`, at });
}

function rentReviewerCondition(userId: string) {
  return sql<boolean>`exists (select 1 from "private_rent_invoice_reviewer" as "s1" where "s1"."invoice_id" = "invoice"."id" and "s1"."user_id" = ${userId})`;
}

function memberScopeCondition(userId: string, at: Date): ReturnType<typeof or> {
  return or(
    rentReviewerCondition(userId),
    sql<boolean>`exists (select 1 from "common_fee_invoice_responsible_owner" as "s3" where "s3"."invoice_id" = "invoice"."id" and "s3"."user_id" = ${userId})`,
    tenantOverlapExists(userId, at),
    and(eq(invoice.kind, 'COMMON_FEE'), membershipRoomEntitled(userId, at)),
  );
}

export async function listInvoicesForMember(
  conn: Db,
  input: {
    userId: string;
    at: Date;
    roomId?: string | undefined;
    kind?: InvoiceKind | undefined;
    oneTimeChargeEventId?: string | undefined;
    view?: InvoiceListView | undefined;
    limit: number;
    offset: number;
  },
): Promise<{ rows: InvoiceRecord[]; total: number }> {
  const conditions = [memberScopeCondition(input.userId, input.at)];
  if (input.view !== undefined) {
    const receivable = sql<boolean>`(${invoice.kind} = 'PRIVATE_RENT' and ${rentReviewerCondition(input.userId)})`;
    conditions.push(input.view === 'receivable' ? receivable : not(receivable));
  }
  if (input.roomId !== undefined) conditions.push(eq(invoice.roomId, input.roomId));
  if (input.kind !== undefined) conditions.push(eq(invoice.kind, input.kind));
  if (input.oneTimeChargeEventId !== undefined)
    conditions.push(eq(invoice.oneTimeChargeEventId, input.oneTimeChargeEventId));
  const where = and(...conditions);
  const rows = await conn
    .select({ row: invoice })
    .from(invoice)
    .where(where)
    .orderBy(desc(invoice.createdAt), desc(invoice.id))
    .limit(input.limit)
    .offset(input.offset);
  const counted = await conn
    .select({ count: sql<number>`count(*)` })
    .from(invoice)
    .where(where);
  return { rows: rows.map((entry) => toRecord(entry.row)), total: Number(counted[0]?.count ?? 0) };
}

export async function isInvoiceMemberVisible(
  conn: Db,
  input: { invoiceId: string; userId: string; at: Date },
): Promise<boolean> {
  const rows = await conn
    .select({ id: invoice.id })
    .from(invoice)
    .where(and(eq(invoice.id, input.invoiceId), memberScopeCondition(input.userId, input.at)))
    .limit(1);
  return rows.length > 0;
}

export async function tenantOverlapsInvoice(
  conn: Db,
  input: { userId: string; tenancyId: string; serviceStart: Date; serviceEndExclusive: Date },
): Promise<boolean> {
  return membershipOverlapsServiceWindow(conn, input);
}

export async function isRentReviewer(
  conn: Db,
  input: { invoiceId: string; userId: string },
): Promise<boolean> {
  const rows = await conn
    .select({ userId: privateRentInvoiceReviewer.userId })
    .from(privateRentInvoiceReviewer)
    .where(
      and(
        eq(privateRentInvoiceReviewer.invoiceId, input.invoiceId),
        eq(privateRentInvoiceReviewer.userId, input.userId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function isFeeResponsibleOwner(
  conn: Db,
  input: { invoiceId: string; userId: string },
): Promise<boolean> {
  const rows = await conn
    .select({ userId: commonFeeInvoiceResponsibleOwner.userId })
    .from(commonFeeInvoiceResponsibleOwner)
    .where(
      and(
        eq(commonFeeInvoiceResponsibleOwner.invoiceId, input.invoiceId),
        eq(commonFeeInvoiceResponsibleOwner.userId, input.userId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function readPayeeSnapshot(conn: Db, invoiceId: string): Promise<unknown> {
  const rows = await conn
    .select({ snapshot: invoice.paymentInstructionSnapshot })
    .from(invoice)
    .where(eq(invoice.id, invoiceId))
    .limit(1);
  return rows[0]?.snapshot ?? null;
}

export async function listInvoicesScoped(
  conn: Db,
  input: {
    allowedKinds: InvoiceKind[];
    roomId?: string | undefined;
    kind?: InvoiceKind | undefined;
    oneTimeChargeEventId?: string | undefined;
    limit: number;
    offset: number;
  },
): Promise<{ rows: InvoiceRecord[]; total: number }> {
  const conditions = [inArray(invoice.kind, input.allowedKinds)];
  if (input.roomId !== undefined) conditions.push(eq(invoice.roomId, input.roomId));
  if (input.kind !== undefined) conditions.push(eq(invoice.kind, input.kind));
  if (input.oneTimeChargeEventId !== undefined)
    conditions.push(eq(invoice.oneTimeChargeEventId, input.oneTimeChargeEventId));
  const where = and(...conditions);
  const rows = await conn
    .select()
    .from(invoice)
    .where(where)
    .orderBy(desc(invoice.createdAt), desc(invoice.id))
    .limit(input.limit)
    .offset(input.offset);
  const counted = await conn
    .select({ count: sql<number>`count(*)` })
    .from(invoice)
    .where(where);
  return { rows: rows.map(toRecord), total: Number(counted[0]?.count ?? 0) };
}

export async function findInvoiceByNaturalKey(
  conn: Db,
  input: {
    roomId: string;
    kind: InvoiceKind;
    periodStart: string;
    tenancyId?: string | null | undefined;
    sourceRuleId?: string | null | undefined;
    oneTimeChargeEventId?: string | null | undefined;
  },
): Promise<InvoiceRecord | null> {
  const rows = await conn
    .select()
    .from(invoice)
    .where(
      and(
        eq(invoice.roomId, input.roomId),
        eq(invoice.kind, input.kind),
        eq(invoice.periodStart, input.periodStart),
      ),
    )
    .limit(20);
  const found = rows.find(
    (row) =>
      (row.tenancyId ?? null) === (input.tenancyId ?? null) &&
      (row.sourceRuleId ?? null) === (input.sourceRuleId ?? null) &&
      (row.oneTimeChargeEventId ?? null) === (input.oneTimeChargeEventId ?? null),
  );
  return found === undefined ? null : toRecord(found);
}

export async function hasVisibleInvoiceForQr(
  conn: Db,
  input: { imageId: string; userId: string; isAdmin: boolean; at: Date },
): Promise<boolean> {
  const [row] = await conn
    .select({ id: invoice.id })
    .from(invoice)
    .where(
      and(
        sql`${invoice.paymentInstructionSnapshot}->>'qrImageId' = ${input.imageId}`,
        sql`${invoice.total} > coalesce((select sum("approved_amount") from "payment_submission" where "invoice_id" = ${invoice.id} and "state" = 'APPROVED'), 0)`,
        input.isAdmin
          ? inArray(invoice.kind, ['COMMON_FEE', 'PROJECT_MANAGED_RENT'])
          : memberScopeCondition(input.userId, input.at),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function fillMissingInvoiceInstructions(
  conn: Db,
  input: {
    roomId?: string;
    payeeType: 'PROJECT' | 'OWNER';
    actorId: string;
    snapshot: Record<string, unknown>;
    at: Date;
  },
): Promise<string[]> {
  const rows = await conn
    .update(invoice)
    .set({
      paymentInstructionSnapshot: input.snapshot,
      updatedAt: input.at,
      version: sql`${invoice.version} + 1`,
    })
    .where(
      and(
        input.roomId ? eq(invoice.roomId, input.roomId) : undefined,
        input.payeeType === 'OWNER'
          ? and(
              eq(invoice.kind, 'PRIVATE_RENT'),
              sql`exists (select 1 from "private_rent_invoice_reviewer" where "invoice_id" = ${invoice.id} and "user_id" = ${input.actorId})`,
            )
          : inArray(invoice.kind, ['COMMON_FEE', 'PROJECT_MANAGED_RENT']),
        or(
          sql`${invoice.paymentInstructionSnapshot} is null`,
          sql`${invoice.paymentInstructionSnapshot}->>'accountNumber' = 'SYSTEM-AUTO'`,
        ),
        sql`${invoice.total} > 0`,
        sql`not exists (select 1 from "payment_submission" where "invoice_id" = ${invoice.id})`,
      ),
    )
    .returning({ id: invoice.id });
  return rows.map((row) => row.id);
}

export async function isInvoiceQrReferenced(conn: Db, imageId: string): Promise<boolean> {
  const [row] = await conn
    .select({ id: invoice.id })
    .from(invoice)
    .where(sql`${invoice.paymentInstructionSnapshot}->>'qrImageId' = ${imageId}`)
    .limit(1);
  return row !== undefined;
}
