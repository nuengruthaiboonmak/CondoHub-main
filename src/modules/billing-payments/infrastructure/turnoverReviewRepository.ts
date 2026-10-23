import 'server-only';
import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/shared/db/transaction';
import {
  invoice,
  privateRentInvoiceReviewer,
  turnoverBillingReview,
  turnoverReviewResponsibleOwner,
  type InvoiceKind,
  type ReviewerSnapshotSource,
  type TurnoverDecisionType,
  type TurnoverReviewState,
} from './schema';

export interface TurnoverReviewRecord {
  id: string;
  roomId: string;
  calendarMonth: string;
  cycleStart: Date;
  cycleTimezone: string;
  managementModeAtCreation: string;
  state: TurnoverReviewState;
  candidateTenancyIds: string[];
  candidateContext: unknown;
  version: number;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionType: TurnoverDecisionType | null;
  reason: string | null;
  createdAt: Date;
}

function toReviewRecord(row: typeof turnoverBillingReview.$inferSelect): TurnoverReviewRecord {
  return {
    id: row.id,
    roomId: row.roomId,
    calendarMonth: row.calendarMonth,
    cycleStart: row.cycleStart,
    cycleTimezone: row.cycleTimezone,
    managementModeAtCreation: row.managementModeAtCreation,
    state: row.state,
    candidateTenancyIds: [...row.candidateTenancyIds],
    candidateContext: row.candidateContext,
    version: row.version,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionType: row.decisionType,
    reason: row.reason,
    createdAt: row.createdAt,
  };
}

export async function findTurnoverReviewById(
  conn: Db,
  id: string,
): Promise<TurnoverReviewRecord | null> {
  const rows = await conn
    .select()
    .from(turnoverBillingReview)
    .where(eq(turnoverBillingReview.id, id))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toReviewRecord(row);
}

export async function lockTurnoverReviewForUpdate(
  tx: Tx,
  id: string,
): Promise<TurnoverReviewRecord | null> {
  const rows = await tx
    .select()
    .from(turnoverBillingReview)
    .where(eq(turnoverBillingReview.id, id))
    .for('update')
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toReviewRecord(row);
}

export interface TurnoverResponsibleOwnerRecord {
  reviewId: string;
  userId: string;
  ownershipIntervalRef: string | null;
  assignedAt: Date;
}

export async function listReviewResponsibleOwners(
  conn: Db,
  reviewId: string,
): Promise<TurnoverResponsibleOwnerRecord[]> {
  const rows = await conn
    .select()
    .from(turnoverReviewResponsibleOwner)
    .where(eq(turnoverReviewResponsibleOwner.reviewId, reviewId));
  return rows.map((row) => ({
    reviewId: row.reviewId,
    userId: row.userId,
    ownershipIntervalRef: row.ownershipIntervalRef,
    assignedAt: row.assignedAt,
  }));
}

export interface TurnoverReviewPage {
  rows: TurnoverReviewRecord[];
  total: number;
}

function visibleReviewScope(userId: string, includeProjectManaged: boolean) {
  const privateScope = and(
    ne(turnoverBillingReview.managementModeAtCreation, 'PROJECT_MANAGED'),
    sql<boolean>`exists (select 1 from ${turnoverReviewResponsibleOwner} where ${turnoverReviewResponsibleOwner.reviewId} = ${turnoverBillingReview.id} and ${turnoverReviewResponsibleOwner.userId} = ${userId})`,
  );
  return includeProjectManaged
    ? or(eq(turnoverBillingReview.managementModeAtCreation, 'PROJECT_MANAGED'), privateScope)
    : privateScope;
}

