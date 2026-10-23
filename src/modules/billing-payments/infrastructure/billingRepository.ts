import 'server-only';
import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { invoiceSourceMatches } from '../domain/invoiceNaturalKey';
import type { Db, Tx } from '@/shared/db/transaction';
import {
  billingRule,
  commonFeeChargeEvent,
  commonFeeInvoiceResponsibleOwner,
  invoice,
  privateRentInvoiceReviewer,
  turnoverBillingReview,
  turnoverReviewResponsibleOwner,
  type ChargeEventStatus,
  type FeeConfigMode,
  type FeeFrequency,
  type InvoiceKind,
  type ReviewerSnapshotSource,
} from './schema';

export interface BillingRuleRecord {
  id: string;
  kind: InvoiceKind;
  roomId: string | null;
  configMode: FeeConfigMode;
  rate: string | null;
  frequency: FeeFrequency;
  effectiveAt: Date;
  enabled: boolean;
}

function toRuleRow(row: typeof billingRule.$inferSelect): BillingRuleRecord {
  return {
    id: row.id,
    kind: row.kind,
    roomId: row.roomId,
    configMode: row.configMode,
    rate: row.rate,
    frequency: row.frequency,
    effectiveAt: row.effectiveAt,
    enabled: row.enabled,
  };
}

export async function listEnabledRules(conn: Db): Promise<BillingRuleRecord[]> {
  const rows = await conn
    .select()
    .from(billingRule)
    .where(eq(billingRule.enabled, true))
    .orderBy(asc(billingRule.effectiveAt), asc(billingRule.id));
  return rows.map(toRuleRow);
}

