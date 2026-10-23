import 'server-only';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { FormDialog } from '@/shared/ui';
import {
  getCommonFeeEvent,
  getEventIssuanceRooms,
} from '@/modules/billing-payments/application/index';
import { systemClock } from '@/shared/utils/clock';
import { isUuid } from '@/shared/utils/idempotency';
import { ChargeEventCreateForm } from '@/modules/billing-payments/ui/ChargeEventCreateForm';
import { ChargeEventDetailCard } from '@/modules/billing-payments/ui/ChargeEventDetailCard';

export const dynamic = 'force-dynamic';

export default async function AdminBillingEventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/admin/billing/events');
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  const { id } = await params;
  if (!isUuid(id)) redirect('/admin/billing/events');
  const detail = await getCommonFeeEvent(actor, id);
  if (detail === null) redirect('/admin/billing/events');
  const rooms = await getEventIssuanceRooms(actor, systemClock.now());
  return (
    <main
      data-testid="charge-event-detail-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <Link
          data-testid="charge-event-detail-back"
          href="/admin/billing/events"
          className="inline-flex w-fit items-center gap-1.5 rounded-md text-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to billing events
        </Link>
        <FormDialog
          triggerLabel="New billing event"
          title="New one-time event"
          triggerTestId="charge-event-detail-new"
          testId="charge-event-create-dialog"
        >
          <ChargeEventCreateForm />
        </FormDialog>
      </div>
      <ChargeEventDetailCard event={detail} rooms={rooms} />
    </main>
  );
}