export async function listVisibleTurnoverReviews(
  conn: Db,
  input: {
    userId: string;
    includeProjectManaged: boolean;
    state?: TurnoverReviewState | undefined;
    limit: number;
    offset: number;
  },
): Promise<TurnoverReviewPage> {
  const where = and(
    visibleReviewScope(input.userId, input.includeProjectManaged),
    input.state === undefined ? undefined : eq(turnoverBillingReview.state, input.state),
  );
  const rows = await conn
    .select()
    .from(turnoverBillingReview)
    .where(where)
    .orderBy(desc(turnoverBillingReview.createdAt), desc(turnoverBillingReview.id))
    .limit(input.limit)
    .offset(input.offset);
  const counted = await conn
    .select({ count: sql<number>`count(*)` })
    .from(turnoverBillingReview)
    .where(where);
  return {
    rows: rows.map(toReviewRecord),
    total: Number(counted[0]?.count ?? 0),
  };
}

export async function countVisibleUnresolvedReviews(
  conn: Db,
  input: { userId: string; includeProjectManaged: boolean },
): Promise<number> {
  const counted = await conn
    .select({ count: sql<number>`count(*)` })
    .from(turnoverBillingReview)
    .where(
      and(
        visibleReviewScope(input.userId, input.includeProjectManaged),
        eq(turnoverBillingReview.state, 'UNRESOLVED'),
      ),
    );
  return Number(counted[0]?.count ?? 0);
}

export async function updateTurnoverReviewDecision(
  tx: Tx,
  input: {
    id: string;
    fromVersion: number;
    state: 'RESOLVED' | 'NO_CHARGE';
    decisionType: TurnoverDecisionType;
    reason: string | null;
    decidedBy: string;
    decidedAt: Date;
  },
): Promise<TurnoverReviewRecord | null> {
  const rows = await tx
    .update(turnoverBillingReview)
    .set({
      state: input.state,
      decisionType: input.decisionType,
      reason: input.reason,
      decidedBy: input.decidedBy,
      decidedAt: input.decidedAt,
      version: input.fromVersion + 1,
    })
    .where(
      and(
        eq(turnoverBillingReview.id, input.id),
        eq(turnoverBillingReview.version, input.fromVersion),
        eq(turnoverBillingReview.state, 'UNRESOLVED'),
      ),
    )
    .returning();
  const row = rows[0];
  return row === undefined ? null : toReviewRecord(row);
}

export interface TurnoverInvoiceInsert {
  roomId: string;
  tenancyId: string;
  kind: InvoiceKind;
  sourceRuleId: string;
  sourceTurnoverReviewId: string;
  reviewerSnapshotSource: ReviewerSnapshotSource;
  periodStart: string;
  periodEnd: string;
  serviceStart: Date;
  serviceEndExclusive: Date;
  total: bigint;
  dueDate: string;
  snapshotBoundaryAt: Date;
  snapshotTimezone: string;
  issuerId: string;
  issuedAt: Date;
  paymentInstructionSnapshot: Record<string, unknown>;
  pastDueDateConfirmed: boolean;
  pastDueDateConfirmedAt: Date;
}

export interface TurnoverInvoiceRecord {
  id: string;
  roomId: string;
  tenancyId: string | null;
  kind: InvoiceKind;
  sourceRuleId: string | null;
  sourceTurnoverReviewId: string | null;
  reviewerSnapshotSource: ReviewerSnapshotSource | null;
  periodStart: string;
  dueDate: string;
  total: bigint;
  issuerId: string | null;
  issuedAt: Date | null;
  pastDueDateConfirmed: boolean | null;
  pastDueDateConfirmedAt: Date | null;
}

function toInvoiceRecord(row: typeof invoice.$inferSelect): TurnoverInvoiceRecord {
  return {
    id: row.id,
    roomId: row.roomId,
    tenancyId: row.tenancyId,
    kind: row.kind,
    sourceRuleId: row.sourceRuleId,
    sourceTurnoverReviewId: row.sourceTurnoverReviewId,
    reviewerSnapshotSource: row.reviewerSnapshotSource,
    periodStart: row.periodStart,
    dueDate: row.dueDate,
    total: row.total,
    issuerId: row.issuerId,
    issuedAt: row.issuedAt,
    pastDueDateConfirmed: row.pastDueDateConfirmed,
    pastDueDateConfirmedAt: row.pastDueDateConfirmedAt,
  };
}

