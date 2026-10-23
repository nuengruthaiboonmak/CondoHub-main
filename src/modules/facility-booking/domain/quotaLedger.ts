import { AppError } from '@/shared/utils/errors';
import { toPeriodKey, type QuotaKind } from '@/shared/utils/clock';

export type QuotaConsumingSlotState = 'CONFIRMED' | 'RESIDENT_CANCELLED' | 'ADMIN_CANCELLED';

export interface QuotaLedgerSlot {
  id: string;
  startsAt: Date;
  state: QuotaConsumingSlotState;
}

export interface QuotaLedgerCredit {
  bookingSlotId: string;
  signedSlots: number;
}

export interface QuotaUsageInput {
  slots: QuotaLedgerSlot[];
  credits: QuotaLedgerCredit[];
  periodKey: string;
  kind: QuotaKind;
  timeZone?: string | undefined;
}

export function slotPeriodKey(startsAt: Date, kind: QuotaKind, timeZone?: string): string {
  return toPeriodKey(startsAt, kind, timeZone);
}

export function countQuotaUsed(input: QuotaUsageInput): number {
  const counted = new Set<string>();
  let consumed = 0;
  for (const slot of input.slots) {
    if (slotPeriodKey(slot.startsAt, input.kind, input.timeZone) !== input.periodKey) continue;
    if (counted.has(slot.id)) continue;
    counted.add(slot.id);
    consumed += 1;
  }
  const credited = new Set<string>();
  let refunded = 0;
  for (const credit of input.credits) {
    if (!counted.has(credit.bookingSlotId)) continue;
    if (credited.has(credit.bookingSlotId)) continue;
    credited.add(credit.bookingSlotId);
    refunded += credit.signedSlots;
  }
  const used = consumed - refunded;
  if (used < 0) {
    throw new AppError('INTERNAL_ERROR', 'The quota ledger is inconsistent.');
  }
  return used;
}

export interface QuotaGateInput extends QuotaUsageInput {
  limit: number;
  requestedSlots: number;
}

export function assertQuotaAllows(input: QuotaGateInput): number {
  if (!Number.isInteger(input.limit) || input.limit < 0) {
    throw new AppError('VALIDATION_ERROR', 'The quota limit must be a non-negative integer.');
  }
  if (!Number.isInteger(input.requestedSlots) || input.requestedSlots <= 0) {
    throw new AppError('VALIDATION_ERROR', 'The requested slot count is invalid.');
  }
  const used = countQuotaUsed(input);
  if (used + input.requestedSlots > input.limit) {
    throw new AppError('BOOKING_QUOTA_EXCEEDED');
  }
  return used;
}

export function groupSlotsByPeriod(
  starts: Date[],
  kind: QuotaKind,
  timeZone?: string,
): Map<string, number> {
  const grouped = new Map<string, number>();
  for (const startsAt of starts) {
    const key = slotPeriodKey(startsAt, kind, timeZone);
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  return grouped;
}
