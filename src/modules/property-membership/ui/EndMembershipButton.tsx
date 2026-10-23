'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Dialog, serverErrorMessage, useToast } from '@/shared/ui';

export function EndMembershipButton({
  roomId,
  membershipId,
  personKind = 'member',
}: {
  roomId: string;
  membershipId: string;
  personKind?: 'member' | 'tenant';
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirm(): Promise<void> {
    setServerError(null);
    setBusy(true);
    try {
      const response = await fetch(`/api/rooms/${roomId}/members/${membershipId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'END' }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setServerError(serverErrorMessage(payload, 'Could not end the membership.'));
        return;
      }
      setConfirmOpen(false);
      toast.success(personKind === 'tenant' ? 'Tenant removed.' : 'Member removed.');
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
        data-testid={`room-membership-end-${membershipId}`}
        variant="secondary"
        size="sm"
        onClick={() => setConfirmOpen(true)}
      >
        {personKind === 'tenant' ? 'Remove tenant' : 'Remove member'}
      </Button>
      <Dialog
        open={confirmOpen}
        busy={busy}
        onClose={() => {
          if (!busy) setConfirmOpen(false);
        }}
        title={personKind === 'tenant' ? 'Remove this tenant?' : 'Remove this member?'}
        description={
          personKind === 'tenant'
            ? 'Only this person’s tenant access ends. The rental period and other tenants stay active.'
            : 'The member loses room access immediately. History is kept.'
        }
        size="sm"
        testId="room-membership-end-confirm"
        actions={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid="room-membership-end-submit"
              variant="destructive"
              loading={busy}
              onClick={() => void confirm()}
            >
              {personKind === 'tenant' ? 'Remove tenant' : 'Remove member'}
            </Button>
          </>
        }
      >
        {serverError !== null ? (
          <p
            data-testid="room-membership-end-error"
            role="alert"
            className="text-sm font-medium text-danger-foreground"
          >
            {serverError}
          </p>
        ) : (
          <p className="text-sm leading-6 text-muted-foreground">
            This person will no longer appear in the active member list. Their past activity stays
            recorded.
          </p>
        )}
      </Dialog>
    </>
  );
}
