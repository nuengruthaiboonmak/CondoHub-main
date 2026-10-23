'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { serverErrorMessage } from './errorCopy';
import { useToast } from './Toast';

export function ResourceDeleteControl({
  resource,
  name,
  endpoint,
  description,
  testId,
  triggerTestId,
  dialogTestId,
  redirectTo,
  disabled = false,
}: {
  resource: string;
  name: string;
  endpoint: string;
  description: string;
  testId: string;
  triggerTestId?: string;
  dialogTestId?: string;
  redirectTo?: string | undefined;
  disabled?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: 'DELETE',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      if (!response.ok) {
        setError(
          serverErrorMessage(
            await response.json().catch(() => null),
            `Could not delete the ${resource}.`,
          ),
        );
        return;
      }
      setOpen(false);
      toast.success(`${resource.charAt(0).toUpperCase()}${resource.slice(1)} deleted.`);
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        data-testid={triggerTestId ?? `${testId}-open`}
        variant="destructive"
        disabled={disabled}
        title={disabled ? 'You cannot delete your own account.' : undefined}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Trash2 aria-hidden="true" className="size-4" />
        Delete {resource}
      </Button>
      <Dialog
        open={open}
        busy={busy}
        onClose={() => setOpen(false)}
        title={`Delete this ${resource}?`}
        description={description}
        size="sm"
        testId={dialogTestId ?? `${testId}-dialog`}
        actions={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid={`${testId}-submit`}
              variant="destructive"
              loading={busy}
              onClick={() => void remove()}
            >
              Delete {resource}
            </Button>
          </>
        }
      >
        <p className="break-words text-body font-medium">{name}</p>
        {error ? (
          <p
            data-testid={`${testId}-error`}
            role="alert"
            className="mt-3 text-body text-danger-foreground"
          >
            {error}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
