export const PROJECT_TIMEZONE = 'Asia/Bangkok';

export function projectToday(timeZone: string = PROJECT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function addDaysProjectDate(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('The project date must look like YYYY-MM-DD.');
  }
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

export function nextMondayProjectDate(from = projectToday()): string {
  const [year, month, day] = from.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error('The project date must look like YYYY-MM-DD.');
  }
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const delta = (8 - weekday) % 7 || 7;
  return addDaysProjectDate(from, delta);
}

export function nextMonthFirstDay(from = projectToday()): string {
  const [year, month] = from.split('-').map(Number);
  if (year === undefined || month === undefined) {
    throw new Error('The project date must look like YYYY-MM-DD.');
  }
  const next = new Date(Date.UTC(year, month, 1));
  return next.toISOString().slice(0, 10);
}
