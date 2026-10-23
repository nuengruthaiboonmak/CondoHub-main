'use client';

import Link from 'next/link';
import { FormDialog } from '@/shared/ui';
import { OwnershipAssignForm } from './OwnershipForms';

export function RoomPeopleActions({
  roomId,
  roomName,
  showDetails = true,
}: {
  roomId: string;
  roomName: string;
  showDetails?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FormDialog
        triggerLabel="Assign owner"
        title="Assign owner"
        description={`Assign an existing account as an owner of ${roomName}.`}
        triggerTestId={`room-owner-assign-open-${roomId}`}
        testId="room-owner-assign-dialog"
        variant="secondary"
      >
        <OwnershipAssignForm roomId={roomId} />
      </FormDialog>
      {showDetails ? (
        <Link
          data-testid={`room-people-link-${roomId}`}
          href={`/rooms/${roomId}`}
          className="inline-flex min-h-9 items-center rounded-md px-2 text-small font-medium text-link hover:bg-ghost-hover"
        >
          People & details
        </Link>
      ) : null}
    </div>
  );
}
