import type { FacilitySchedule } from '../domain/schedule';
import { openingHourGroups } from './openingHourGroups';

export function OpeningHours({ schedule }: { schedule: FacilitySchedule }) {
  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col gap-4 text-small">
        {openingHourGroups(schedule).map(({ label, hours }) => (
          <div key={label} className="flex items-start justify-between gap-4">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium">
              {hours.open.length === 0
                ? 'Closed'
                : hours.open.map((range) => `${range.start}–${range.end}`).join(', ')}
              {hours.breaks.length > 0 ? (
                <span className="mt-1 block font-normal text-muted-foreground">
                  Break {hours.breaks.map((range) => `${range.start}–${range.end}`).join(', ')}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      {schedule.holidays.length > 0 ? (
        <div className="border-t border-border pt-4 text-small">
          <p className="font-medium">Closed dates</p>
          <p className="mt-1 break-words text-muted-foreground">{schedule.holidays.join(', ')}</p>
        </div>
      ) : null}
    </div>
  );
}
