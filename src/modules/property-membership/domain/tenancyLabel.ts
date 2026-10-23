import { formatProjectDate, projectDateParts } from '@/shared/utils/clock';

export function formatTenancyPeriod(period: {
  startsAt: Date;
  endsAt: Date | null;
  state?: string;
}): string {
  const start = formatProjectDate(projectDateParts(period.startsAt));
  const end = period.endsAt ? formatProjectDate(projectDateParts(period.endsAt)) : 'present';
  if (period.state === 'CANCELLED')
    return `${start}${period.endsAt ? ` to ${end}` : ''} (cancelled)`;
  return `${start} to ${end}`;
}
