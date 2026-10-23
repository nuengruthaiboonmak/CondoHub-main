import 'server-only';
import { redirect } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import { getProjectPaymentSettings } from '@/modules/billing-payments/application/index';
import { PaymentSettingsForm } from '@/modules/billing-payments/ui/PaymentSettingsForm';
import { BillingSectionNav } from '@/modules/billing-payments/ui/BillingSectionNav';
import { PageHeader, SectionCard } from '@/shared/ui';

export default async function PaymentSettingsPage() {
  const actor = await getActorFromSession();
  if (!actor) redirect('/login');
  if (!actor.isSystemAdmin) redirect('/rooms');
  if (actor.mustChangePassword) redirect('/change-password');
  const settings = await getProjectPaymentSettings(actor, systemClock.now());
  return (
    <main
      data-testid="payment-settings-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title="Payment settings"
        description="One receiving account for common fees and project-managed rent across all rooms."
      />
      <BillingSectionNav current="settings" counts={{}} />
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <SectionCard
          title="Project receiving account"
          description="Residents see this bank account and QR code on new project invoices."
        >
          <PaymentSettingsForm
            key={settings?.id ?? 'project'}
            payeeType="PROJECT"
            value={settings}
          />
        </SectionCard>
        <SectionCard title="Private rent" description="Managed by each room owner">
          <p className="text-body leading-relaxed text-body-secondary">
            Owners can set their own receiving account from their room's Payment details. Private
            rent uses that account separately from the project account.
          </p>
        </SectionCard>
      </div>
    </main>
  );
}
