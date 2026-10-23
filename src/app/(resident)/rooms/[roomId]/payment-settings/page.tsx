import 'server-only';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import { AppError } from '@/shared/utils/errors';
import { getRoomLabels } from '@/modules/property-membership/application/index';
import { getRoomPaymentSettings } from '@/modules/billing-payments/application/index';
import { PaymentSettingsForm } from '@/modules/billing-payments/ui/PaymentSettingsForm';
import { PageHeader, SectionCard } from '@/shared/ui';

export default async function RoomPaymentSettingsPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const actor = await getActorFromSession();
  if (!actor) redirect('/login');
  if (actor.mustChangePassword) redirect('/change-password');
  const { roomId } = await params;
  if (actor.isSystemAdmin) redirect('/admin/billing/settings');
  let settings;
  try {
    settings = await getRoomPaymentSettings(actor, roomId, 'OWNER', systemClock.now());
  } catch (error) {
    if (error instanceof AppError && error.code === 'RESOURCE_NOT_FOUND') notFound();
    throw error;
  }
  const label = (await getRoomLabels([roomId]))[0]?.label ?? 'Room';
  return (
    <main
      data-testid="room-payment-settings-page"
      className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <Link href={`/rooms/${roomId}`} className="text-small font-medium text-link hover:underline">
        Back to room
      </Link>
      <PageHeader title="Private rent payment details" description={label} />
      <SectionCard
        title="Receiving account"
        description="Your tenants use these details to pay private rent."
      >
        <PaymentSettingsForm
          key={settings?.id ?? roomId}
          roomId={roomId}
          payeeType="OWNER"
          value={settings}
        />
      </SectionCard>
    </main>
  );
}
