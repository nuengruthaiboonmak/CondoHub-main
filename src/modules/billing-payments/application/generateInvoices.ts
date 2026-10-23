import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db, Tx } from '@/shared/db/transaction';
import { AppError } from '@/shared/utils/errors';
import { PROJECT_TIMEZONE } from '@/config/project';
import { writeAudit } from '@/shared/observability/audit';
import {
  getOwnersAt,
  lockTenancyForBilling,
  getRentalPeriods,
  resolveActorRooms,
} from '@/modules/property-membership/application/index';
import { cycleForMonth, isCycleStartMonth, type CommonFeeFrequency } from '../domain/billingCycle';
import {
  decideRentCycle,
  managementModeAt,
  rentKindFor,
  type TenancyOverlapInput,
} from '../domain/rentRecurrence';
import { recurringFeeDueDateForCycle, rentDueDateForCycle } from '../domain/dueDatePolicy';
import { selectRentRule } from '../domain/rentRulePolicy';
import { feeAmountSatang } from '../domain/feeCalc';
import { decideFeeSnapshot } from '../domain/snapshotPolicy';
import { findInvoicePayee } from '../infrastructure/payeeRepository';
import { payeeSnapshotToRecord, systemAutoPayee } from '../domain/payeePolicy';
import { cycleError, type CycleError } from '../domain/cycleError';
import {
  eventMidnight,
  eventServiceRange,
  parseCalendarDate,
  parseYearMonth,
} from '../domain/billingWindow';
import {
  findChargeEventById,
  insertFeeResponsibleOwners,
  insertInvoiceIdempotent,
  insertRentInvoiceReviewers,
  insertReviewResponsibleOwners,
  insertTurnoverReviewIdempotent,
  listEnabledRules,
  markChargeEventIssued,
  type BillingRuleRecord,
  type ChargeEventRecord,
} from '../infrastructure/billingRepository';
import { findReviewByRoomMonth } from '../infrastructure/turnoverReviewRepository';
import type { FeeFrequency } from '../infrastructure/schema';
import type { BillingCtx } from './ctx';
import { readChargeEventRoomScope } from '../domain/chargeEventContext';
import { lockChargeEvent } from '../infrastructure/billingRepository';

export interface RoomCycleInput {
  id: string;
  areaSqm: string;
  status: string;
}

export interface GenerateCycleCounts {
  created: number;
  skipped: number;
  reviewRequired: number;
  privateRentCreated: number;
  privateRentSkipped: number;
  privateReviews: number;
  cycleErrors: CycleError[];
}

export interface GenerateInvoicesDeps {
  finalizeEvent?: boolean | undefined;
  database?: Db;
  rooms?: RoomCycleInput[] | undefined;
  rules?: BillingRuleRecord[] | undefined;
  openEvents?: ChargeEventRecord[] | undefined;
  getOwners?:
    | ((roomId: string, at: Date) => Promise<{ userId: string; ownershipId: string }[]>)
    | undefined;
  getTenancies?: ((roomId: string, month: string) => Promise<TenancyOverlapInput[]>) | undefined;
}

function emptyCycleCounts(): GenerateCycleCounts {
  return {
    created: 0,
    skipped: 0,
    reviewRequired: 0,
    privateRentCreated: 0,
    privateRentSkipped: 0,
    privateReviews: 0,
    cycleErrors: [],
  };
}

async function defaultRooms(actor: Actor, at: Date): Promise<RoomCycleInput[]> {
  const rows = await resolveActorRooms(actor, at);
  return rows.map((row) => ({ id: row.id, areaSqm: row.areaSqm, status: row.status }));
}

async function effectivePayee(
  conn: Db,
  roomId: string,
  kind: string,
  at: Date,
): Promise<Record<string, unknown>> {
  const stored = await findInvoicePayee(conn, {
    payeeType: kind === 'PRIVATE_RENT' ? 'OWNER' : 'PROJECT',
    roomId,
    at,
  });
  return payeeSnapshotToRecord(stored ?? systemAutoPayee());
}

