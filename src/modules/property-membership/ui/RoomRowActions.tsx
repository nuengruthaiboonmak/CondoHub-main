'use client';
import { Pencil, Power, PowerOff } from 'lucide-react';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import {
  Button,
  Dialog,
  FormField,
  INPUT_CLASS,
  ResourceDeleteControl,
  serverErrorMessage,
  useToast,
} from '@/shared/ui';

const editSchema = z.object({
  name: z.string().trim().min(1, 'Room name is required.').max(255),
  areaSqm: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, 'Area must be a number with up to 4 decimals.'),
});

type EditValues = z.infer<typeof editSchema>;

interface DisableImpact {
  activeTenancies?: number;
  activeMemberships?: number;
  ownershipIntervals?: number;
  tenancyIntervals?: number;
  membershipIntervals?: number;
}

function impactCopy(impact: DisableImpact): string {
  const parts: string[] = [];
  if ((impact.activeTenancies ?? 0) > 0) {
    parts.push(`${impact.activeTenancies} active tenancies`);
  }
  if ((impact.activeMemberships ?? 0) > 0) {
    parts.push(`${impact.activeMemberships} active memberships`);
  }
  if ((impact.ownershipIntervals ?? 0) > 0) {
    parts.push(`${impact.ownershipIntervals} ownership records`);
  }
  if ((impact.tenancyIntervals ?? 0) > 0) {
    parts.push(`${impact.tenancyIntervals} tenancy records`);
  }
  if ((impact.membershipIntervals ?? 0) > 0) {
    parts.push(`${impact.membershipIntervals} membership records`);
  }
  return parts.length > 0 ? ` ${parts.join(', ')} remain recorded.` : '';
}

export function RoomRowActions({
  roomId,
  name,
  areaSqm,
  status,
  deleteRedirectTo,
}: {
  roomId: string;
  name: string;
  areaSqm: string;
  status: 'ACTIVE' | 'INACTIVE';
  deleteRedirectTo?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name, areaSqm },
  });

  const onEdit = handleSubmit(async (values) => {
    setEditError(null);
    const response = await fetch(`/api/admin/rooms/${roomId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: values.name, areaSqm: values.areaSqm }),
    });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      setEditError(serverErrorMessage(payload, 'Could not update the room.'));
      return;
    }
    setEditOpen(false);
    toast.success('Room updated.');
    router.refresh();
  });

  async function setStatus(next: 'ACTIVE' | 'INACTIVE'): Promise<void> {
    setStatusError(null);
    setBusy(true);
    try {
      if (next === 'INACTIVE') {
        const response = await fetch(`/api/admin/rooms/${roomId}/disable`, { method: 'POST' });
        if (!response.ok) {
          const payload: unknown = await response.json().catch(() => null);
          setStatusError(serverErrorMessage(payload, 'Could not deactivate the room.'));
          return;
        }
        const payload = (await response.json().catch(() => null)) as {
          data?: { impact?: DisableImpact };
        } | null;
        setDeactivateOpen(false);
        toast.success(`Room deactivated.${impactCopy(payload?.data?.impact ?? {})}`);
        router.refresh();
        return;
      }
      const response = await fetch(`/api/admin/rooms/${roomId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'ACTIVE' }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setStatusError(serverErrorMessage(payload, 'Could not reactivate the room.'));
        return;
      }
      setDeactivateOpen(false);
      toast.success('Room reactivated.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <span className="flex flex-wrap gap-2">
        <Button
          data-testid={`room-edit-open-${roomId}`}
          variant="secondary"
          size="sm"
          onClick={() => setEditOpen(true)}
        >
          <Pencil aria-hidden="true" className="size-4" />
          Edit
        </Button>
        {status === 'ACTIVE' ? (
          <Button
            data-testid={`room-deactivate-open-${roomId}`}
            variant="secondary"
            size="sm"
            onClick={() => setDeactivateOpen(true)}
          >
            <PowerOff aria-hidden="true" className="size-4" />
            Deactivate
          </Button>
        ) : (
          <Button
            data-testid={`room-reactivate-open-${roomId}`}
            variant="secondary"
            size="sm"
            onClick={() => setDeactivateOpen(true)}
          >
            <Power aria-hidden="true" className="size-4" />
            Reactivate
          </Button>
        )}
        <ResourceDeleteControl
          resource="room"
          name={name}
          endpoint={`/api/admin/rooms/${roomId}`}
          testId="room-delete"
          redirectTo={deleteRedirectTo}
          triggerTestId={`room-delete-open-${roomId}`}
          description="This room will be removed from the directory. End active or scheduled rentals and memberships first. Bills and history stay recorded."
        />
      </span>
      <Dialog
        open={editOpen}
        busy={isSubmitting}
        onClose={() => setEditOpen(false)}
        title="Edit room"
        description="Update the room name and area."
        size="sm"
        testId="room-edit-dialog"
        actions={
          <>
            <Button variant="secondary" disabled={isSubmitting} onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid="room-edit-submit"
              loading={isSubmitting}
              onClick={() => void onEdit()}
            >
              Save room
            </Button>
          </>
        }
      >
        <form
          data-testid="room-edit-form"
          onSubmit={onEdit}
          noValidate
          className="flex flex-col gap-4"
        >
          {editError !== null ? (
            <p
              data-testid="room-edit-error"
              role="alert"
              className="text-sm font-medium text-danger-foreground"
            >
              {editError}
            </p>
          ) : null}
          <FormField
            label="Room name"
            htmlFor="room-edit-name"
            error={errors.name?.message ?? ''}
            required
          >
            <input data-testid="room-edit-name" className={INPUT_CLASS} {...register('name')} />
          </FormField>
          <FormField
            label="Area (sqm)"
            htmlFor="room-edit-area"
            error={errors.areaSqm?.message ?? ''}
            hint="Number with up to 4 decimals."
            required
          >
            <input
              data-testid="room-edit-area"
              type="text"
              required
              inputMode="decimal"
              className={INPUT_CLASS}
              {...register('areaSqm')}
            />
          </FormField>
        </form>
      </Dialog>
      <Dialog
        open={deactivateOpen}
        busy={busy}
        onClose={() => setDeactivateOpen(false)}
        title={status === 'ACTIVE' ? 'Deactivate this room?' : 'Reactivate this room?'}
        description={
          status === 'ACTIVE'
            ? 'The room stops accepting new activity. History is kept.'
            : 'The room becomes available again.'
        }
        size="sm"
        testId="room-status-confirm"
        actions={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setDeactivateOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid={
                status === 'ACTIVE' ? 'room-deactivate-submit' : 'room-reactivate-submit'
              }
              variant="primary"
              loading={busy}
              onClick={() => void setStatus(status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE')}
            >
              {status === 'ACTIVE' ? 'Deactivate room' : 'Reactivate room'}
            </Button>
          </>
        }
      >
        {statusError !== null ? (
          <p
            data-testid="room-status-error"
            role="alert"
            className="text-sm font-medium text-danger-foreground"
          >
            {statusError}
          </p>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            {status === 'ACTIVE'
              ? 'Tenancies, memberships, and ownership records stay untouched.'
              : 'The room status returns to active. Related records are unchanged.'}
          </p>
        )}
      </Dialog>
    </>
  );
}
