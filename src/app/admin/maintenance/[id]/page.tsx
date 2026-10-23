import 'server-only';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { EmptyState } from '@/shared/ui';
import { isUuid } from '@/shared/utils/idempotency';
import { getTicket } from '@/modules/maintenance/application/index';
import { TicketDetailSections } from '@/modules/maintenance/ui/TicketDetailSections';
import { isTerminalTicketStatus } from '@/modules/maintenance/ui/ticketLabels';
import { getRoomLabels } from '@/modules/property-membership/application/index';

export const dynamic = 'force-dynamic';

export default async function AdminMaintenanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/admin/maintenance');
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  const { id } = await params;
  if (!isUuid(id)) redirect('/admin/maintenance');
  const ticket = await getTicket(actor, id);
  if (ticket === null) {
    return (
      <main
        data-testid="admin-maintenance-detail-page"
        className="mx-auto w-full max-w-[var(--ui-content-wide)] p-4 sm:p-6"
      >
        <EmptyState
          data-testid="admin-maintenance-detail-missing"
          title="Request not available"
          description="This request does not exist or is not routed to the management team."
          action={
            <Link
              data-testid="admin-maintenance-detail-back"
              href="/admin/maintenance"
              className="inline-flex items-center gap-1 text-body leading-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to inbox
            </Link>
          }
        />
      </main>
    );
  }
  const roomLabel = ticket.roomId
    ? ((await getRoomLabels([ticket.roomId]))[0]?.label ?? 'Room unavailable')
    : null;
  return (
    <main
      data-testid="admin-maintenance-detail-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <Link
        data-testid="admin-maintenance-detail-back"
        href="/admin/maintenance"
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-body leading-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to inbox
      </Link>
      <TicketDetailSections
        ticket={ticket}
        roomLabel={roomLabel}
        testIdPrefix="admin-maintenance-detail"
        transitionMode={isTerminalTicketStatus(ticket.status) ? 'none' : 'handler'}
      />
    </main>
  );
}
