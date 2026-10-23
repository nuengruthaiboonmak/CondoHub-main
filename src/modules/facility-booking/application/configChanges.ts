import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { mapPgError, AppError } from '@/shared/utils/errors';
import { hashRequestBody } from '@/shared/utils/idempotency';
import { toPeriodKey } from '@/shared/utils/clock';
import { writeAudit } from '@/shared/observability/audit';
import type { QuotaKind } from '@/shared/utils/clock';
import {
  assertValidSchedule,
  generateSlotsForDate,
  projectLocalDateString,
  type ClosureWindow,
  type FacilitySchedule,
} from '../domain/schedule';
import { countQuotaUsed } from '../domain/quotaLedger';
import {
  assertEffectiveAtAllowed,
  isQuotaOnlyReduction,
  previewFingerprint,
  proposedConfigsEqual,
  type ProposedConfig,
} from '../domain/configPolicy';
import {
  findConfigById,
  findEffectiveConfig,
  findFacilityById,
  findPendingConfig,
  insertFacilityConfig,
  listAdjustmentsForRoomFacility,
  listClosuresOverlapping,
  listConfirmedFutureSlots,
  listQuotaConsumingSlots,
  maxConfigVersion,
  type BookingSlotRecord,
  type FacilityConfigRecord,
} from '../infrastructure/facilityRepository';
import { getIdempotencyRecord, upsertIdempotencyRecord } from './idempotencyStore';
import type { BookingCtx } from './ctx';

function requireAdmin(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
  if (!actor.isSystemAdmin) throw new AppError('ACCESS_DENIED');
}

export interface ImpactSlotDto {
  id: string;
  bookingId: string;
  roomId: string;
  startsAt: string;
  endsAt: string;
  conflicts: Array<'SCHEDULE' | 'SLOT_LENGTH' | 'CAPACITY' | 'CLOSURE'>;
}

export interface QuotaImpactDto {
  roomId: string;
  periodKey: string;
  used: number;
  newLimit: number;
  overBy: number;
}

export interface ConfigPreviewDto {
  facilityId: string;
  configVersion: number;
  effectiveAt: string;
  proposed: ProposedConfig;
  quotaOnlyReduction: boolean;
  structuralConflicts: ImpactSlotDto[];
  quotaImpacts: QuotaImpactDto[];
  previewToken: string;
}

export interface ConfigCommitDto {
  facilityId: string;
  configId: string;
  version: number;
  effectiveAt: string;
  proposed: ProposedConfig;
  quotaOnlyReduction: boolean;
  quotaImpacts: QuotaImpactDto[];
}

interface PreviewTokenPayload {
  facilityId: string;
  configVersion: number;
  effectiveAt: string;
  proposed: ProposedConfig;
  fingerprint: string;
}

export function encodePreviewToken(payload: PreviewTokenPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodePreviewToken(value: string): PreviewTokenPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new AppError('VALIDATION_ERROR', 'The preview token is invalid.');
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new AppError('VALIDATION_ERROR', 'The preview token is invalid.');
  }
  const record = parsed as Record<string, unknown>;
  if (
    typeof record.facilityId !== 'string' ||
    typeof record.configVersion !== 'number' ||
    typeof record.effectiveAt !== 'string' ||
    typeof record.fingerprint !== 'string' ||
    typeof record.proposed !== 'object' ||
    record.proposed === null
  ) {
    throw new AppError('VALIDATION_ERROR', 'The preview token is invalid.');
  }
  const proposed = record.proposed as Record<string, unknown>;
  assertValidSchedule(proposed.schedule);
  if (
    !Number.isInteger(proposed.slotMinutes) ||
    !Number.isInteger(proposed.capacity) ||
    !Number.isInteger(proposed.quotaLimit) ||
    !Number.isInteger(proposed.advanceDays) ||
    (proposed.quotaKind !== 'DAILY' &&
      proposed.quotaKind !== 'WEEKLY' &&
      proposed.quotaKind !== 'MONTHLY')
  ) {
    throw new AppError('VALIDATION_ERROR', 'The preview token is invalid.');
  }
  return {
    facilityId: record.facilityId,
    configVersion: record.configVersion,
    effectiveAt: record.effectiveAt,
    proposed: proposed as unknown as ProposedConfig,
    fingerprint: record.fingerprint,
  };
}

function slotLengthOk(slot: BookingSlotRecord, slotMinutes: number): boolean {
  return slot.endsAt.getTime() - slot.startsAt.getTime() === slotMinutes * 60_000;
}

