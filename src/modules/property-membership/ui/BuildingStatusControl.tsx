'use client';
import { Power, PowerOff } from 'lucide-react';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, serverErrorMessage, useToast } from '@/shared/ui';

export function BuildingStatusControl({
  buildingId,
  status,
}: {
  buildingId: string;
  status: 'ACTIVE' | 'INACTIVE';
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const deactivating = status === 'ACTIVE';
  const nextStatus = deactivating ? 'INACTIVE' : 'ACTIVE';

  async function confirm(): Promise<void> {
    setServerError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/admin/buildings/${buildingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setServerError(serverErrorMessage(payload, 'Could not update the building.'));
        return;
      }
      setConfirmOpen(false);
      toast.success(deactivating ? 'Building deactivated.' : 'Building reactivated.');
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {deactivating ? (
        <Button
          data-testid="building-deactivate-open"
          variant="secondary"
          size="sm"
          onClick={() => setConfirmOpen(true)}
        >
          <PowerOff aria-hidden="true" className="size-4" />
          Deactivate building
        </Button>
      ) : (
        <Button
          data-testid="building-reactivate-open"
          variant="secondary"
          size="sm"
          onClick={() => setConfirmOpen(true)}
        >
          <Power aria-hidden="true" className="size-4" />
          Reactivate building
        </Button>
      )}
      <Dialog
        open={confirmOpen}
        busy={busy}
        onClose={() => setConfirmOpen(false)}
        title={deactivating ? 'Deactivate this building?' : 'Reactivate this building?'}
        description={
          deactivating
            ? 'The building and its rooms stop accepting new activity. This can be undone.'
            : 'The building becomes available again.'
        }
        size="sm"
        testId="building-status-confirm"
        actions={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid={
                deactivating ? 'building-deactivate-submit' : 'building-reactivate-submit'
              }
              variant="primary"
              loading={busy}
              onClick={() => void confirm()}
            >
              {deactivating ? 'Deactivate building' : 'Reactivate building'}
            </Button>
          </>
        }
      >
        {serverError !== null ? (
          <p
            data-testid="building-status-error"
            role="alert"
            className="text-sm font-medium text-danger-foreground"
          >
            {serverError}
          </p>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            {deactivating
              ? 'Existing tenancies, memberships, bills and history stay recorded. Each room keeps its own status.'
              : 'Rooms keep whatever status they already have.'}
          </p>
        )}
      </Dialog>
    </>
  );
}
