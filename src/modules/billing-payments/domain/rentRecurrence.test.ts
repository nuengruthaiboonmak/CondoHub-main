import { describe, expect, it } from 'vitest';
import {
  decideRentCycle,
  managementModeAt,
  rentKindFor,
  selectOverlappingTenancies,
  tenancyOverlapsCycle,
  type TenancyOverlapInput,
} from './rentRecurrence';

const CYCLE_START = new Date('2026-10-01T00:00:00.000Z');
const CYCLE_END = new Date('2026-11-01T00:00:00.000Z');

function tenancy(overrides: Partial<TenancyOverlapInput> & { id: string }): TenancyOverlapInput {
  return {
    startsAt: new Date('2026-09-01T00:00:00.000Z'),
    endsAt: null,
    managementMode: 'PRIVATE_OWNER_MANAGED',
    ...overrides,
  };
}

describe('UT-BL-01 full-month rent on any overlap', () => {
  it('issues for a tenancy overlapping the whole cycle', () => {
    const input = tenancy({ id: 't1' });
    expect(tenancyOverlapsCycle(input, CYCLE_START, CYCLE_END)).toBe(true);
    expect(decideRentCycle([input], CYCLE_START, CYCLE_END)).toEqual({
      outcome: 'ISSUE',
      tenancy: input,
    });
  });

  it('issues when the overlap is a single instant at the cycle start', () => {
    const input = tenancy({
      id: 't-edge-start',
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
      endsAt: new Date('2026-10-01T00:00:00.001Z'),
    });
    expect(tenancyOverlapsCycle(input, CYCLE_START, CYCLE_END)).toBe(true);
    expect(decideRentCycle([input], CYCLE_START, CYCLE_END)).toEqual({
      outcome: 'ISSUE',
      tenancy: input,
    });
  });

  it('issues when the tenancy starts one instant before the cycle end', () => {
    const input = tenancy({
      id: 't-edge-end',
      startsAt: new Date('2026-10-31T23:59:59.999Z'),
      endsAt: null,
    });
    expect(tenancyOverlapsCycle(input, CYCLE_START, CYCLE_END)).toBe(true);
    expect(decideRentCycle([input], CYCLE_START, CYCLE_END)).toEqual({
      outcome: 'ISSUE',
      tenancy: input,
    });
  });

  it('treats an ending exactly at the cycle start as no overlap', () => {
    const input = tenancy({
      id: 't-touch-start',
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
      endsAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    expect(tenancyOverlapsCycle(input, CYCLE_START, CYCLE_END)).toBe(false);
    expect(decideRentCycle([input], CYCLE_START, CYCLE_END)).toEqual({ outcome: 'VACANT' });
  });

  it('treats a start exactly at the cycle end as no overlap', () => {
    const input = tenancy({
      id: 't-touch-end',
      startsAt: new Date('2026-11-01T00:00:00.000Z'),
      endsAt: null,
    });
    expect(tenancyOverlapsCycle(input, CYCLE_START, CYCLE_END)).toBe(false);
    expect(decideRentCycle([input], CYCLE_START, CYCLE_END)).toEqual({ outcome: 'VACANT' });
  });

  it('returns vacant when no tenancy overlaps the month', () => {
    const before = tenancy({
      id: 't-before',
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      endsAt: new Date('2026-09-01T00:00:00.000Z'),
    });
    const after = tenancy({
      id: 't-after',
      startsAt: new Date('2026-11-01T00:00:00.000Z'),
      endsAt: null,
    });
    expect(selectOverlappingTenancies([before, after], CYCLE_START, CYCLE_END)).toEqual([]);
    expect(decideRentCycle([before, after], CYCLE_START, CYCLE_END)).toEqual({ outcome: 'VACANT' });
    expect(decideRentCycle([], CYCLE_START, CYCLE_END)).toEqual({ outcome: 'VACANT' });
  });

  it('creates a turnover review when sequential tenancies share the month', () => {
    const first = tenancy({
      id: 't-first',
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
      endsAt: new Date('2026-10-15T00:00:00.000Z'),
    });
    const second = tenancy({
      id: 't-second',
      startsAt: new Date('2026-10-15T00:00:00.000Z'),
      endsAt: null,
    });
    expect(decideRentCycle([first, second], CYCLE_START, CYCLE_END)).toEqual({
      outcome: 'TURNOVER_REVIEW',
      tenancies: [first, second],
    });
  });

  it('maps management mode to the frozen rent kind', () => {
    expect(rentKindFor('PRIVATE_OWNER_MANAGED')).toBe('PRIVATE_RENT');
    expect(rentKindFor('PROJECT_MANAGED')).toBe('PROJECT_MANAGED_RENT');
  });

  it('resolves the room mode from the tenancy covering the boundary instant', () => {
    const at = new Date('2026-10-01T00:00:00.000Z');
    const covering = tenancy({
      id: 't-covering',
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
      endsAt: null,
      managementMode: 'PROJECT_MANAGED',
    });
    expect(managementModeAt([covering], at)).toBe('PROJECT_MANAGED');
    const ended = tenancy({
      id: 't-ended',
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      endsAt: new Date('2026-10-01T00:00:00.000Z'),
      managementMode: 'PROJECT_MANAGED',
    });
    expect(managementModeAt([ended], at)).toBeNull();
    const future = tenancy({
      id: 't-future',
      startsAt: new Date('2026-10-01T00:00:01.000Z'),
      endsAt: null,
      managementMode: 'PROJECT_MANAGED',
    });
    expect(managementModeAt([future], at)).toBeNull();
    expect(managementModeAt([], at)).toBeNull();
  });
});
