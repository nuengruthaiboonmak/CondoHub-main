import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { AppError, mapPgError } from '@/shared/utils/errors';
import { hashRequestBody } from '@/shared/utils/idempotency';
import { formatProjectDate, projectDateParts } from '@/shared/utils/clock';
import { satangToDecimalString } from '@/shared/utils/money';
import { moneyWireBodyToSatang, type MoneyWireBody } from '@/shared/utils/moneySchema';
import { writeAudit } from '@/shared/observability/audit';
import {
  getRoomDetail,
  lockTenancyForBilling,
} from '@/modules/property-membership/application/index';
import {
  assertDueDateCalendarValid,
  assertExpectedVersion,
  assertIssueSelection,
  assertNoChargeSelection,
  assertPastDueDateConfirmed,
  assertResolvableState,
  buildReviewerCopy,
  deriveRentTotalSatang,
  resolveInvoiceTotal,
} from '../domain/turnoverResolve';
import { evaluateTurnoverVisibility, scopeForManagementMode } from '../domain/turnoverVisibility';
import { rentKindFor } from '../domain/rentRecurrence';
import { cycleForMonth } from '../domain/billingCycle';
import { parseYearMonth } from '../domain/billingWindow';
import { buildPayeeSnapshot, payeeSnapshotToRecord } from '../domain/payeePolicy';
import {
  countInvoicesForReview,
  findTurnoverReviewById,
  insertTurnoverInvoice,
  insertTurnoverReviewerCopy,
  listInvoicesForReview,
  listReviewResponsibleOwners,
  lockTurnoverReviewForUpdate,
  updateTurnoverReviewDecision,
  type TurnoverInvoiceRecord,
  type TurnoverReviewRecord,
} from '../infrastructure/turnoverReviewRepository';
import { findRuleEffectiveFor, type BillingRuleRecord } from '../infrastructure/billingRepository';
import { findInvoicePayee, findPayeeEffectiveAt } from '../infrastructure/payeeRepository';
import type { InvoiceKind } from '../infrastructure/schema';
import {
  getTurnoverIdempotencyRecord,
  upsertTurnoverIdempotencyRecord,
} from './turnoverIdempotency';
import type { BillingCtx } from './ctx';

export interface ResolvePerInvoiceInput {
  tenancyId: string;
  dueDate: string;
  confirmPastDueDate?: boolean | undefined;
  amountOverride?: MoneyWireBody | undefined;
  overrideReason?: string | undefined;
}

export type ResolveTurnoverInput =
  | {
      decision: 'ISSUE_INVOICES';
      selectedTenancyIds: string[];
      perInvoice: ResolvePerInvoiceInput[];
      expectedVersion: number;
      idempotencyKey?: string | undefined;
    }
  | {
      decision: 'NO_CHARGE';
      selectedTenancyIds: [];
      reason: string;
      expectedVersion: number;
      idempotencyKey?: string | undefined;
    };

export interface ResolveTurnoverInvoiceDto {
  id: string;
  tenancyId: string | null;
  kind: InvoiceKind;
  periodStart: string;
  dueDate: string;
  total: { amount: string; currency: 'THB' };
  reviewerSnapshotSource: 'ISSUE_TIME' | 'TURNOVER_REVIEW' | null;
  sourceTurnoverReviewId: string | null;
  pastDueDateConfirmed: boolean;
}

export interface ResolveTurnoverDto {
  reviewId: string;
  state: 'RESOLVED' | 'NO_CHARGE';
  version: number;
  decision: 'ISSUE_INVOICES' | 'NO_CHARGE';
  decidedBy: string;
  decidedAt: string;
  reason: string | null;
  invoices: ResolveTurnoverInvoiceDto[];
}

function toInvoiceDto(row: TurnoverInvoiceRecord): ResolveTurnoverInvoiceDto {
  return {
    id: row.id,
    tenancyId: row.tenancyId,
    kind: row.kind,
    periodStart: row.periodStart,
    dueDate: row.dueDate,
    total: { amount: satangToDecimalString(row.total), currency: 'THB' },
    reviewerSnapshotSource: row.reviewerSnapshotSource,
    sourceTurnoverReviewId: row.sourceTurnoverReviewId,
    pastDueDateConfirmed: row.pastDueDateConfirmed === true,
  };
}