export async function insertTurnoverInvoice(
  tx: Tx,
  input: TurnoverInvoiceInsert,
): Promise<TurnoverInvoiceRecord> {
  const rows = await tx
    .insert(invoice)
    .values({
      roomId: input.roomId,
      tenancyId: input.tenancyId,
      kind: input.kind,
      sourceRuleId: input.sourceRuleId,
      sourceTurnoverReviewId: input.sourceTurnoverReviewId,
      reviewerSnapshotSource: input.reviewerSnapshotSource,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      serviceStart: input.serviceStart,
      serviceEndExclusive: input.serviceEndExclusive,
      total: input.total,
      dueDate: input.dueDate,
      snapshotBoundaryAt: input.snapshotBoundaryAt,
      snapshotTimezone: input.snapshotTimezone,
      issuerId: input.issuerId,
      issuedAt: input.issuedAt,
      paymentInstructionSnapshot: input.paymentInstructionSnapshot,
      version: 1,
      pastDueDateConfirmed: input.pastDueDateConfirmed,
      pastDueDateConfirmedAt: input.pastDueDateConfirmedAt,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Turnover invoice insert returned no row.');
  return toInvoiceRecord(row);
}

export async function insertTurnoverReviewerCopy(
  tx: Tx,
  input: {
    invoiceId: string;
    reviewers: { userId: string; ownershipIntervalRef: string | null }[];
    at: Date;
  },
): Promise<void> {
  if (input.reviewers.length === 0) {
    throw new Error('Turnover reviewer copy requires at least one reviewer.');
  }
  await tx.insert(privateRentInvoiceReviewer).values(
    input.reviewers.map((reviewer) => ({
      invoiceId: input.invoiceId,
      userId: reviewer.userId,
      ownershipIntervalRef: reviewer.ownershipIntervalRef,
      grantedAt: input.at,
    })),
  );
}

export async function countInvoicesForReview(tx: Tx, reviewId: string): Promise<number> {
  const rows = await tx
    .select({ count: sql<number>`count(*)` })
    .from(invoice)
    .where(eq(invoice.sourceTurnoverReviewId, reviewId));
  return Number(rows[0]?.count ?? 0);
}

export async function listInvoicesForReview(
  conn: Db,
  reviewId: string,
): Promise<TurnoverInvoiceRecord[]> {
  const rows = await conn
    .select()
    .from(invoice)
    .where(eq(invoice.sourceTurnoverReviewId, reviewId))
    .orderBy(desc(invoice.createdAt), desc(invoice.id));
  return rows.map(toInvoiceRecord);
}

export async function findReviewByRoomMonth(
  conn: Db,
  input: { roomId: string; calendarMonth: string },
): Promise<TurnoverReviewRecord | null> {
  const rows = await conn
    .select()
    .from(turnoverBillingReview)
    .where(
      and(
        eq(turnoverBillingReview.roomId, input.roomId),
        eq(turnoverBillingReview.calendarMonth, input.calendarMonth),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toReviewRecord(row);
}

export async function listReviewIdsByRoomMonth(
  conn: Db,
  input: { roomId: string; calendarMonth: string; states: TurnoverReviewState[] },
): Promise<string[]> {
  if (input.states.length === 0) return [];
  const rows = await conn
    .select({ id: turnoverBillingReview.id })
    .from(turnoverBillingReview)
    .where(
      and(
        eq(turnoverBillingReview.roomId, input.roomId),
        eq(turnoverBillingReview.calendarMonth, input.calendarMonth),
        inArray(turnoverBillingReview.state, input.states),
      ),
    );
  return rows.map((row) => row.id);
}