export async function insertBillingRule(
  tx: Tx,
  input: {
    kind: InvoiceKind;
    roomId?: string | null | undefined;
    configMode: FeeConfigMode;
    rate?: string | null | undefined;
    frequency: FeeFrequency;
    effectiveAt: Date;
    enabled: boolean;
  },
): Promise<BillingRuleRecord> {
  const rows = await tx
    .insert(billingRule)
    .values({
      kind: input.kind,
      roomId: input.roomId ?? null,
      configMode: input.configMode,
      rate: input.rate ?? null,
      frequency: input.frequency,
      effectiveAt: input.effectiveAt,
      enabled: input.enabled,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Billing rule insert returned no row.');
  return toRuleRow(row);
}

export interface InvoiceInsertInput {
  roomId: string;
  tenancyId?: string | null | undefined;
  kind: InvoiceKind;
  sourceRuleId?: string | null | undefined;
  sourceTurnoverReviewId?: string | null | undefined;
  reviewerSnapshotSource?: ReviewerSnapshotSource | null | undefined;
  oneTimeChargeEventId?: string | null | undefined;
  periodStart: string;
  periodEnd: string;
  serviceStart: Date;
  serviceEndExclusive: Date;
  total: bigint;
  dueDate: string;
  snapshotBoundaryAt: Date;
  snapshotTimezone: string;
  issuerId?: string | null | undefined;
  issuedAt?: Date | null | undefined;
  paymentInstructionSnapshot: Record<string, unknown>;
  ownershipIntervalRef?: string | null | undefined;
  version: number;
}

export async function insertInvoiceIdempotent(
  tx: Tx,
  input: InvoiceInsertInput,
): Promise<{ id: string; inserted: boolean }> {
  const rows = await tx
    .insert(invoice)
    .values({
      roomId: input.roomId,
      tenancyId: input.tenancyId ?? null,
      kind: input.kind,
      sourceRuleId: input.sourceRuleId ?? null,
      sourceTurnoverReviewId: input.sourceTurnoverReviewId ?? null,
      reviewerSnapshotSource: input.reviewerSnapshotSource ?? null,
      oneTimeChargeEventId: input.oneTimeChargeEventId ?? null,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      serviceStart: input.serviceStart,
      serviceEndExclusive: input.serviceEndExclusive,
      total: input.total,
      dueDate: input.dueDate,
      snapshotBoundaryAt: input.snapshotBoundaryAt,
      snapshotTimezone: input.snapshotTimezone,
      issuerId: input.issuerId ?? null,
      issuedAt: input.issuedAt ?? null,
      paymentInstructionSnapshot: input.paymentInstructionSnapshot,
      ownershipIntervalRef: input.ownershipIntervalRef ?? null,
      version: input.version,
    })
    .onConflictDoNothing()
    .returning({ id: invoice.id });
  const row = rows[0];
  if (row !== undefined) return { id: row.id, inserted: true };
  const candidates = await tx
    .select({
      id: invoice.id,
      tenancyId: invoice.tenancyId,
      sourceRuleId: invoice.sourceRuleId,
      oneTimeChargeEventId: invoice.oneTimeChargeEventId,
    })
    .from(invoice)
    .where(
      and(
        eq(invoice.roomId, input.roomId),
        eq(invoice.kind, input.kind),
        input.oneTimeChargeEventId ? undefined : eq(invoice.periodStart, input.periodStart),
      ),
    );
  const found = candidates.find((candidate) => invoiceSourceMatches(input.kind, candidate, input));
  if (found === undefined) throw new Error('Invoice idempotent insert found no row.');
  return { id: found.id, inserted: false };
}

export async function insertRentInvoiceReviewers(
  tx: Tx,
  input: { invoiceId: string; reviewers: { userId: string; ownershipId: string }[]; at: Date },
): Promise<void> {
  if (input.reviewers.length === 0) return;
  await tx
    .insert(privateRentInvoiceReviewer)
    .values(
      input.reviewers.map((reviewer) => ({
        invoiceId: input.invoiceId,
        userId: reviewer.userId,
        ownershipIntervalRef: reviewer.ownershipId,
        grantedAt: input.at,
      })),
    )
    .onConflictDoNothing();
}

export async function insertFeeResponsibleOwners(
  tx: Tx,
  input: { invoiceId: string; owners: { userId: string; ownershipId: string }[]; at: Date },
): Promise<void> {
  if (input.owners.length === 0) return;
  await tx
    .insert(commonFeeInvoiceResponsibleOwner)
    .values(
      input.owners.map((owner) => ({
        invoiceId: input.invoiceId,
        userId: owner.userId,
        ownershipIntervalRef: owner.ownershipId,
        assignedAt: input.at,
      })),
    )
    .onConflictDoNothing();
}

export interface ChargeEventRecord {
  id: string;
  sourceRuleId: string | null;
  eventEffectiveDate: string;
  projectTimezone: string | null;
  configuredAmount: bigint | null;
  chargeContext: unknown;
  createdBy: string | null;
  createdAt: Date;
  status: ChargeEventStatus;
}

function toEventRow(row: typeof commonFeeChargeEvent.$inferSelect): ChargeEventRecord {
  return {
    id: row.id,
    sourceRuleId: row.sourceRuleId,
    eventEffectiveDate: row.eventEffectiveDate,
    projectTimezone: row.projectTimezone,
    configuredAmount: row.configuredAmount,
    chargeContext: row.chargeContext,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    status: row.status,
  };
}

export async function insertChargeEvent(
  tx: Tx,
  input: {
    sourceRuleId?: string | null | undefined;
    eventEffectiveDate: string;
    projectTimezone?: string | null | undefined;
    configuredAmount?: bigint | null | undefined;
    chargeContext?: Record<string, unknown> | null | undefined;
    createdBy?: string | null | undefined;
    status: ChargeEventStatus;
  },
): Promise<ChargeEventRecord> {
  const rows = await tx
    .insert(commonFeeChargeEvent)
    .values({
      sourceRuleId: input.sourceRuleId ?? null,
      eventEffectiveDate: input.eventEffectiveDate,
      projectTimezone: input.projectTimezone ?? null,
      configuredAmount: input.configuredAmount ?? null,
      chargeContext: input.chargeContext ?? null,
      createdBy: input.createdBy ?? null,
      status: input.status,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('Charge event insert returned no row.');
  return toEventRow(row);
}

export async function findChargeEventById(conn: Db, id: string): Promise<ChargeEventRecord | null> {
  const rows = await conn
    .select()
    .from(commonFeeChargeEvent)
    .where(eq(commonFeeChargeEvent.id, id))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toEventRow(row);
}

export async function lockChargeEvent(tx: Tx, id: string): Promise<ChargeEventRecord | null> {
  const rows = await tx
    .select()
    .from(commonFeeChargeEvent)
    .where(eq(commonFeeChargeEvent.id, id))
    .for('update')
    .limit(1);
  return rows[0] ? toEventRow(rows[0]) : null;
}

export async function setChargeEventContext(
  tx: Tx,
  id: string,
  context: Record<string, unknown>,
): Promise<void> {
  await tx
    .update(commonFeeChargeEvent)
    .set({ chargeContext: context })
    .where(eq(commonFeeChargeEvent.id, id));
}

export async function listEventInvoiceRoomIds(conn: Db, eventId: string): Promise<string[]> {
  const rows = await conn
    .select({ roomId: invoice.roomId })
    .from(invoice)
    .where(eq(invoice.oneTimeChargeEventId, eventId));
  return rows.map((row) => row.roomId);
}

export async function listChargeEvents(
  conn: Db,
  status: ChargeEventStatus,
): Promise<ChargeEventRecord[]> {
  const rows = await conn
    .select()
    .from(commonFeeChargeEvent)
    .where(eq(commonFeeChargeEvent.status, status))
    .orderBy(desc(commonFeeChargeEvent.createdAt), desc(commonFeeChargeEvent.id));
  return rows.map(toEventRow);
}

export async function cancelChargeEvent(tx: Tx, id: string): Promise<void> {
  await tx
    .update(commonFeeChargeEvent)
    .set({ status: 'CANCELLED' })
    .where(and(eq(commonFeeChargeEvent.id, id), eq(commonFeeChargeEvent.status, 'OPEN')));
}

export async function listOpenChargeEvents(conn: Db): Promise<ChargeEventRecord[]> {
  const rows = await conn
    .select()
    .from(commonFeeChargeEvent)
    .where(eq(commonFeeChargeEvent.status, 'OPEN'))
    .orderBy(asc(commonFeeChargeEvent.eventEffectiveDate), asc(commonFeeChargeEvent.id));
  return rows.map(toEventRow);
}

export async function markChargeEventIssued(tx: Tx, id: string): Promise<void> {
  await tx
    .update(commonFeeChargeEvent)
    .set({ status: 'ISSUED' })
    .where(and(eq(commonFeeChargeEvent.id, id), eq(commonFeeChargeEvent.status, 'OPEN')));
}

export interface TurnoverReviewRecord {
  id: string;
  roomId: string;
  calendarMonth: string;
  cycleStart: Date;
  cycleTimezone: string;
  managementModeAtCreation: string;
  state: 'UNRESOLVED' | 'RESOLVED' | 'NO_CHARGE';
  candidateTenancyIds: string[];
  version: number;
}

export async function insertTurnoverReviewIdempotent(
  tx: Tx,
  input: {
    roomId: string;
    calendarMonth: string;
    cycleStart: Date;
    cycleTimezone: string;
    managementModeAtCreation: string;
    candidateTenancyIds: string[];
    candidateContext?: Record<string, unknown> | null | undefined;
  },
): Promise<{ id: string; inserted: boolean }> {
  const rows = await tx
    .insert(turnoverBillingReview)
    .values({
      roomId: input.roomId,
      calendarMonth: input.calendarMonth,
      cycleStart: input.cycleStart,
      cycleTimezone: input.cycleTimezone,
      managementModeAtCreation: input.managementModeAtCreation,
      state: 'UNRESOLVED',
      candidateTenancyIds: input.candidateTenancyIds,
      candidateContext: input.candidateContext ?? null,
      version: 1,
    })
    .onConflictDoNothing()
    .returning({ id: turnoverBillingReview.id });
  const row = rows[0];
  if (row !== undefined) return { id: row.id, inserted: true };
  const existing = await tx
    .select({ id: turnoverBillingReview.id })
    .from(turnoverBillingReview)
    .where(
      and(
        eq(turnoverBillingReview.roomId, input.roomId),
        eq(turnoverBillingReview.calendarMonth, input.calendarMonth),
      ),
    )
    .limit(1);
  const found = existing[0];
  if (found === undefined) throw new Error('Turnover review idempotent insert found no row.');
  return { id: found.id, inserted: false };
}

export async function insertReviewResponsibleOwners(
  tx: Tx,
  input: { reviewId: string; owners: { userId: string; ownershipId: string }[]; at: Date },
): Promise<void> {
  if (input.owners.length === 0) return;
  await tx
    .insert(turnoverReviewResponsibleOwner)
    .values(
      input.owners.map((owner) => ({
        reviewId: input.reviewId,
        userId: owner.userId,
        ownershipIntervalRef: owner.ownershipId,
        assignedAt: input.at,
      })),
    )
    .onConflictDoNothing();
}

export async function countInvoicesByRoomKindPeriod(
  conn: Db,
  input: { roomId: string; kind: InvoiceKind; periodStart: string },
): Promise<number> {
  const rows = await conn
    .select({ count: sql<number>`count(*)` })
    .from(invoice)
    .where(
      and(
        eq(invoice.roomId, input.roomId),
        eq(invoice.kind, input.kind),
        eq(invoice.periodStart, input.periodStart),
      ),
    );
  return Number(rows[0]?.count ?? 0);
}

export async function findRuleEffectiveFor(
  conn: Db,
  input: { kind: InvoiceKind; roomId: string | null; frequency: FeeFrequency; at: Date },
): Promise<BillingRuleRecord | null> {
  const rows = await conn
    .select()
    .from(billingRule)
    .where(
      and(
        eq(billingRule.kind, input.kind),
        eq(billingRule.frequency, input.frequency),
        eq(billingRule.enabled, true),
        lte(billingRule.effectiveAt, input.at),
      ),
    )
    .orderBy(desc(billingRule.effectiveAt), desc(billingRule.id));
  const roomRule = rows.find((row) => row.roomId === input.roomId);
  if (roomRule !== undefined) return toRuleRow(roomRule);
  const projectRule = rows.find((row) => row.roomId === null);
  return projectRule === undefined ? null : toRuleRow(projectRule);
}

export async function listRoomRentRules(
  conn: Db,
  roomId: string,
  kind: 'PRIVATE_RENT' | 'PROJECT_MANAGED_RENT',
) {
  return (
    await conn
      .select()
      .from(billingRule)
      .where(
        and(
          eq(billingRule.roomId, roomId),
          eq(billingRule.kind, kind),
          eq(billingRule.enabled, true),
        ),
      )
      .orderBy(desc(billingRule.effectiveAt), desc(billingRule.id))
  ).map(toRuleRow);
}
export async function disableRentRuleAt(
  tx: Tx,
  roomId: string,
  kind: 'PRIVATE_RENT' | 'PROJECT_MANAGED_RENT',
  at: Date,
) {
  await tx
    .update(billingRule)
    .set({ enabled: false })
    .where(
      and(
        eq(billingRule.roomId, roomId),
        eq(billingRule.kind, kind),
        eq(billingRule.effectiveAt, at),
        eq(billingRule.enabled, true),
      ),
    );
}