function assertActive(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

async function assertReviewVisible(
  conn: Db,
  actor: Actor,
  review: TurnoverReviewRecord,
): Promise<{ userId: string; ownershipIntervalRef: string | null }[]> {
  const scope = scopeForManagementMode(review.managementModeAtCreation);
  if (scope === 'PROJECT_MANAGED') {
    const verdict = evaluateTurnoverVisibility({
      state: review.state,
      scope,
      actorIsSystemAdmin: actor.isSystemAdmin,
      actorSuspended: false,
      actorInS2Snapshot: false,
    });
    if (!verdict.allowed) {
      if (verdict.httpStatus === 403) throw new AppError('ACCESS_DENIED');
      throw new AppError('RESOURCE_NOT_FOUND');
    }
    return listReviewResponsibleOwners(conn, review.id);
  }
  const owners = await listReviewResponsibleOwners(conn, review.id);
  const verdict = evaluateTurnoverVisibility({
    state: review.state,
    scope,
    actorIsSystemAdmin: actor.isSystemAdmin,
    actorSuspended: false,
    actorInS2Snapshot: owners.some((owner) => owner.userId === actor.userId),
  });
  if (!verdict.allowed) throw new AppError('RESOURCE_NOT_FOUND');
  return owners;
}

async function toResolveDto(
  conn: Db,
  review: TurnoverReviewRecord,
): Promise<ResolveTurnoverDto | null> {
  if (review.state !== 'RESOLVED' && review.state !== 'NO_CHARGE') return null;
  if (review.decidedBy === null || review.decidedAt === null || review.decisionType === null) {
    return null;
  }
  const invoices = review.state === 'RESOLVED' ? await listInvoicesForReview(conn, review.id) : [];
  return {
    reviewId: review.id,
    state: review.state,
    version: review.version,
    decision: review.decisionType,
    decidedBy: review.decidedBy,
    decidedAt: review.decidedAt.toISOString(),
    reason: review.reason,
    invoices: invoices.map(toInvoiceDto),
  };
}

function issueDateFor(now: Date, timeZone: string): string {
  const parts = projectDateParts(now, timeZone);
  return formatProjectDate(parts);
}

function payeeTypeForKind(kind: InvoiceKind): string {
  return kind === 'PRIVATE_RENT' ? 'OWNER' : 'PROJECT';
}

async function resolvePayeeSnapshot(
  conn: Db,
  input: {
    kind: InvoiceKind;
    roomId: string;
    cycleStart: Date;
    issuedAt: Date;
  },
): Promise<Record<string, unknown>> {
  const payeeKey = { payeeType: payeeTypeForKind(input.kind), payeeId: input.roomId };
  const stored =
    input.kind !== 'PRIVATE_RENT'
      ? await findInvoicePayee(conn, {
          payeeType: 'PROJECT',
          roomId: input.roomId,
          at: input.issuedAt,
        })
      : ((await findPayeeEffectiveAt(conn, { ...payeeKey, at: input.cycleStart })) ??
        (await findPayeeEffectiveAt(conn, { ...payeeKey, at: input.issuedAt })));
  if (stored === null) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Configure the receiving account in Payment settings before issuing invoices for this review.',
    );
  }
  return payeeSnapshotToRecord(
    buildPayeeSnapshot({
      bankName: stored.bankName,
      accountName: stored.accountName,
      accountNumber: stored.accountNumber,
      qrImageId: stored.qrImageId,
      confirmed: true,
    }),
  );
}

