import 'server-only';
import { redirect } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import { PageHeader, SectionCard } from '@/shared/ui';
import { ChargeEventCreateForm } from '@/modules/billing-payments/ui/ChargeEventCreateForm';

export const dynamic = 'force-dynamic';

export default async function AdminBillingEventNewPage() {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/admin/billing/events/new');
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  return (
    <main
      data-testid="charge-event-new-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="New one-time event"
        description="The effective date is required. The billing job issues invoices from open events."
        backHref="/admin/billing/events"
        backLabel="Back to billing events"
        backTestId="charge-event-new-back"
      />
      <SectionCard title="Charge details" className="max-w-2xl">
        <ChargeEventCreateForm />
      </SectionCard>
    </main>
  );
}