function scheduleAllowsSlot(schedule: FacilitySchedule, slot: BookingSlotRecord): boolean {
  const date = projectLocalDateString(slot.startsAt);
  if (schedule.holidays.includes(date)) return false;
  const lengthMinutes = Math.round((slot.endsAt.getTime() - slot.startsAt.getTime()) / 60_000);
  if (lengthMinutes <= 0) return false;
  const generated = generateSlotsForDate({ schedule, slotMinutes: lengthMinutes, date });
  return generated.some(
    (candidate) =>
      candidate.startsAt.getTime() === slot.startsAt.getTime() &&
      candidate.endsAt.getTime() === slot.endsAt.getTime(),
  );
}

function closureHitsSlot(closures: ClosureWindow[], slot: BookingSlotRecord): boolean {
  return closures.some(
    (closure) =>
      slot.startsAt.getTime() < closure.endsAt.getTime() &&
      closure.startsAt.getTime() < slot.endsAt.getTime(),
  );
}

async function closuresForSlots(
  conn: Db,
  facilityId: string,
  slots: BookingSlotRecord[],
): Promise<ClosureWindow[]> {
  if (slots.length === 0) return [];
  const ordered = [...slots].sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (first === undefined || last === undefined) return [];
  const closures = await listClosuresOverlapping(conn, facilityId, first.startsAt, last.endsAt);
  return closures.map((closure) => ({ startsAt: closure.startsAt, endsAt: closure.endsAt }));
}

function capacityOverlaps(
  slots: BookingSlotRecord[],
  candidate: BookingSlotRecord,
  capacity: number,
): boolean {
  const overlapping = slots.filter(
    (other) =>
      candidate.startsAt.getTime() < other.endsAt.getTime() &&
      other.startsAt.getTime() < candidate.endsAt.getTime(),
  ).length;
  return overlapping > capacity;
}

function conflictsForSlot(
  slot: BookingSlotRecord,
  all: BookingSlotRecord[],
  proposed: ProposedConfig,
  closures: ClosureWindow[],
): Array<'SCHEDULE' | 'SLOT_LENGTH' | 'CAPACITY' | 'CLOSURE'> {
  const conflicts: Array<'SCHEDULE' | 'SLOT_LENGTH' | 'CAPACITY' | 'CLOSURE'> = [];
  if (!scheduleAllowsSlot(proposed.schedule, slot)) conflicts.push('SCHEDULE');
  if (!slotLengthOk(slot, proposed.slotMinutes)) conflicts.push('SLOT_LENGTH');
  if (closureHitsSlot(closures, slot)) conflicts.push('CLOSURE');
  if (capacityOverlaps(all, slot, proposed.capacity)) conflicts.push('CAPACITY');
  return conflicts;
}

async function quotaImpactsFor(
  conn: Db,
  facilityId: string,
  slots: BookingSlotRecord[],
  proposed: ProposedConfig,
): Promise<QuotaImpactDto[]> {
  const rooms = [...new Set(slots.map((slot) => slot.roomId))];
  const impacts: QuotaImpactDto[] = [];
  for (const roomId of rooms) {
    const [roomSlots, credits] = await Promise.all([
      listQuotaConsumingSlots(conn, { roomId, facilityId }),
      listAdjustmentsForRoomFacility(conn, { roomId, facilityId }),
    ]);
    const periodKeys = new Set<string>();
    for (const slot of slots) {
      if (slot.roomId !== roomId) continue;
      periodKeys.add(toPeriodKey(slot.startsAt, proposed.quotaKind));
    }
    for (const periodKey of periodKeys) {
      const used = countQuotaUsed({
        slots: roomSlots.map((slot) => ({ id: slot.id, startsAt: slot.startsAt, state: slot.state })),
        credits: credits
          .filter((credit) => credit.periodKey === periodKey)
          .map((credit) => ({ bookingSlotId: credit.bookingSlotId, signedSlots: credit.signedSlots })),
        periodKey,
        kind: proposed.quotaKind,
      });
      if (used > proposed.quotaLimit) {
        impacts.push({
          roomId,
          periodKey,
          used,
          newLimit: proposed.quotaLimit,
          overBy: used - proposed.quotaLimit,
        });
      }
    }
  }
  return impacts.sort(
    (left, right) =>
      left.roomId.localeCompare(right.roomId) || left.periodKey.localeCompare(right.periodKey),
  );
}

export interface PreviewConfigInput {
  schedule: FacilitySchedule;
  slotMinutes: number;
  capacity: number;
  quotaKind: QuotaKind;
  quotaLimit: number;
  advanceDays: number;
  effectiveAt: Date;
}

