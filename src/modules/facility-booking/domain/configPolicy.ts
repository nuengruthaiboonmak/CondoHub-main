import { AppError } from '@/shared/utils/errors';
import type { QuotaKind } from '@/shared/utils/clock';
import { assertValidSchedule, type FacilitySchedule } from './schedule';

export interface ConfigSnapshot {
  version: number;
  effectiveAt: Date;
  scheduleJson: unknown;
  slotMinutes: number;
  capacity: number;
  quotaKind: QuotaKind;
  quotaLimit: number;
  advanceDays: number;
}

export interface ProposedConfig {
  schedule: FacilitySchedule;
  slotMinutes: number;
  capacity: number;
  quotaKind: QuotaKind;
  quotaLimit: number;
  advanceDays: number;
}

export function assertValidProposedConfig(value: unknown): asserts value is ProposedConfig {
  if (typeof value !== 'object' || value === null) {
    throw new AppError('VALIDATION_ERROR', 'The proposed config is invalid.');
  }
  const record = value as Record<string, unknown>;
  assertValidSchedule(record.schedule);
  if (!Number.isInteger(record.slotMinutes) || (record.slotMinutes as number) <= 0) {
    throw new AppError('VALIDATION_ERROR', 'The slot length must be a positive integer.');
  }
  if (!Number.isInteger(record.capacity) || (record.capacity as number) <= 0) {
    throw new AppError('VALIDATION_ERROR', 'The capacity must be a positive integer.');
  }
  if (
    record.quotaKind !== 'DAILY' &&
    record.quotaKind !== 'WEEKLY' &&
    record.quotaKind !== 'MONTHLY'
  ) {
    throw new AppError('VALIDATION_ERROR', 'The quota kind is invalid.');
  }
  if (!Number.isInteger(record.quotaLimit) || (record.quotaLimit as number) < 0) {
    throw new AppError('VALIDATION_ERROR', 'The quota limit must be a non-negative integer.');
  }
  if (!Number.isInteger(record.advanceDays) || (record.advanceDays as number) < 0) {
    throw new AppError('VALIDATION_ERROR', 'The advance window must be a non-negative integer.');
  }
}

export interface ConfigDiff {
  scheduleChanged: boolean;
  slotMinutesChanged: boolean;
  capacityChanged: boolean;
  quotaKindChanged: boolean;
  quotaLimitChanged: boolean;
  advanceDaysChanged: boolean;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function proposedConfigsEqual(left: ProposedConfig, right: ProposedConfig): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function diffConfig(current: ConfigSnapshot, proposed: ProposedConfig): ConfigDiff {
  return {
    scheduleChanged:
      canonicalJson(current.scheduleJson) !== canonicalJson(proposed.schedule),
    slotMinutesChanged: current.slotMinutes !== proposed.slotMinutes,
    capacityChanged: current.capacity !== proposed.capacity,
    quotaKindChanged: current.quotaKind !== proposed.quotaKind,
    quotaLimitChanged: current.quotaLimit !== proposed.quotaLimit,
    advanceDaysChanged: current.advanceDays !== proposed.advanceDays,
  };
}

export function isQuotaOnlyReduction(current: ConfigSnapshot, proposed: ProposedConfig): boolean {
  const diff = diffConfig(current, proposed);
  if (
    diff.scheduleChanged ||
    diff.slotMinutesChanged ||
    diff.capacityChanged ||
    diff.quotaKindChanged ||
    diff.advanceDaysChanged
  ) {
    return false;
  }
  return diff.quotaLimitChanged && proposed.quotaLimit < current.quotaLimit;
}

export function assertEffectiveAtAllowed(effectiveAt: Date, now: Date): void {
  if (!(effectiveAt instanceof Date) || Number.isNaN(effectiveAt.getTime())) {
    throw new AppError('VALIDATION_ERROR', 'The effective time is invalid.');
  }
  if (effectiveAt.getTime() < now.getTime()) {
    throw new AppError('VALIDATION_ERROR', 'The effective time must not be in the past.');
  }
}

export function previewFingerprint(input: {
  configVersion: number;
  confirmedFutureSlotIds: string[];
}): string {
  return `${input.configVersion}:${[...input.confirmedFutureSlotIds].sort().join(',')}`;
}

export function assertPreviewFresh(expected: string, actual: string): void {
  if (expected !== actual) {
    throw new AppError('CONFIG_IMPACT_CHANGED');
  }
}
