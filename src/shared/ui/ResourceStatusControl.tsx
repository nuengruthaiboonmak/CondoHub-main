'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Power, PowerOff } from 'lucide-react';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { serverErrorMessage } from './errorCopy';
import { useToast } from './Toast';

export function ResourceStatusControl({
  resource,
  active,
  endpoint,
  testId,
  description,
  requestBody,
}: {
  resource: string;
  active: boolean;
  endpoint: string;
  testId: string;
  description: string;
  requestBody?: () => Record<string, unknown>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = active ? 'Deactivate' : 'Reactivate';
  const Icon = active ? PowerOff : Power;
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(
          requestBody ? requestBody() : { status: active ? 'INACTIVE' : 'ACTIVE' },
        ),
      });
      if (!response.ok) {
        setError(
          serverErrorMessage(
            await response.json().catch(() => null),
            `Could not update the ${resource}.`,
          ),
        );
        return;
      }
      setOpen(false);
      toast.success(
        `${resource.charAt(0).toUpperCase()}${resource.slice(1)} ${active ? 'deactivated' : 'reactivated'}.`,
      );
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
        data-testid={`${testId}-open`}
        variant="secondary"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <Icon aria-hidden="true" className="size-4" />
        {action} {resource}
      </Button>
      <Dialog
        open={open}
        busy={busy}
        onClose={() => setOpen(false)}
        title={`${action} this ${resource}?`}
        description={description}
        size="sm"
        testId={`${testId}-dialog`}
        actions={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button data-testid={`${testId}-submit`} loading={busy} onClick={() => void confirm()}>
              {action} {resource}
            </Button>
          </>
        }
      >
        {error ? (
          <p
            data-testid={`${testId}-error`}
            role="alert"
            className="text-body text-danger-foreground"
          >
            {error}
          </p>
        ) : (
          <p className="text-body text-muted-foreground">
            {active
              ? 'You can reactivate it later.'
              : 'It becomes available for new activity again.'}
          </p>
        )}
      </Dialog>
    </>
  );
}
