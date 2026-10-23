import { AppError } from '@/shared/utils/errors';
import { offsetMsAt, projectDateParts, projectWeekday } from '@/shared/utils/clock';

export interface OpeningInterval {
  start: string;
  end: string;
}

export interface DaySchedule {
  open: OpeningInterval[];
  breaks: OpeningInterval[];
}

export type WeekdayKey = '0' | '1' | '2' | '3' | '4' | '5' | '6';

export interface FacilitySchedule {
  days: Record<WeekdayKey, DaySchedule>;
  holidays: string[];
}

export interface GeneratedSlot {
  startsAt: Date;
  endsAt: Date;
}

export interface ClosureWindow {
  startsAt: Date;
  endsAt: Date;
}

export interface EffectiveConfigLike {
  effectiveAt: Date;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MINUTES_PER_DAY = 1440;

export function isCalendarDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day
  );
}

export function parseProjectDate(value: string): { year: number; month: number; day: number } {
  if (!isCalendarDateString(value)) {
    throw new AppError('VALIDATION_ERROR', 'The date must use YYYY-MM-DD format.');
  }
  const [yearText, monthText, dayText] = value.split('-') as [string, string, string];
  return { year: Number(yearText), month: Number(monthText), day: Number(dayText) };
}

function parseTimeToMinutes(value: unknown, field: string, allowEndOfDay: boolean): number {
  if (typeof value !== 'string') {
    throw new AppError('VALIDATION_ERROR', `The ${field} must use HH:MM format.`);
  }
  if (allowEndOfDay && value === '24:00') return MINUTES_PER_DAY;
  if (!TIME_PATTERN.test(value)) {
    throw new AppError('VALIDATION_ERROR', `The ${field} must use HH:MM format.`);
  }
  const [hourText, minuteText] = value.split(':') as [string, string];
  return Number(hourText) * 60 + Number(minuteText);
}

function assertIntervalShape(
  value: unknown,
  field: string,
): { startMin: number; endMin: number } {
  if (typeof value !== 'object' || value === null) {
    throw new AppError('VALIDATION_ERROR', `The ${field} interval is invalid.`);
  }
  const record = value as Record<string, unknown>;
  const startMin = parseTimeToMinutes(record.start, `${field} start`, false);
  const endMin = parseTimeToMinutes(record.end, `${field} end`, true);
  if (endMin <= startMin) {
    throw new AppError('VALIDATION_ERROR', `The ${field} end must be after its start.`);
  }
  return { startMin, endMin };
}

function assertNoInternalOverlap(
  intervals: Array<{ startMin: number; endMin: number }>,
  field: string,
): void {
  const ordered = [...intervals].sort((left, right) => left.startMin - right.startMin);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous !== undefined && current !== undefined && current.startMin < previous.endMin) {
      throw new AppError('VALIDATION_ERROR', `The ${field} intervals must not overlap.`);
    }
  }
}

export function assertValidSchedule(value: unknown): asserts value is FacilitySchedule {
  if (typeof value !== 'object' || value === null) {
    throw new AppError('VALIDATION_ERROR', 'The schedule is invalid.');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.days !== 'object' || record.days === null) {
    throw new AppError('VALIDATION_ERROR', 'The schedule days are invalid.');
  }
  const days = record.days as Record<string, unknown>;
  const keys: WeekdayKey[] = ['0', '1', '2', '3', '4', '5', '6'];
  for (const key of keys) {
    const day = days[key];
    if (typeof day !== 'object' || day === null) {
      throw new AppError('VALIDATION_ERROR', `The schedule for day ${key} is invalid.`);
    }
    const dayRecord = day as Record<string, unknown>;
    if (!Array.isArray(dayRecord.open) || !Array.isArray(dayRecord.breaks)) {
      throw new AppError('VALIDATION_ERROR', `The schedule for day ${key} is invalid.`);
    }
    const open = dayRecord.open.map((interval, index) =>
      assertIntervalShape(interval, `day ${key} opening ${index + 1}`),
    );
    const breaks = dayRecord.breaks.map((interval, index) =>
      assertIntervalShape(interval, `day ${key} break ${index + 1}`),
    );
    assertNoInternalOverlap(open, `day ${key} opening`);
    assertNoInternalOverlap(breaks, `day ${key} break`);
    for (const pause of breaks) {
      const inside = open.some(
        (window) => pause.startMin >= window.startMin && pause.endMin <= window.endMin,
      );
      if (!inside) {
        throw new AppError(
          'VALIDATION_ERROR',
          `The day ${key} break must sit inside an opening interval.`,
        );
      }
    }
  }
  if (!Array.isArray(record.holidays)) {
    throw new AppError('VALIDATION_ERROR', 'The schedule holidays are invalid.');
  }
  for (const holiday of record.holidays) {
    if (!isCalendarDateString(holiday)) {
      throw new AppError('VALIDATION_ERROR', 'The schedule holidays must use YYYY-MM-DD format.');
    }
  }
}