export async function resolveTurnoverReview(
  actor: Actor,
  reviewId: string,
  input: ResolveTurnoverInput,
  ctx: BillingCtx,
  conn: Db = db,
): Promise<ResolveTurnoverDto> {
  assertActive(actor);
  const now = ctx.clock.now();
  const review = await findTurnoverReviewById(conn, reviewId);
  if (review === null) throw new AppError('RESOURCE_NOT_FOUND');
  await assertReviewVisible(conn, actor, review);
  const requestHash = hashRequestBody({
    reviewId,
    decision: input.decision,
    selectedTenancyIds: [...input.selectedTenancyIds].sort(),
    perInvoice:
      input.decision === 'ISSUE_INVOICES'
        ? [...input.perInvoice]
            .map((entry) => ({
              tenancyId: entry.tenancyId,
              dueDate: entry.dueDate,
              confirmPastDueDate: entry.confirmPastDueDate ?? null,
              amountOverride: entry.amountOverride ?? null,
              overrideReason: entry.overrideReason ?? null,
            }))
            .sort((left, right) => left.tenancyId.localeCompare(right.tenancyId))
        : null,
    reason: input.decision === 'NO_CHARGE' ? input.reason : null,
    expectedVersion: input.expectedVersion,
  });
  if (input.idempotencyKey !== undefined) {
    const existing = await getTurnoverIdempotencyRecord(conn, {
      scope: 'TURNOVER_RESOLVE',
      key: input.idempotencyKey,
    });
    if (existing !== null) {
      if (existing.requestHash !== requestHash) {
        throw new AppError(
          'VALIDATION_ERROR',
          'The Idempotency-Key was already used with a different request.',
        );
      }
      if (existing.resultRefId !== null) {
        const target = await findTurnoverReviewById(conn, existing.resultRefId);
        if (target !== null) {
          await assertReviewVisible(conn, actor, target);
          const replay = await toResolveDto(conn, target);
          if (replay !== null) return replay;
        }
      }
      throw new AppError('RATE_LIMITED');
    }
  }
  try {
    return await conn.transaction(async (tx) => {
      const locked = await lockTurnoverReviewForUpdate(tx, reviewId);
      if (locked === null) throw new AppError('RESOURCE_NOT_FOUND');
      assertResolvableState(locked.state);
      assertExpectedVersion({ expected: input.expectedVersion, actual: locked.version });
      const owners = await listReviewResponsibleOwners(tx, locked.id);
      const scope = scopeForManagementMode(locked.managementModeAtCreation);
      const membership = evaluateTurnoverVisibility({
        state: locked.state,
        scope,
        actorIsSystemAdmin: actor.isSystemAdmin,
        actorSuspended: false,
        actorInS2Snapshot: owners.some((owner) => owner.userId === actor.userId),
      });
      if (!membership.allowed) {
        if (scope === 'PROJECT_MANAGED') throw new AppError('ACCESS_DENIED');
        throw new AppError('RESOURCE_NOT_FOUND');
      }
      const issueDate = issueDateFor(now, locked.cycleTimezone);
      if (input.decision === 'NO_CHARGE') {
        assertNoChargeSelection({
          selectedTenancyIds: input.selectedTenancyIds,
          reason: input.reason,
        });
        if (owners.length === 0) {
          throw new AppError('INTERNAL_ERROR', 'The turnover review has no responsible owners.');
        }
        const existingInvoices = await countInvoicesForReview(tx, locked.id);
        if (existingInvoices !== 0) {
          throw new AppError('INTERNAL_ERROR', 'The review already has invoices.');
        }
        const decided = await updateTurnoverReviewDecision(tx, {
          id: locked.id,
          fromVersion: locked.version,
          state: 'NO_CHARGE',
          decisionType: 'NO_CHARGE',
          reason: input.reason,
          decidedBy: actor.userId,
          decidedAt: now,
        });
        if (decided === null) throw new AppError('VERSION_CONFLICT');
        await writeAudit(tx, {
          actorId: actor.userId,
          action: 'turnover_review.resolved',
          resourceType: 'turnover_billing_review',
          resourceId: locked.id,
          requestId: ctx.requestId,
          before: { state: 'UNRESOLVED', version: locked.version },
          after: {
            state: 'NO_CHARGE',
            decision: 'NO_CHARGE',
            version: decided.version,
            reason: input.reason,
          },
          at: now,
        });
        const dto = await toResolveDto(tx, decided);
        if (dto === null) throw new AppError('INTERNAL_ERROR');
        if (input.idempotencyKey !== undefined) {
          await upsertTurnoverIdempotencyRecord(tx, {
            scope: 'TURNOVER_RESOLVE',
            key: input.idempotencyKey,
            actorId: actor.userId,
            requestHash,
            resultRefType: 'turnover_billing_review',
            resultRefId: locked.id,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          });
        }
        return dto;
      }
      assertIssueSelection({
        selectedTenancyIds: input.selectedTenancyIds,
        perInvoice: input.perInvoice,
        candidateTenancyIds: locked.candidateTenancyIds,
      });
      if (owners.length === 0) {
        throw new AppError('INTERNAL_ERROR', 'The turnover review has no responsible owners.');
      }
      const reviewerCopy = buildReviewerCopy({
        s2Rows: owners.map((owner) => ({
          userId: owner.userId,
          ownershipIntervalRef: owner.ownershipIntervalRef,
        })),
      });
      const periodMonth = locked.calendarMonth.slice(0, 7);
      const { year, month } = parseYearMonth(periodMonth);
      const cycle = cycleForMonth('MONTHLY', year, month, locked.cycleTimezone);
      const room = await getRoomDetail(locked.roomId);
      const kind: InvoiceKind =
        scope === 'PROJECT_MANAGED' ? 'PROJECT_MANAGED_RENT' : 'PRIVATE_RENT';
      const rule: BillingRuleRecord | null = await findRuleEffectiveFor(tx, {
        kind,
        roomId: locked.roomId,
        frequency: 'MONTHLY',
        at: locked.cycleStart,
      });
      if (rule === null) {
        throw new AppError('INTERNAL_ERROR', 'The rent rule is missing for this review.');
      }
      const ordered = [...input.perInvoice].sort((left, right) =>
        left.tenancyId.localeCompare(right.tenancyId),
      );
      const managementMode =
        scope === 'PROJECT_MANAGED' ? 'PROJECT_MANAGED' : 'PRIVATE_OWNER_MANAGED';
      const expectedKind = rentKindFor(managementMode);
      if (expectedKind !== kind) throw new AppError('INTERNAL_ERROR');
      const created: TurnoverInvoiceRecord[] = [];
      for (const entry of ordered) {
        if (!(await lockTenancyForBilling(tx, entry.tenancyId)))
          throw new AppError(
            'VALIDATION_ERROR',
            'A selected rental was cancelled. Reload the review and choose another rental or no charge.',
          );
        assertDueDateCalendarValid(entry.dueDate);
        const isPast = assertPastDueDateConfirmed({
          dueDate: entry.dueDate,
          issueDate,
          ...(entry.confirmPastDueDate !== undefined
            ? { confirmPastDueDate: entry.confirmPastDueDate }
            : {}),
        });
        const derived = deriveRentTotalSatang(
          { configMode: rule.configMode, rate: rule.rate },
          room.areaSqm,
        );
        const overrideSatang =
          entry.amountOverride === undefined ? null : moneyWireBodyToSatang(entry.amountOverride);
        const resolved = resolveInvoiceTotal({
          derivedSatang: derived,
          amountOverrideSatang: overrideSatang,
          overrideReason: entry.overrideReason ?? null,
          actorIsSystemAdmin: actor.isSystemAdmin,
        });
        const payee = await resolvePayeeSnapshot(tx, {
          kind,
          roomId: locked.roomId,
          cycleStart: locked.cycleStart,
          issuedAt: now,
        });
        const inserted = await insertTurnoverInvoice(tx, {
          roomId: locked.roomId,
          tenancyId: entry.tenancyId,
          kind,
          sourceRuleId: rule.id,
          sourceTurnoverReviewId: locked.id,
          reviewerSnapshotSource: 'TURNOVER_REVIEW',
          periodStart: cycle.periodStart,
          periodEnd: cycle.periodEnd,
          serviceStart: cycle.serviceStart,
          serviceEndExclusive: cycle.serviceEndExclusive,
          total: resolved.totalSatang,
          dueDate: entry.dueDate,
          snapshotBoundaryAt: locked.cycleStart,
          snapshotTimezone: locked.cycleTimezone,
          issuerId: actor.userId,
          issuedAt: now,
          paymentInstructionSnapshot: payee,
          pastDueDateConfirmed: isPast,
          pastDueDateConfirmedAt: now,
        });
        await insertTurnoverReviewerCopy(tx, {
          invoiceId: inserted.id,
          reviewers: reviewerCopy,
          at: now,
        });
        created.push(inserted);
        await writeAudit(tx, {
          actorId: actor.userId,
          action: 'turnover_invoice.issued',
          resourceType: 'invoice',
          resourceId: inserted.id,
          requestId: ctx.requestId,
          after: {
            reviewId: locked.id,
            tenancyId: entry.tenancyId,
            kind,
            dueDate: entry.dueDate,
            pastDueDateConfirmed: isPast,
            overridden: resolved.overridden,
            ...(resolved.overridden
              ? {
                  derivedTotal: derived.toString(),
                  newTotal: resolved.totalSatang.toString(),
                  overrideReason: (entry.overrideReason ?? '').trim(),
                }
              : {}),
          },
          at: now,
        });
      }
      if (created.length === 0) {
        throw new AppError('INTERNAL_ERROR', 'The resolve created no invoices.');
      }
      const decided = await updateTurnoverReviewDecision(tx, {
        id: locked.id,
        fromVersion: locked.version,
        state: 'RESOLVED',
        decisionType: 'ISSUE_INVOICES',
        reason: null,
        decidedBy: actor.userId,
        decidedAt: now,
      });
      if (decided === null) throw new AppError('VERSION_CONFLICT');
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'turnover_review.resolved',
        resourceType: 'turnover_billing_review',
        resourceId: locked.id,
        requestId: ctx.requestId,
        before: { state: 'UNRESOLVED', version: locked.version },
        after: {
          state: 'RESOLVED',
          decision: 'ISSUE_INVOICES',
          version: decided.version,
          tenancyIds: ordered.map((entry) => entry.tenancyId),
        },
        at: now,
      });
      const dto = await toResolveDto(tx, decided);
      if (dto === null) throw new AppError('INTERNAL_ERROR');
      if (input.idempotencyKey !== undefined) {
        await upsertTurnoverIdempotencyRecord(tx, {
          scope: 'TURNOVER_RESOLVE',
          key: input.idempotencyKey,
          actorId: actor.userId,
          requestHash,
          resultRefType: 'turnover_billing_review',
          resultRefId: locked.id,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        });
      }
      return dto;
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: {
        invoice_rent_natural_puq: 'VERSION_CONFLICT',
        turnover_review_room_month_uq: 'VERSION_CONFLICT',
        private_rent_invoice_reviewer_invoice_id_user_id_pk: 'VERSION_CONFLICT',
        turnover_review_responsible_owner_review_id_user_id_pk: 'VERSION_CONFLICT',
      },
    });
  }
}