async function generateRentForRoom(
  tx: Tx,
  input: {
    room: RoomCycleInput;
    cycleYm: string;
    year: number;
    month: number;
    counts: GenerateCycleCounts;
    rules: BillingRuleRecord[];
    issuedAt: Date;
    requestId: string;
    getOwners: (roomId: string, at: Date) => Promise<{ userId: string; ownershipId: string }[]>;
    getTenancies: (roomId: string, month: string) => Promise<TenancyOverlapInput[]>;
  },
): Promise<void> {
  const cycle = cycleForMonth('MONTHLY', input.year, input.month, PROJECT_TIMEZONE);
  const calendarMonth = `${input.cycleYm}-01`;
  const existingReview = await findReviewByRoomMonth(tx, {
    roomId: input.room.id,
    calendarMonth,
  });
  if (existingReview !== null) {
    input.counts.skipped += 1;
    return;
  }
  const tenancies = await input.getTenancies(input.room.id, input.cycleYm);
  const decision = decideRentCycle(tenancies, cycle.cycleStart, cycle.cycleEndExclusive);
  if (decision.outcome === 'VACANT') return;
  if (decision.outcome === 'TURNOVER_REVIEW') {
    const owners = await input.getOwners(input.room.id, cycle.cycleStart);
    const inserted = await insertTurnoverReviewIdempotent(tx, {
      roomId: input.room.id,
      calendarMonth,
      cycleStart: cycle.cycleStart,
      cycleTimezone: PROJECT_TIMEZONE,
      managementModeAtCreation: decision.tenancies[0]?.managementMode ?? 'UNKNOWN',
      candidateTenancyIds: decision.tenancies.map((tenancy) => tenancy.id),
      candidateContext: {
        cycle: input.cycleYm,
        tenancyIds: decision.tenancies.map((tenancy) => tenancy.id),
      },
    });
    if (inserted.inserted) {
      await insertReviewResponsibleOwners(tx, {
        reviewId: inserted.id,
        owners: owners.map((owner) => ({ userId: owner.userId, ownershipId: owner.ownershipId })),
        at: input.issuedAt,
      });
      input.counts.reviewRequired += 1;
      const privateCount = decision.tenancies.some(
        (tenancy) => tenancy.managementMode === 'PRIVATE_OWNER_MANAGED',
      )
        ? 1
        : 0;
      input.counts.privateReviews += privateCount;
      await writeAudit(tx, {
        actorId: null,
        action: 'turnover_review.created',
        resourceType: 'turnover_billing_review',
        resourceId: inserted.id,
        requestId: input.requestId,
        after: { roomId: input.room.id, cycle: input.cycleYm },
      });
    } else {
      input.counts.skipped += 1;
    }
    return;
  }
  const kind = rentKindFor(decision.tenancy.managementMode);
  const rule = selectRentRule(input.rules, input.room.id, kind, cycle.cycleStart);
  if (rule === null) {
    input.counts.cycleErrors.push(
      cycleError(input.room.id, input.cycleYm, 'The rent rule is missing for this cycle.'),
    );
    return;
  }
  const total = feeAmountSatang({
    configMode: rule.configMode,
    rate: rule.rate,
    roomAreaSqm: input.room.areaSqm,
  });
  if (!(await lockTenancyForBilling(tx, decision.tenancy.id))) {
    input.counts.skipped += 1;
    if (kind === 'PRIVATE_RENT') input.counts.privateRentSkipped += 1;
    return;
  }
  const inserted = await insertInvoiceIdempotent(tx, {
    roomId: input.room.id,
    tenancyId: decision.tenancy.id,
    kind,
    sourceRuleId: rule.id,
    periodStart: cycle.periodStart,
    periodEnd: cycle.periodEnd,
    serviceStart: cycle.serviceStart,
    serviceEndExclusive: cycle.serviceEndExclusive,
    total,
    dueDate: rentDueDateForCycle(input.year, input.month),
    snapshotBoundaryAt: input.issuedAt,
    snapshotTimezone: PROJECT_TIMEZONE,
    issuedAt: input.issuedAt,
    paymentInstructionSnapshot: await effectivePayee(tx, input.room.id, kind, input.issuedAt),
    version: 1,
  });
  if (!inserted.inserted) {
    input.counts.skipped += 1;
    if (kind === 'PRIVATE_RENT') input.counts.privateRentSkipped += 1;
    return;
  }
  input.counts.created += 1;
  if (kind === 'PRIVATE_RENT') {
    input.counts.privateRentCreated += 1;
    const reviewers = await input.getOwners(input.room.id, input.issuedAt);
    await insertRentInvoiceReviewers(tx, {
      invoiceId: inserted.id,
      reviewers: reviewers.map((owner) => ({
        userId: owner.userId,
        ownershipId: owner.ownershipId,
      })),
      at: input.issuedAt,
    });
  }
  await writeAudit(tx, {
    actorId: null,
    action: 'invoice.generated',
    resourceType: 'invoice',
    resourceId: inserted.id,
    requestId: input.requestId,
    after: { roomId: input.room.id, kind, cycle: input.cycleYm },
  });
}