async function structuralConflictsFor(
  conn: Db,
  facilityId: string,
  future: BookingSlotRecord[],
  proposed: ProposedConfig,
): Promise<ImpactSlotDto[]> {
  const closures = await closuresForSlots(conn, facilityId, future);
  const structural: ImpactSlotDto[] = [];
  for (const slot of future) {
    const conflicts = conflictsForSlot(slot, future, proposed, closures);
    if (conflicts.length > 0) {
      structural.push({
        id: slot.id,
        bookingId: slot.bookingId,
        roomId: slot.roomId,
        startsAt: slot.startsAt.toISOString(),
        endsAt: slot.endsAt.toISOString(),
        conflicts,
      });
    }
  }
  return structural;
}

export async function previewConfigChange(
  actor: Actor,
  facilityId: string,
  input: PreviewConfigInput,
  ctx: BookingCtx,
): Promise<ConfigPreviewDto> {
  requireAdmin(actor);
  assertValidSchedule(input.schedule);
  const now = ctx.clock.now();
  assertEffectiveAtAllowed(input.effectiveAt, now);
  const facility = await findFacilityById(db, facilityId);
  if (facility === null) throw new AppError('RESOURCE_NOT_FOUND');
  const current = await findEffectiveConfig(db, facilityId, now);
  if (current === null) {
    throw new AppError('VALIDATION_ERROR', 'The facility has no effective configuration.');
  }
  const proposed: ProposedConfig = {
    schedule: input.schedule,
    slotMinutes: input.slotMinutes,
    capacity: input.capacity,
    quotaKind: input.quotaKind,
    quotaLimit: input.quotaLimit,
    advanceDays: input.advanceDays,
  };
  const future = await listConfirmedFutureSlots(db, { facilityId, from: input.effectiveAt });
  const [structuralConflicts, quotaImpacts] = await Promise.all([
    structuralConflictsFor(db, facilityId, future, proposed),
    quotaImpactsFor(db, facilityId, future, proposed),
  ]);
  const fingerprint = previewFingerprint({
    configVersion: current.version,
    confirmedFutureSlotIds: future.map((slot) => slot.id),
  });
  const previewToken = encodePreviewToken({
    facilityId,
    configVersion: current.version,
    effectiveAt: input.effectiveAt.toISOString(),
    proposed,
    fingerprint,
  });
  return {
    facilityId,
    configVersion: current.version,
    effectiveAt: input.effectiveAt.toISOString(),
    proposed,
    quotaOnlyReduction: isQuotaOnlyReduction(
      {
        version: current.version,
        effectiveAt: current.effectiveAt,
        scheduleJson: current.scheduleJson,
        slotMinutes: current.slotMinutes,
        capacity: facility.capacity,
        quotaKind: current.quotaKind,
        quotaLimit: current.quotaLimit,
        advanceDays: current.advanceDays,
      },
      proposed,
    ),
    structuralConflicts,
    quotaImpacts,
    previewToken,
  };
}

export interface CommitConfigInput extends PreviewConfigInput {
  previewToken: string;
  idempotencyKey?: string | undefined;
}

async function committedDtoFor(
  conn: Db,
  facility: { id: string; capacity: number },
  committed: FacilityConfigRecord,
  current: FacilityConfigRecord,
): Promise<ConfigCommitDto> {
  const proposed: ProposedConfig = {
    schedule: committed.scheduleJson as FacilitySchedule,
    slotMinutes: committed.slotMinutes,
    capacity: facility.capacity,
    quotaKind: committed.quotaKind,
    quotaLimit: committed.quotaLimit,
    advanceDays: committed.advanceDays,
  };
  const future = await listConfirmedFutureSlots(conn, {
    facilityId: facility.id,
    from: committed.effectiveAt,
  });
  return {
    facilityId: facility.id,
    configId: committed.id,
    version: committed.version,
    effectiveAt: committed.effectiveAt.toISOString(),
    proposed,
    quotaOnlyReduction: isQuotaOnlyReduction(
      {
        version: current.version,
        effectiveAt: current.effectiveAt,
        scheduleJson: current.scheduleJson,
        slotMinutes: current.slotMinutes,
        capacity: facility.capacity,
        quotaKind: current.quotaKind,
        quotaLimit: current.quotaLimit,
        advanceDays: current.advanceDays,
      },
      proposed,
    ),
    quotaImpacts: await quotaImpactsFor(conn, facility.id, future, proposed),
  };
}

