'use client';

import { History } from 'lucide-react';
import type { TicketHistoryDto } from '@/modules/maintenance/application/index';
import {
  formatInstant,
  statusLabel,
} from '@/modules/maintenance/ui/ticketLabels';

export function TicketTimeline({
  history,
  testIdPrefix,
}: {
  history: TicketHistoryDto[];
  testIdPrefix: string;
}) {
  return (
    <section aria-label="Status history" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <History aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <h2 className="text-heading leading-heading font-semibold text-foreground">Status history</h2>
      </div>
      {history.length === 0 ? (
        <p data-testid={`${testIdPrefix}-history-empty`} className="text-small leading-small text-muted-foreground">
          No status changes yet.
        </p>
      ) : (
        <ol data-testid={`${testIdPrefix}-history`} className="flex min-w-0 flex-col">
          {history.map((entry) => (
            <li
              key={entry.id}
              data-testid={`${testIdPrefix}-history-${entry.id}`}
              className="relative flex min-w-0 flex-col gap-1 border-b border-border py-3 pl-5 text-body leading-body last:border-b-0"
            >
              <span aria-hidden="true" className="absolute left-1 top-4 size-2 rounded-full bg-border-strong" />
              <p className="break-words font-medium leading-6 text-foreground">
                {statusLabel(entry.fromState)} to {statusLabel(entry.toState)}
              </p>
              {entry.reason !== null && entry.reason !== '' ? (
                <p className="break-words leading-6 text-foreground">{entry.reason}</p>
              ) : null}
              <p className="break-all text-xs leading-6 text-muted-foreground">{formatInstant(entry.changedAt)}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