async function generateFeesForRoom(
  tx: Tx,
  input: {
    room: RoomCycleInput;
    cycleYm: string;
    year: number;
    month: number;
    counts: GenerateCycleCounts;
    rules: BillingRuleRecord[];
    issuedAt: Date;
    requestId: string;
    getOwners: (roomId: string, at: Date) => Promise<{ userId: string; ownershipId: string }[]>;
    getTenancies: (roomId: string, month: string) => Promise<TenancyOverlapInput[]>;
  },
): Promise<void> {
  const frequencies: FeeFrequency[] = ['MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'YEARLY'];
  for (const frequency of frequencies) {
    if (!isCycleStartMonth(frequency as CommonFeeFrequency, input.year, input.month)) continue;
    const rule = input.rules.find(
      (candidate) =>
        candidate.kind === 'COMMON_FEE' &&
        candidate.frequency === frequency &&
        candidate.effectiveAt.getTime() <=
          cycleForMonth(
            frequency as CommonFeeFrequency,
            input.year,
            input.month,
            PROJECT_TIMEZONE,
          ).cycleStart.getTime() &&
        (candidate.roomId === null || candidate.roomId === input.room.id),
    );
    if (rule === undefined) continue;
    const cycle = cycleForMonth(
      frequency as CommonFeeFrequency,
      input.year,
      input.month,
      PROJECT_TIMEZONE,
    );
    const owners = await input.getOwners(input.room.id, cycle.cycleStart);
    const boundaryTenancies = await input.getTenancies(
      input.room.id,
      cycle.periodStart.slice(0, 7),
    );
    const boundaryMode = managementModeAt(boundaryTenancies, cycle.cycleStart);
    const snapshot = decideFeeSnapshot({
      ownersAtBoundary: owners,
      managementMode: boundaryMode ?? 'UNKNOWN',
    });
    if (snapshot.outcome === 'CYCLE_ERROR') {
      const feeCycle = `${cycle.periodStart.slice(0, 7)}`;
      input.counts.cycleErrors.push(cycleError(input.room.id, feeCycle, snapshot.reason));
      continue;
    }
    const total = feeAmountSatang({
      configMode: rule.configMode,
      rate: rule.rate,
      roomAreaSqm: input.room.areaSqm,
    });
    const startYm = parseYearMonth(cycle.periodStart.slice(0, 7));
    const inserted = await insertInvoiceIdempotent(tx, {
      roomId: input.room.id,
      kind: 'COMMON_FEE',
      sourceRuleId: rule.id,
      periodStart: cycle.periodStart,
      periodEnd: cycle.periodEnd,
      serviceStart: cycle.serviceStart,
      serviceEndExclusive: cycle.serviceEndExclusive,
      total,
      dueDate: recurringFeeDueDateForCycle(startYm.year, startYm.month),
      snapshotBoundaryAt: cycle.cycleStart,
      snapshotTimezone: PROJECT_TIMEZONE,
      issuedAt: input.issuedAt,
      paymentInstructionSnapshot: await effectivePayee(
        tx,
        input.room.id,
        'COMMON_FEE',
        input.issuedAt,
      ),
      version: 1,
    });
    if (!inserted.inserted) {
      input.counts.skipped += 1;
      continue;
    }
    input.counts.created += 1;
    if (snapshot.outcome === 'SNAPSHOT') {
      await insertFeeResponsibleOwners(tx, {
        invoiceId: inserted.id,
        owners: snapshot.owners.map((owner) => ({
          userId: owner.userId,
          ownershipId: owner.ownershipId,
        })),
        at: input.issuedAt,
      });
    }
    await writeAudit(tx, {
      actorId: null,
      action: 'invoice.generated',
      resourceType: 'invoice',
      resourceId: inserted.id,
      requestId: input.requestId,
      after: { roomId: input.room.id, kind: 'COMMON_FEE', cycle: cycle.periodStart.slice(0, 7) },
    });
  }
}

export async function generateInvoicesForCycle(
  actor: Actor,
  cycleYm: string,
  ctx: BillingCtx,
  deps: GenerateInvoicesDeps = {},
): Promise<GenerateCycleCounts> {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  const { year, month } = parseYearMonth(cycleYm);
  const database = deps.database ?? db;
  const issuedAt = ctx.clock.now();
  const counts = emptyCycleCounts();
  const rooms = deps.rooms ?? (await defaultRooms(actor, issuedAt));
  const rules = deps.rules ?? (await listEnabledRules(database));
  const getOwners = deps.getOwners ?? ((roomId: string, at: Date) => getOwnersAt(roomId, at));
  const getTenancies =
    deps.getTenancies ??
    (async (roomId: string, monthKey: string): Promise<TenancyOverlapInput[]> => {
      const periods = await getRentalPeriods(roomId, monthKey);
      return periods.map((period) => ({
        id: period.id,
        startsAt: period.startsAt,
        endsAt: period.endsAt,
        managementMode: period.managementMode,
      }));
    });
  for (const room of rooms) {
    if (room.status !== 'ACTIVE') continue;
    await database.transaction(async (tx) => {
      await generateRentForRoom(tx, {
        room,
        cycleYm,
        year,
        month,
        counts,
        rules,
        issuedAt,
        requestId: ctx.requestId,
        getOwners,
        getTenancies,
      });
      await generateFeesForRoom(tx, {
        room,
        cycleYm,
        year,
        month,
        counts,
        rules,
        issuedAt,
        requestId: ctx.requestId,
        getOwners,
        getTenancies,
      });
    });
  }
  return counts;
}

export async function generateOneTimeEventInvoices(
  actor: Actor,
  eventId: string,
  ctx: BillingCtx,
  deps: GenerateInvoicesDeps = {},
): Promise<GenerateCycleCounts> {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  if (!actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
  const database = deps.database ?? db;
  const issuedAt = ctx.clock.now();
  const counts = emptyCycleCounts();
  const event: ChargeEventRecord | null =
    deps.openEvents?.find((candidate) => candidate.id === eventId) ??
    (await findChargeEventById(database, eventId));
  if (event === null || event === undefined) throw new AppError('RESOURCE_NOT_FOUND');
  if (event.status !== 'OPEN') return counts;
  parseCalendarDate(event.eventEffectiveDate);
  const range = eventServiceRange(
    event.eventEffectiveDate,
    event.projectTimezone ?? PROJECT_TIMEZONE,
  );
  const boundary = eventMidnight(
    event.eventEffectiveDate,
    event.projectTimezone ?? PROJECT_TIMEZONE,
  );
  const rooms = deps.rooms ?? (await defaultRooms(actor, issuedAt));
  const rules = deps.rules ?? (await listEnabledRules(database));
  const getOwners = deps.getOwners ?? ((roomId: string, at: Date) => getOwnersAt(roomId, at));
  const getTenancies =
    deps.getTenancies ??
    (async (roomId: string, monthKey: string): Promise<TenancyOverlapInput[]> => {
      const periods = await getRentalPeriods(roomId, monthKey);
      return periods.map((period) => ({
        id: period.id,
        startsAt: period.startsAt,
        endsAt: period.endsAt,
        managementMode: period.managementMode,
      }));
    });
  const fallbackRule = rules.find(
    (candidate) => candidate.kind === 'COMMON_FEE' && candidate.frequency === 'ONE_TIME',
  );
  for (const room of rooms) {
    if (room.status !== 'ACTIVE') continue;
    await database.transaction(async (tx) => {
      const currentEvent = await lockChargeEvent(tx, event.id);
      if (!currentEvent || currentEvent.status !== 'OPEN') {
        counts.skipped += 1;
        return;
      }
      const scope = readChargeEventRoomScope(currentEvent.chargeContext);
      if (scope && !scope.includes(room.id)) {
        counts.skipped += 1;
        return;
      }
      const owners = await getOwners(room.id, boundary);
      const boundaryTenancies = await getTenancies(room.id, event.eventEffectiveDate.slice(0, 7));
      const boundaryMode = managementModeAt(boundaryTenancies, boundary);
      const snapshot = decideFeeSnapshot({
        ownersAtBoundary: owners,
        managementMode: boundaryMode ?? 'UNKNOWN',
      });
      if (snapshot.outcome === 'CYCLE_ERROR') {
        counts.cycleErrors.push(
          cycleError(room.id, event.eventEffectiveDate.slice(0, 7), snapshot.reason),
        );
        return;
      }
      let total = event.configuredAmount;
      if (total === null) {
        if (fallbackRule === undefined) {
          counts.cycleErrors.push(
            cycleError(
              room.id,
              event.eventEffectiveDate.slice(0, 7),
              'The one-time amount is required.',
            ),
          );
          return;
        }
        total = feeAmountSatang({
          configMode: fallbackRule.configMode,
          rate: fallbackRule.rate,
          roomAreaSqm: room.areaSqm,
        });
      }
      const inserted = await insertInvoiceIdempotent(tx, {
        roomId: room.id,
        kind: 'COMMON_FEE',
        oneTimeChargeEventId: event.id,
        periodStart: event.eventEffectiveDate,
        periodEnd: range.periodEnd,
        serviceStart: range.serviceStart,
        serviceEndExclusive: range.serviceEndExclusive,
        total,
        dueDate: event.eventEffectiveDate,
        snapshotBoundaryAt: boundary,
        snapshotTimezone: event.projectTimezone ?? PROJECT_TIMEZONE,
        issuedAt,
        paymentInstructionSnapshot: await effectivePayee(tx, room.id, 'COMMON_FEE', issuedAt),
        version: 1,
      });
      if (!inserted.inserted) {
        counts.skipped += 1;
        return;
      }
      counts.created += 1;
      if (snapshot.outcome === 'SNAPSHOT') {
        await insertFeeResponsibleOwners(tx, {
          invoiceId: inserted.id,
          owners: snapshot.owners.map((owner) => ({
            userId: owner.userId,
            ownershipId: owner.ownershipId,
          })),
          at: issuedAt,
        });
      }
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'invoice.generated',
        resourceType: 'invoice',
        resourceId: inserted.id,
        requestId: ctx.requestId,
        after: { roomId: room.id, kind: 'COMMON_FEE', eventId: event.id },
      });
    });
  }
  if (counts.cycleErrors.length === 0 && deps.finalizeEvent !== false) {
    await database.transaction(async (tx) => {
      await markChargeEventIssued(tx, event.id);
    });
  }
  return counts;
}