export async function commitConfigChange(
  actor: Actor,
  facilityId: string,
  input: CommitConfigInput,
  ctx: BookingCtx,
): Promise<ConfigCommitDto> {
  requireAdmin(actor);
  assertValidSchedule(input.schedule);
  const now = ctx.clock.now();
  assertEffectiveAtAllowed(input.effectiveAt, now);
  const token = decodePreviewToken(input.previewToken);
  if (token.facilityId !== facilityId) {
    throw new AppError('VALIDATION_ERROR', 'The preview token does not match the facility.');
  }
  const proposed: ProposedConfig = {
    schedule: input.schedule,
    slotMinutes: input.slotMinutes,
    capacity: input.capacity,
    quotaKind: input.quotaKind,
    quotaLimit: input.quotaLimit,
    advanceDays: input.advanceDays,
  };
  if (!proposedConfigsEqual(token.proposed, proposed)) {
    throw new AppError('CONFIG_IMPACT_CHANGED');
  }
  if (token.effectiveAt !== input.effectiveAt.toISOString()) {
    throw new AppError('CONFIG_IMPACT_CHANGED');
  }
  const requestHash = hashRequestBody({
    facilityId,
    effectiveAt: input.effectiveAt.toISOString(),
    proposed,
    previewToken: input.previewToken,
  });
  if (input.idempotencyKey !== undefined) {
    const existing = await getIdempotencyRecord(db, {
      scope: 'CONFIG_COMMIT',
      key: input.idempotencyKey,
    });
    if (existing !== null) {
      if (existing.requestHash !== requestHash) {
        throw new AppError('VALIDATION_ERROR', 'The Idempotency-Key was already used with a different request.');
      }
      if (existing.resultRefId !== null) {
        const committed = await findConfigById(db, existing.resultRefId);
        const facility = await findFacilityById(db, facilityId);
        const current = await findEffectiveConfig(db, facilityId, now);
        if (committed !== null && facility !== null && current !== null) {
          return committedDtoFor(db, facility, committed, current);
        }
      }
      throw new AppError('RATE_LIMITED');
    }
  }
  try {
    return await db.transaction(async (tx) => {
      const facility = await findFacilityById(tx, facilityId);
      if (facility === null) throw new AppError('RESOURCE_NOT_FOUND');
      const current = await findEffectiveConfig(tx, facilityId, now);
      if (current === null) {
        throw new AppError('VALIDATION_ERROR', 'The facility has no effective configuration.');
      }
      if (current.version !== token.configVersion) {
        throw new AppError('CONFIG_IMPACT_CHANGED');
      }
      const future = await listConfirmedFutureSlots(tx, { facilityId, from: input.effectiveAt });
      const fingerprint = previewFingerprint({
        configVersion: current.version,
        confirmedFutureSlotIds: future.map((slot) => slot.id),
      });
      if (fingerprint !== token.fingerprint) {
        throw new AppError('CONFIG_IMPACT_CHANGED');
      }
      const blocking = await structuralConflictsFor(tx, facilityId, future, proposed);
      if (blocking.length > 0) {
        throw new AppError(
          'VALIDATION_ERROR',
          'Resolve the conflicting future slots before committing the config.',
        );
      }
      const pending = await findPendingConfig(tx, facilityId);
      if (pending !== null) {
        throw new AppError('VERSION_CONFLICT');
      }
      const version = (await maxConfigVersion(tx, facilityId)) + 1;
      const created = await insertFacilityConfig(tx, {
        facilityId,
        version,
        effectiveAt: input.effectiveAt,
        isPending: input.effectiveAt.getTime() > now.getTime(),
        scheduleJson: proposed.schedule,
        slotMinutes: proposed.slotMinutes,
        quotaKind: proposed.quotaKind,
        quotaLimit: proposed.quotaLimit,
        advanceDays: proposed.advanceDays,
      });
      await writeAudit(tx, {
        actorId: actor.userId,
        action: 'facility.config.committed',
        resourceType: 'facility_config',
        resourceId: created.id,
        requestId: ctx.requestId,
        before: { version: current.version },
        after: {
          version: created.version,
          effectiveAt: created.effectiveAt.toISOString(),
          fingerprint,
        },
      });
      if (input.idempotencyKey !== undefined) {
        await upsertIdempotencyRecord(tx, {
          scope: 'CONFIG_COMMIT',
          key: input.idempotencyKey,
          actorId: actor.userId,
          requestHash,
          resultRefType: 'facility_config',
          resultRefId: created.id,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        });
      }
      return committedDtoFor(tx, facility, created, current);
    });
  } catch (error) {
    throw mapPgError(error, {
      constraintCodes: {
        facility_config_pending_puq: 'VERSION_CONFLICT',
        facility_config_version_uq: 'VERSION_CONFLICT',
      },
    });
  }
}
