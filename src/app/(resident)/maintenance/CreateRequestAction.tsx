import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import { FormDialog } from '@/shared/ui';
import { listEligibleRooms } from '@/modules/maintenance/application/index';
import { getRoomLabels } from '@/modules/property-membership/application/index';
import { TicketCreateForm } from '@/modules/maintenance/ui/TicketCreateForm';

export async function CreateRequestAction({ actor }: { actor: Actor }) {
  const now = systemClock.now();
  const [privateRooms, managedRooms] = await Promise.all([
    listEligibleRooms(actor, 'PRIVATE_OWNER', now).then((result) => getRoomLabels(result.roomIds)),
    listEligibleRooms(actor, 'PROJECT_MANAGED_PRIVATE', now).then((result) =>
      getRoomLabels(result.roomIds),
    ),
  ]);
  return (
    <FormDialog
      triggerLabel="New request"
      title="New request"
      description="Tell us what happened and where. Add photos to help explain the problem."
      triggerTestId="maintenance-new-link"
      testId="maintenance-create-dialog"
      size="lg"
    >
      <TicketCreateForm privateRooms={privateRooms} managedRooms={managedRooms} />
    </FormDialog>
  );
}
