import type { DaySchedule, FacilitySchedule, WeekdayKey } from '../domain/schedule';

const WEEK = [
  ['1', 'Mon'],
  ['2', 'Tue'],
  ['3', 'Wed'],
  ['4', 'Thu'],
  ['5', 'Fri'],
  ['6', 'Sat'],
  ['0', 'Sun'],
] as const;

export function openingHourGroups(
  schedule: FacilitySchedule,
): Array<{ label: string; hours: DaySchedule }> {
  const groups: Array<{ first: string; last: string; key: string; hours: DaySchedule }> = [];
  for (const [day, label] of WEEK) {
    const hours = schedule.days[day as WeekdayKey];
    const key = JSON.stringify(hours);
    const previous = groups.at(-1);
    if (previous?.key === key) previous.last = label;
    else groups.push({ first: label, last: label, key, hours });
  }
  return groups.map((group) => ({
    label: group.first === group.last ? group.first : `${group.first}–${group.last}`,
    hours: group.hours,
  }));
}
