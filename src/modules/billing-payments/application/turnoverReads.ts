import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { AppError } from '@/shared/utils/errors';
import { evaluateTurnoverVisibility, scopeForManagementMode } from '../domain/turnoverVisibility';
import {
  countVisibleUnresolvedReviews,
  findTurnoverReviewById,
  listInvoicesForReview,
  listReviewResponsibleOwners,
  listVisibleTurnoverReviews,
  type TurnoverReviewRecord,
} from '../infrastructure/turnoverReviewRepository';

export interface TurnoverReviewDto {
  id: string;
  roomId: string;
  calendarMonth: string;
  cycleStart: string;
  cycleTimezone: string;
  managementModeAtCreation: string;
  state: 'UNRESOLVED' | 'RESOLVED' | 'NO_CHARGE';
  candidateTenancyIds: string[];
  version: number;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionType: 'ISSUE_INVOICES' | 'NO_CHARGE' | null;
  reason: string | null;
  blocked: boolean;
  invoiceIds: string[];
  createdAt: string;
}

export interface TurnoverReviewPage {
  rows: TurnoverReviewDto[];
  total: number;
  unresolvedCount: number;
}

function toDto(
  row: TurnoverReviewRecord,
  input: { blocked: boolean; invoiceIds: string[] },
): TurnoverReviewDto {
  return {
    id: row.id,
    roomId: row.roomId,
    calendarMonth: row.calendarMonth,
    cycleStart: row.cycleStart.toISOString(),
    cycleTimezone: row.cycleTimezone,
    managementModeAtCreation: row.managementModeAtCreation,
    state: row.state,
    candidateTenancyIds: [...row.candidateTenancyIds],
    version: row.version,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt === null ? null : row.decidedAt.toISOString(),
    decisionType: row.decisionType,
    reason: row.reason,
    blocked: input.blocked,
    invoiceIds: input.invoiceIds,
    createdAt: row.createdAt.toISOString(),
  };
}

function assertActive(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

async function toVisibleDto(
  conn: Db,
  actor: Actor,
  row: TurnoverReviewRecord,
): Promise<TurnoverReviewDto | null> {
  const scope = scopeForManagementMode(row.managementModeAtCreation);
  if (scope === 'PROJECT_MANAGED') {
    const verdict = evaluateTurnoverVisibility({
      state: row.state,
      scope,
      actorIsSystemAdmin: actor.isSystemAdmin,
      actorSuspended: false,
      actorInS2Snapshot: false,
    });
    if (!verdict.allowed) {
      if (verdict.httpStatus === 403) throw new AppError('ACCESS_DENIED');
      return null;
    }
    const [owners, invoices] = await Promise.all([
      listReviewResponsibleOwners(conn, row.id),
      row.state === 'UNRESOLVED' ? [] : listInvoicesForReview(conn, row.id),
    ]);
    return toDto(row, {
      blocked: owners.length === 0,
      invoiceIds: invoices.map((entry) => entry.id),
    });
  }
  const owners = await listReviewResponsibleOwners(conn, row.id);
  const verdict = evaluateTurnoverVisibility({
    state: row.state,
    scope,
    actorIsSystemAdmin: actor.isSystemAdmin,
    actorSuspended: false,
    actorInS2Snapshot: owners.some((owner) => owner.userId === actor.userId),
  });
  if (!verdict.allowed) return null;
  const invoices = row.state === 'UNRESOLVED' ? [] : await listInvoicesForReview(conn, row.id);
  return toDto(row, {
    blocked: owners.length === 0,
    invoiceIds: invoices.map((entry) => entry.id),
  });
}

export async function listTurnoverReviews(
  actor: Actor,
  input: {
    state?: 'UNRESOLVED' | 'RESOLVED' | 'NO_CHARGE' | undefined;
    page: number;
    pageSize: number;
  },
  conn: Db = db,
): Promise<TurnoverReviewPage> {
  assertActive(actor);
  const limit = Math.min(Math.max(input.pageSize, 1), 100);
  const offset = (Math.max(input.page, 1) - 1) * limit;
  const scope = { userId: actor.userId, includeProjectManaged: actor.isSystemAdmin };
  const [page, unresolvedCount] = await Promise.all([
    listVisibleTurnoverReviews(conn, {
      ...scope,
      limit,
      offset,
      ...(input.state !== undefined ? { state: input.state } : {}),
    }),
    countVisibleUnresolvedReviews(conn, scope),
  ]);
  const visible: TurnoverReviewDto[] = [];
  for (const row of page.rows) {
    const dto = await toVisibleDto(conn, actor, row);
    if (dto !== null) visible.push(dto);
  }
  return { rows: visible, total: page.total, unresolvedCount };
}

export async function getTurnoverReview(
  actor: Actor,
  id: string,
  conn: Db = db,
): Promise<TurnoverReviewDto | null> {
  assertActive(actor);
  const row = await findTurnoverReviewById(conn, id);
  if (row === null) return null;
  return toVisibleDto(conn, actor, row);
}

export async function countUnresolvedTurnoverReviews(actor: Actor, conn: Db = db): Promise<number> {
  assertActive(actor);
  return countVisibleUnresolvedReviews(conn, {
    userId: actor.userId,
    includeProjectManaged: actor.isSystemAdmin,
  });
}
