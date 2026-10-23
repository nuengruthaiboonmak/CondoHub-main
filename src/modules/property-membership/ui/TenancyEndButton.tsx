'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, serverErrorMessage, useToast } from '@/shared/ui';

export function TenancyEndButton({
  roomId,
  tenancyId,
  scheduled = false,
}: {
  roomId: string;
  tenancyId: string;
  scheduled?: boolean;
}) {
  const prefix = scheduled ? 'room-tenancy-cancel' : 'room-tenancy-end';
  const label = scheduled ? 'Cancel scheduled rental' : 'End rental period';
  const router = useRouter();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm(): Promise<void> {
    setServerError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/rooms/${roomId}/tenancies/${tenancyId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ action: scheduled ? 'CANCEL' : 'END' }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setServerError(
          serverErrorMessage(
            payload,
            scheduled ? 'Could not cancel the scheduled rental.' : 'Could not end the tenancy.',
          ),
        );
        return;
      }
      setConfirmOpen(false);
      toast.success(scheduled ? 'Scheduled rental cancelled.' : 'Rental period ended.');
      router.refresh();
    } catch {
      setServerError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        data-testid={`${prefix}-${tenancyId}`}
        variant="secondary"
        size="sm"
        onClick={() => setConfirmOpen(true)}
      >
        {label}
      </Button>
      <Dialog
        open={confirmOpen}
        busy={busy}
        onClose={() => {
          if (!busy) setConfirmOpen(false);
        }}
        title={scheduled ? 'Cancel this scheduled rental?' : 'End this rental period?'}
        description={
          scheduled
            ? 'This rental will not start. Linked tenants lose access from it. Planned dates, issued invoices and payment history stay recorded.'
            : 'All linked tenants lose tenant access. Invoices and repair history are kept.'
        }
        size="sm"
        testId={`${prefix}-confirm`}
        actions={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid={`${prefix}-submit`}
              variant="destructive"
              loading={busy}
              onClick={() => void confirm()}
            >
              {label}
            </Button>
          </>
        }
      >
        {serverError !== null ? (
          <p
            data-testid={`${prefix}-error`}
            role="alert"
            className="text-sm font-medium text-danger-foreground"
          >
            {serverError}
          </p>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            {scheduled
              ? 'Future rent will no longer be generated for this rental. Review any issued invoices separately.'
              : 'The rental period closes now. Linked memberships end with it.'}
          </p>
        )}
      </Dialog>
    </>
  );
}
