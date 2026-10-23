'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Ban, Building2, FilePlus2 } from 'lucide-react';
import {
  ActionMenu,
  Button,
  Dialog,
  FormField,
  INPUT_CLASS,
  Select,
  serverErrorMessage,
  useToast,
} from '@/shared/ui';
import type { ChargeEventDto } from '../application/index';
import { readChargeEventRoomScope } from '../domain/chargeEventContext';

const schema = z
  .object({
    scope: z.enum(['ALL', 'SELECTED']),
    roomIds: z.array(z.string()).max(100, 'Choose at most 100 rooms for a selected audience.'),
  })
  .superRefine((value, ctx) => {
    if (value.scope === 'SELECTED' && value.roomIds.length === 0)
      ctx.addIssue({ code: 'custom', path: ['roomIds'], message: 'Choose at least one room.' });
  });
type Values = z.infer<typeof schema>;
type Outcome = {
  created: number;
  skipped: number;
  remaining: number;
  issued: number;
  errors: Array<{ roomId: string; reason: string }>;
};

export function ChargeEventIssuanceControl({
  event,
  rooms,
}: {
  event: ChargeEventDto;
  rooms: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  let savedScope: string[] | null = null;
  let invalidScope = false;
  try {
    savedScope = readChargeEventRoomScope(event.chargeContext);
  } catch {
    invalidScope = true;
  }
  const {
    register,
    control,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { scope: 'ALL', roomIds: [] },
  });
  const selectedScope = useWatch({ control, name: 'scope' });
  const chosen = useWatch({ control, name: 'roomIds' });
  const matching = rooms.filter((room) => room.label.toLowerCase().includes(search.toLowerCase()));
  const labels = new Map(rooms.map((room) => [room.id, room.label]));
  const submit = handleSubmit(
    async (values) => {
      setError(null);
      try {
        const response = await fetch(`/api/admin/billing/common-fee-events/${event.id}/issue`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify(
            !savedScope && values.scope === 'SELECTED' ? { roomIds: values.roomIds } : {},
          ),
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          setError(
            serverErrorMessage(
              payload,
              'Could not issue invoices. Review the event and try again.',
            ),
          );
          return;
        }
        const result = (payload as { data: Outcome }).data;
        setOutcome(result);
        setOpen(false);
        if (!result.errors.length)
          toast.success(
            result.remaining
              ? 'Invoice batch issued. Continue with the remaining rooms.'
              : 'All event invoices issued.',
          );
        router.refresh();
      } catch {
        setError(
          'Could not reach the server. Reload to check progress, then try again. Existing invoices will not be duplicated.',
        );
      }
    },
    () => setFocus('scope'),
  );

  async function cancel() {
    setCancelling(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/billing/common-fee-events/${event.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ action: 'CANCEL' }),
      });
      if (!response.ok) {
        setError(
          serverErrorMessage(
            await response.json().catch(() => null),
            'Could not cancel the event.',
          ),
        );
        return;
      }
      setCancelOpen(false);
      setOutcome(null);
      toast.success('Event cancelled. Issued invoices stay recorded.');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {outcome ? (
        <div
          data-testid="charge-event-issue-result"
          role="status"
          className="rounded-xl border border-border bg-background p-4 text-small"
        >
          <p className="font-medium">
            {outcome.created} {outcome.created === 1 ? 'invoice created' : 'invoices created'} ·{' '}
            {outcome.issued} issued in total · {outcome.remaining} remaining
          </p>
          {outcome.remaining > 0 ? (
            <p className="mt-1 text-muted-foreground">
              Continue in batches of up to 25 rooms. Existing invoices are skipped.
            </p>
          ) : null}
        </div>
      ) : null}
      {outcome?.errors.length ? (
        <div
          data-testid="charge-event-issue-errors"
          role="alert"
          className="rounded-xl border border-warning-border bg-warning p-4 text-small"
        >
          <p className="font-medium">
            Some rooms need attention before their invoices can be issued.
          </p>
          <ul className="mt-3 space-y-3">
            {outcome.errors.map((item) => (
              <li key={item.roomId} className="break-words">
                <Link
                  data-testid={`charge-event-issue-error-room-${item.roomId}`}
                  href={`/rooms/${item.roomId}`}
                  className="font-medium text-link underline-offset-2 hover:underline"
                >
                  {labels.get(item.roomId) ?? 'Review this room'}
                </Link>
                <p className="mt-1 text-muted-foreground">{item.reason}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {invalidScope ? (
        <p role="alert" className="text-small text-danger-foreground">
          The saved audience is invalid. Cancel this event and create a new one before issuing
          invoices.
        </p>
      ) : null}
      {event.status === 'OPEN' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            data-testid="charge-event-issue-open"
            disabled={invalidScope || rooms.length === 0}
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
          >
            <FilePlus2 aria-hidden="true" className="size-4" />
            {savedScope ? 'Continue issuance' : 'Issue invoices'}
          </Button>
          <ActionMenu label="Event actions" testId="charge-event-actions">
            <Button
              data-testid="charge-event-cancel-open"
              variant="secondary"
              onClick={() => {
                setError(null);
                setCancelOpen(true);
              }}
            >
              <Ban aria-hidden="true" className="size-4" />
              Cancel event
            </Button>
          </ActionMenu>
        </div>
      ) : null}
      <Dialog
        open={open}
        busy={isSubmitting}
        onClose={() => setOpen(false)}
        title={savedScope ? 'Continue invoice issuance' : 'Issue event invoices'}
        description="Confirm the rooms to bill. Each run issues up to 25 invoices and keeps completed invoices unchanged."
        size="lg"
        testId="charge-event-issue-dialog"
        actions={
          <>
            <Button variant="secondary" disabled={isSubmitting} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid="charge-event-issue-submit"
              loading={isSubmitting}
              onClick={() => void submit()}
            >
              Issue next batch
            </Button>
          </>
        }
      >
        <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-4">
          <p className="text-small text-muted-foreground">
            {event.configuredAmount
              ? `${event.configuredAmount.amount} THB per room.`
              : 'Amounts follow the billing rule.'}{' '}
            Owners on {event.eventEffectiveDate} are responsible for this charge.
          </p>
          {error ? (
            <p
              role="alert"
              data-testid="charge-event-issue-error"
              className="text-small text-danger-foreground"
            >
              {error}
            </p>
          ) : null}
          {savedScope ? (
            <p className="rounded-lg border border-border bg-background p-4 text-small">
              The confirmed audience contains {savedScope.length}{' '}
              {savedScope.length === 1 ? 'room' : 'rooms'}. It cannot be changed after issuance
              starts.
            </p>
          ) : (
            <FormField label="Rooms to bill" htmlFor="charge-event-issue-scope">
              <Select
                icon={Building2}
                data-testid="charge-event-issue-scope"
                disabled={isSubmitting}
                {...register('scope')}
              >
                <option value="ALL">All {rooms.length} active rooms</option>
                <option value="SELECTED">Choose specific rooms</option>
              </Select>
            </FormField>
          )}
          {!savedScope && selectedScope === 'SELECTED' ? (
            <fieldset disabled={isSubmitting} className="min-w-0 space-y-3">
              <legend className="mb-2 text-small font-medium">
                Choose rooms ({chosen.length}/100)
              </legend>
              <input
                aria-label="Search rooms to bill"
                data-testid="charge-event-issue-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className={INPUT_CLASS}
                placeholder="Search room or building"
              />
              <div className="max-h-64 overflow-y-auto rounded-xl border border-border p-2">
                {matching.slice(0, 50).map((room) => (
                  <label
                    key={room.id}
                    className="flex min-w-0 cursor-pointer items-start gap-3 rounded-lg p-3 hover:bg-ghost-hover"
                  >
                    <input
                      type="checkbox"
                      data-testid={`charge-event-issue-room-${room.id}`}
                      value={room.id}
                      {...register('roomIds')}
                      className="mt-1 size-4 shrink-0 accent-primary"
                    />
                    <span className="min-w-0 break-words text-small">{room.label}</span>
                  </label>
                ))}
                {!matching.length ? (
                  <p className="p-3 text-small text-muted-foreground">
                    No matching rooms. Try another search.
                  </p>
                ) : null}
              </div>
              {matching.length > 50 ? (
                <p className="text-caption text-muted-foreground">
                  Showing the first 50 matches. Refine your search to find more rooms.
                </p>
              ) : null}
              {errors.roomIds ? (
                <p role="alert" className="text-small text-danger-foreground">
                  {errors.roomIds.message}
                </p>
              ) : null}
            </fieldset>
          ) : null}
        </form>
      </Dialog>
      <Dialog
        open={cancelOpen}
        busy={cancelling}
        onClose={() => setCancelOpen(false)}
        title="Cancel this billing event?"
        description="No more invoices will be issued from this event. Existing invoices and payment history stay recorded."
        size="sm"
        testId="charge-event-cancel-dialog"
        actions={
          <>
            <Button variant="secondary" disabled={cancelling} onClick={() => setCancelOpen(false)}>
              Keep event open
            </Button>
            <Button
              data-testid="charge-event-cancel-submit"
              variant="destructive"
              loading={cancelling}
              onClick={() => void cancel()}
            >
              Cancel event
            </Button>
          </>
        }
      >
        {error ? (
          <p role="alert" className="text-small text-danger-foreground">
            {error}
          </p>
        ) : (
          <p className="text-small text-muted-foreground">
            Issued invoices are not waived or cancelled by this action.
          </p>
        )}
      </Dialog>
    </div>
  );
}
