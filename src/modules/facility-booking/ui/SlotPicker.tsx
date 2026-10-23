'use client';

import { Select } from '@/shared/ui/Select';
import { DoorOpen as SelectIconDoorOpen } from 'lucide-react';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays } from 'lucide-react';
import { Badge, Button, cx, EmptyState, FormField, Skeleton, useToast } from '@/shared/ui';
import { INPUT_CLASS } from '@/shared/ui';

interface SlotRow {
  startsAt: string;
  endsAt: string;
  confirmed: number;
  capacity: number;
  remaining: number;
  mine: number;
  available: boolean;
}

interface AvailabilityPayload {
  data: {
    facilityId: string;
    date: string;
    roomId: string;
    quotaKind: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    quotaLimit: number;
    quotaUsed: number;
    periodKey: string;
    slots: SlotRow[];
  };
}

interface ErrorPayload {
  error?: { code?: string; message?: string };
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-US', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function todayProjectDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function SlotPicker({
  facilityId,
  rooms,
  initialRoomId,
  initialDate,
}: {
  facilityId: string;
  rooms: Array<{ id: string; name: string; buildingName: string }>;
  initialRoomId: string | null;
  initialDate?: string | undefined;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [roomId, setRoomId] = useState(initialRoomId ?? rooms[0]?.id ?? '');
  const [date, setDate] = useState(initialDate ?? todayProjectDate());
  const [payload, setPayload] = useState<AvailabilityPayload['data'] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (roomId === '') return;
      setLoading(true);
      setLoadError(null);
      setSubmitError(null);
      setSelected([]);
      try {
        const response = await fetch(
          `/api/facilities/${facilityId}/slots?date=${encodeURIComponent(date)}&roomId=${encodeURIComponent(roomId)}`,
          { signal },
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as ErrorPayload | null;
          if (signal.aborted) return;
          setLoadError(body?.error?.message ?? 'Could not load availability.');
          setPayload(null);
          return;
        }
        const body = (await response.json()) as AvailabilityPayload;
        if (signal.aborted) return;
        setPayload(body.data);
      } catch {
        if (signal.aborted) return;
        setLoadError('Could not load availability.');
        setPayload(null);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [facilityId, roomId, date],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const toggle = useCallback((startsAt: string, available: boolean) => {
    if (!available) return;
    setSelected((current) =>
      current.includes(startsAt)
        ? current.filter((item) => item !== startsAt)
        : [...current, startsAt].sort(),
    );
  }, []);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const submit = useCallback(async () => {
    if (selected.length === 0 || roomId === '') return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const key =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-booking`;
      const response = await fetch(`/api/facilities/${facilityId}/bookings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ roomId, startsAt: selected }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ErrorPayload | null;
        setSubmitError(body?.error?.message ?? 'Could not confirm the booking.');
        return;
      }
      toast.success('Booking confirmed.');
      router.push(`/rooms/${roomId}/bookings`);
      router.refresh();
    } catch {
      setSubmitError('Could not confirm the booking.');
    } finally {
      setSubmitting(false);
    }
  }, [facilityId, roomId, selected, router, toast]);

  return (
    <div className="flex flex-col gap-4" data-testid="slot-picker">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField label="Room" htmlFor="slot-picker-room">
          <Select
            icon={SelectIconDoorOpen}
            data-testid="slot-picker-room"
            aria-label="Room"
            className={INPUT_CLASS}
            value={roomId}
            disabled={submitting}
            onChange={(event) => {
              setRoomId(event.target.value);
              router.replace(
                `/facilities/${facilityId}?${new URLSearchParams({ roomId: event.target.value, date })}`,
                { scroll: false },
              );
            }}
          >
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {room.buildingName} · {room.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Date" htmlFor="slot-picker-date">
          <input
            data-testid="slot-picker-date"
            type="date"
            aria-label="Date"
            className={INPUT_CLASS}
            value={date}
            disabled={submitting}
            onChange={(event) => setDate(event.target.value)}
          />
        </FormField>
      </div>
      {payload !== null ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="slot-picker-quota">
          <Badge variant={payload.quotaUsed >= payload.quotaLimit ? 'warning' : 'info'}>
            Quota {payload.quotaUsed}/{payload.quotaLimit} {payload.quotaKind}
          </Badge>
          <span className="text-small ui-tabular text-muted-foreground">
            Period {payload.periodKey}
          </span>
        </div>
      ) : null}
      {loadError !== null ? (
        <p
          data-testid="slot-picker-load-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {loadError}
        </p>
      ) : null}
      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton
            variant="table-row"
            lines={4}
            data-testid="slot-picker-loading"
            aria-label="Loading slots"
          />
        </div>
      ) : null}
      {!loading && payload !== null && payload.slots.length === 0 ? (
        <EmptyState
          data-testid="slot-picker-empty"
          icon={CalendarDays}
          title="No slots on this date"
          description="The facility is closed, fully past, or covered by a closure on this date."
        />
      ) : null}
      {!loading && payload !== null && payload.slots.length > 0 ? (
        <div
          data-testid="slot-picker-grid"
          role="group"
          aria-label="Available slots"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3"
        >
          {payload.slots.map((slot) => {
            const active = selectedSet.has(slot.startsAt);
            const slug = slot.startsAt
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-+|-+$/g, '');
            return (
              <button
                key={slot.startsAt}
                type="button"
                data-testid={`slot-picker-slot-${slug}`}
                aria-pressed={active}
                disabled={!slot.available || submitting}
                onClick={() => toggle(slot.startsAt, slot.available)}
                className={cx(
                  'flex min-w-0 flex-col gap-1 rounded-xl border p-4 text-left text-body transition-[background-color,border-color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none',
                  active
                    ? 'border-primary bg-primary/10 text-foreground active:scale-[0.98] motion-reduce:active:scale-100'
                    : slot.available
                      ? 'border-border bg-surface text-foreground hover:border-primary active:scale-[0.98] motion-reduce:active:scale-100'
                      : 'cursor-not-allowed border-border bg-neutral text-muted-foreground',
                )}
              >
                <span className="font-semibold ui-tabular">
                  {formatTime(slot.startsAt)} – {formatTime(slot.endsAt)}
                </span>
                <span className="text-small ui-tabular">
                  {slot.available
                    ? `${slot.remaining} of ${slot.capacity} seats left`
                    : slot.startsAt <= new Date().toISOString()
                      ? 'Already started'
                      : 'Full'}
                  {slot.mine > 0 ? ` · ${slot.mine} mine` : ''}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {submitError !== null ? (
        <p
          data-testid="slot-picker-submit-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {submitError}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          data-testid="slot-picker-submit"
          loading={submitting}
          disabled={selected.length === 0 || loading}
          onClick={() => void submit()}
          fullWidthOnMobile
        >
          {selected.length === 0
            ? 'Select slots'
            : `Confirm ${selected.length} slot${selected.length === 1 ? '' : 's'}`}
        </Button>
        {selected.length > 0 ? (
          <Button
            type="button"
            variant="secondary"
            disabled={submitting}
            onClick={() => setSelected([])}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