export function zonedTimeToUtc(date: string, minutes: number, timeZone?: string): Date {
  const { year, month, day } = parseProjectDate(date);
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > MINUTES_PER_DAY) {
    throw new AppError('VALIDATION_ERROR', 'The time of day is out of range.');
  }
  const midnightUtc = Date.UTC(year, month - 1, day) + minutes * 60_000;
  const firstPass = midnightUtc - offsetMsAt(midnightUtc + 43_200_000, timeZone);
  const secondPass = midnightUtc - offsetMsAt(firstPass, timeZone);
  return new Date(secondPass);
}

export function projectLocalMinutes(at: Date, timeZone?: string): number {
  const offset = offsetMsAt(at.getTime(), timeZone);
  const shifted = new Date(at.getTime() + offset);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export function projectLocalDateString(at: Date, timeZone?: string): string {
  const parts = projectDateParts(at, timeZone);
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

export function shiftProjectDate(date: string, deltaDays: number): string {
  const { year, month, day } = parseProjectDate(date);
  if (!Number.isInteger(deltaDays)) {
    throw new AppError('VALIDATION_ERROR', 'The day shift must be an integer.');
  }
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${shiftedMonth}-${shiftedDay}`;
}

function overlapsBreak(
  breaks: Array<{ startMin: number; endMin: number }>,
  startMin: number,
  endMin: number,
): boolean {
  return breaks.some((pause) => startMin < pause.endMin && pause.startMin < endMin);
}

function overlapsClosure(closures: ClosureWindow[], startsAt: Date, endsAt: Date): boolean {
  return closures.some(
    (closure) => startsAt.getTime() < closure.endsAt.getTime() && closure.startsAt.getTime() < endsAt.getTime(),
  );
}

export interface SlotGenerationInput {
  schedule: FacilitySchedule;
  slotMinutes: number;
  date: string;
  closures?: ClosureWindow[] | undefined;
  timeZone?: string | undefined;
}

export function generateSlotsForDate(input: SlotGenerationInput): GeneratedSlot[] {
  assertValidSchedule(input.schedule);
  if (!Number.isInteger(input.slotMinutes) || input.slotMinutes <= 0) {
    throw new AppError('VALIDATION_ERROR', 'The slot length must be a positive integer.');
  }
  const { year, month, day } = parseProjectDate(input.date);
  if (input.schedule.holidays.includes(input.date)) return [];
  const weekday = String(new Date(Date.UTC(year, month - 1, day)).getUTCDay()) as WeekdayKey;
  const daySchedule = input.schedule.days[weekday];
  const breaks = daySchedule.breaks.map((pause) => ({
    startMin: parseTimeToMinutes(pause.start, 'break start', false),
    endMin: parseTimeToMinutes(pause.end, 'break end', true),
  }));
  const closures = input.closures ?? [];
  const slots: GeneratedSlot[] = [];
  for (const window of daySchedule.open) {
    const windowStart = parseTimeToMinutes(window.start, 'opening start', false);
    const windowEnd = parseTimeToMinutes(window.end, 'opening end', true);
    for (
      let cursor = windowStart;
      cursor + input.slotMinutes <= windowEnd;
      cursor += input.slotMinutes
    ) {
      const slotEnd = cursor + input.slotMinutes;
      if (overlapsBreak(breaks, cursor, slotEnd)) continue;
      const startsAt = zonedTimeToUtc(input.date, cursor, input.timeZone);
      const endsAt = zonedTimeToUtc(input.date, slotEnd, input.timeZone);
      if (overlapsClosure(closures, startsAt, endsAt)) continue;
      slots.push({ startsAt, endsAt });
    }
  }
  return slots.sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
}

export function selectEffectiveConfig<T extends EffectiveConfigLike>(
  configs: T[],
  at: Date,
): T | null {
  let selected: T | null = null;
  for (const config of configs) {
    if (config.effectiveAt.getTime() > at.getTime()) continue;
    if (selected === null || config.effectiveAt.getTime() > selected.effectiveAt.getTime()) {
      selected = config;
    }
  }
  return selected;
}

export function resolveSlotCapacity(value: number | null | undefined): number {
  if (value === null || value === undefined) return 1;
  if (!Number.isInteger(value) || value <= 0) {
    throw new AppError('VALIDATION_ERROR', 'The facility capacity must be a positive integer.');
  }
  return value;
}

export function projectWeekdayOf(at: Date, timeZone?: string): number {
  return projectWeekday(at, timeZone);
}
