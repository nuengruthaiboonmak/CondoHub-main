import { describe, expect, it } from 'vitest';
import type { FacilitySchedule } from '../domain/schedule';
import { openingHourGroups } from './openingHourGroups';

const hours = {
  open: [{ start: '08:00', end: '20:00' }],
  breaks: [{ start: '12:00', end: '13:00' }],
};
const schedule: FacilitySchedule = {
  days: {
    '0': { open: [], breaks: [] },
    '1': hours,
    '2': hours,
    '3': hours,
    '4': hours,
    '5': hours,
    '6': hours,
  },
  holidays: [],
};

describe('openingHourGroups', () => {
  it('groups consecutive days with the same opening hours and breaks', () => {
    expect(openingHourGroups(schedule)).toEqual([
      { label: 'Mon–Sat', hours },
      { label: 'Sun', hours: { open: [], breaks: [] } },
    ]);
  });
  it('keeps days with different breaks separate', () => {
    const result = openingHourGroups({
      ...schedule,
      days: { ...schedule.days, '3': { ...hours, breaks: [] } },
    });
    expect(result.map((group) => group.label)).toEqual(['Mon–Tue', 'Wed', 'Thu–Sat', 'Sun']);
  });
  it('keeps nonconsecutive matching days separate', () => {
    const result = openingHourGroups({
      ...schedule,
      days: { ...schedule.days, '4': { open: [], breaks: [] } },
    });
    expect(result.map((group) => group.label)).toEqual(['Mon–Wed', 'Thu', 'Fri–Sat', 'Sun']);
  });
});
