import 'server-only';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/shared/db/transaction';
import {
  invoiceRevision,
  paymentSubmission,
  type PaymentSubmissionState,
} from './schema';

export interface PaymentSubmissionRecord {
  id: string;
  invoiceId: string;
  submittedBy: string;
  imageId: string;
  state: PaymentSubmissionState;
  approvedAmount: bigint | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  rejectReason: string | null;
}

function toSubmissionRecord(row: typeof paymentSubmission.$inferSelect): PaymentSubmissionRecord {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    submittedBy: row.submittedBy,
    imageId: row.imageId,
    state: row.state,
    approvedAmount: row.approvedAmount,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    rejectReason: row.rejectReason,
  };
}

export async function findSubmissionById(
  conn: Db,
  id: string,
): Promise<PaymentSubmissionRecord | null> {
  const rows = await conn
    .select()
    .from(paymentSubmission)
    .where(eq(paymentSubmission.id, id))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toSubmissionRecord(row);
}

export async function lockSubmissionForUpdate(
  tx: Tx,
  id: string,
): Promise<PaymentSubmissionRecord | null> {
  const rows = await tx
    .select()
    .from(paymentSubmission)
    .where(eq(paymentSubmission.id, id))
    .for('update')
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toSubmissionRecord(row);
}

export async function insertPendingSubmission(
  tx: Tx,
  input: { invoiceId: string; submittedBy: string; imageId: string },
): Promise<PaymentSubmissionRecord> {
  const rows = await tx
    .insert(paymentSubmission)
    .values({
      invoiceId: input.invoiceId,
      submittedBy: input.submittedBy,
      imageId: input.imageId,
      state: 'PENDING',
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Payment submission insert returned no row.');
  return toSubmissionRecord(row);
}

export async function approvePendingSubmission(
  tx: Tx,
  input: { id: string; approvedAmount: bigint; reviewedBy: string; reviewedAt: Date },
): Promise<PaymentSubmissionRecord | null> {
  const rows = await tx
    .update(paymentSubmission)
    .set({
      state: 'APPROVED',
      approvedAmount: input.approvedAmount,
      reviewedBy: input.reviewedBy,
      reviewedAt: input.reviewedAt,
      rejectReason: null,
    })
    .where(and(eq(paymentSubmission.id, input.id), eq(paymentSubmission.state, 'PENDING')))
    .returning();
  const row = rows[0];
  return row === undefined ? null : toSubmissionRecord(row);
}

export async function rejectPendingSubmission(
  tx: Tx,
  input: { id: string; reviewedBy: string; reviewedAt: Date; rejectReason: string },
): Promise<PaymentSubmissionRecord | null> {
  const rows = await tx
    .update(paymentSubmission)
    .set({
      state: 'REJECTED',
      approvedAmount: null,
      reviewedBy: input.reviewedBy,
      reviewedAt: input.reviewedAt,
      rejectReason: input.rejectReason,
    })
    .where(and(eq(paymentSubmission.id, input.id), eq(paymentSubmission.state, 'PENDING')))
    .returning();
  const row = rows[0];
  return row === undefined ? null : toSubmissionRecord(row);
}

export async function sumApprovedForInvoice(tx: Tx, invoiceId: string): Promise<bigint> {
  const rows = await tx
    .select({ total: sql<string | null>`sum("approved_amount")` })
    .from(paymentSubmission)
    .where(
      and(eq(paymentSubmission.invoiceId, invoiceId), eq(paymentSubmission.state, 'APPROVED')),
    );
  return BigInt(rows[0]?.total ?? '0');
}

export async function countPendingForInvoice(tx: Tx, invoiceId: string): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)` })
    .from(paymentSubmission)
    .where(
      and(eq(paymentSubmission.invoiceId, invoiceId), eq(paymentSubmission.state, 'PENDING')),
    );
  return Number(rows[0]?.count ?? 0);
}

export async function listSubmissionsForInvoice(
  conn: Db,
  invoiceId: string,
): Promise<PaymentSubmissionRecord[]> {
  const rows = await conn
    .select()
    .from(paymentSubmission)
    .where(eq(paymentSubmission.invoiceId, invoiceId))
    .orderBy(desc(paymentSubmission.id));
  return rows.map(toSubmissionRecord);
}

export interface InvoiceRevisionRecord {
  id: string;
  invoiceId: string;
  oldTotal: bigint;
  newTotal: bigint;
  reason: string | null;
  actorId: string | null;
  changedAt: Date;
}

function toRevisionRecord(row: typeof invoiceRevision.$inferSelect): InvoiceRevisionRecord {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    oldTotal: row.oldTotal,
    newTotal: row.newTotal,
    reason: row.reason,
    actorId: row.actorId,
    changedAt: row.changedAt,
  };
}

export async function insertInvoiceRevision(
  tx: Tx,
  input: {
    invoiceId: string;
    oldTotal: bigint;
    newTotal: bigint;
    reason: string | null;
    actorId: string;
    changedAt: Date;
  },
): Promise<InvoiceRevisionRecord> {
  const rows = await tx
    .insert(invoiceRevision)
    .values({
      invoiceId: input.invoiceId,
      oldTotal: input.oldTotal,
      newTotal: input.newTotal,
      reason: input.reason,
      actorId: input.actorId,
      changedAt: input.changedAt,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Invoice revision insert returned no row.');
  return toRevisionRecord(row);
}

export async function listRevisionsForInvoice(
  conn: Db,
  invoiceId: string,
): Promise<InvoiceRevisionRecord[]> {
  const rows = await conn
    .select()
    .from(invoiceRevision)
    .where(eq(invoiceRevision.invoiceId, invoiceId))
    .orderBy(desc(invoiceRevision.changedAt), desc(invoiceRevision.id));
  return rows.map(toRevisionRecord);
}
