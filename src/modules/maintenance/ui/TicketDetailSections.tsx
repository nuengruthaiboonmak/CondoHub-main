'use client';

import { FormDialog, SectionCard } from '@/shared/ui';
import { useRouter } from 'next/navigation';
import type { TicketDto } from '@/modules/maintenance/application/index';
import { TicketDetailCard } from '@/modules/maintenance/ui/TicketDetailCard';
import { TicketTimeline } from '@/modules/maintenance/ui/TicketTimeline';
import { TicketComments } from '@/modules/maintenance/ui/TicketComments';
import { TicketCommentForm } from '@/modules/maintenance/ui/TicketCommentForm';
import {
  TicketTransitionForm,
  type TicketTransitionAction,
} from '@/modules/maintenance/ui/TicketTransitionForm';
import { isTerminalTicketStatus } from '@/modules/maintenance/ui/ticketLabels';

export function TicketDetailSections({
  ticket,
  roomLabel,
  testIdPrefix,
  transitionMode,
  showRoutingKind = true,
}: {
  ticket: TicketDto;
  roomLabel: string | null;
  testIdPrefix: string;
  transitionMode: TicketTransitionAction | 'none';
  showRoutingKind?: boolean;
}) {
  const router = useRouter();
  const refresh = (): void => router.refresh();
  const terminal = isTerminalTicketStatus(ticket.status);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <TicketDetailCard
        ticket={ticket}
        roomLabel={roomLabel}
        testIdPrefix={testIdPrefix}
        showRoutingKind={showRoutingKind}
        action={
          !terminal && transitionMode !== 'none' ? (
            <FormDialog
              triggerLabel={
                transitionMode === 'reporter-cancel' ? 'Cancel request' : 'Update status'
              }
              title={
                transitionMode === 'reporter-cancel'
                  ? 'Cancel this request?'
                  : 'Update request status'
              }
              description={
                transitionMode === 'reporter-cancel'
                  ? 'This request will move to your history.'
                  : 'Keep everyone informed of the latest progress.'
              }
              triggerTestId={`${testIdPrefix}-transition-open`}
              testId={`${testIdPrefix}-transition-dialog`}
              variant="secondary"
              icon="edit"
            >
              <TicketTransitionForm
                ticketId={ticket.id}
                currentStatus={ticket.status}
                expectedVersion={ticket.version}
                mode={transitionMode}
                testIdPrefix={testIdPrefix}
                onTransitioned={refresh}
              />
            </FormDialog>
          ) : null
        }
      />
      {!terminal && transitionMode === 'none' ? (
        <p
          data-testid={`${testIdPrefix}-transition-unavailable`}
          className="text-small text-muted-foreground"
        >
          Status changes are handled by the room owners or the management team.
        </p>
      ) : null}
      <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <SectionCard title="Discussion" description="Updates and conversations about this request.">
          <TicketComments comments={ticket.comments} testIdPrefix={testIdPrefix} />
          {!terminal ? (
            <div className="mt-5 border-t border-border pt-5">
              <TicketCommentForm
                ticketId={ticket.id}
                testIdPrefix={testIdPrefix}
                onCommented={refresh}
              />
            </div>
          ) : null}
        </SectionCard>
        <aside className="min-w-0 rounded-xl border border-border bg-surface p-5">
          <TicketTimeline history={ticket.history} testIdPrefix={testIdPrefix} />
        </aside>
      </div>
    </div>
  );
}
