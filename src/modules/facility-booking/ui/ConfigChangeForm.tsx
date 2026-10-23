'use client';
import { closingInputValue, closingScheduleValue } from './closingTime';
import { FormActions } from '@/shared/ui/FormActions';

import { Select } from '@/shared/ui/Select';
import { CalendarDays as SelectIconCalendarDays } from 'lucide-react';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Badge, Button, useFormDialog, FormField, useToast } from '@/shared/ui';
import { CHECKBOX_CLASS, INPUT_CLASS } from '@/shared/ui';
import type { FacilitySchedule } from '../domain/schedule';

const DAYS = [
  { key: '1', label: 'Mon' },
  { key: '2', label: 'Tue' },
  { key: '3', label: 'Wed' },
  { key: '4', label: 'Thu' },
  { key: '5', label: 'Fri' },
  { key: '6', label: 'Sat' },
  { key: '0', label: 'Sun' },
] as const;

const intString = (field: string, min: number, max: number) =>
  z.string().refine(
    (value) => {
      const parsed = Number(value);
      return value.trim() !== '' && Number.isInteger(parsed) && parsed >= min && parsed <= max;
    },
    { message: `${field} must be an integer between ${min} and ${max}.` },
  );

const configSchema = z.object({
  slotMinutes: intString('Slot length', 5, 1440),
  quotaKind: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  quotaLimit: intString('Quota limit', 0, 100000),
  advanceDays: intString('Advance days', 0, 365),
  effectiveAt: z.string().min(1, 'Effective time is required.'),
  openStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.'),
  openEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.'),
  openDays: z.array(z.string()).min(1, 'Select at least one open day.'),
});

type ConfigValues = z.infer<typeof configSchema>;

interface PreviewPayload {
  data: {
    facilityId: string;
    configVersion: number;
    effectiveAt: string;
    quotaOnlyReduction: boolean;
    structuralConflicts: Array<{
      id: string;
      bookingId: string;
      roomId: string;
      startsAt: string;
      endsAt: string;
      conflicts: string[];
    }>;
    quotaImpacts: Array<{
      roomId: string;
      periodKey: string;
      used: number;
      newLimit: number;
      overBy: number;
    }>;
    previewToken: string;
  };
}

interface ErrorPayload {
  error?: { code?: string; message?: string };
}

function toMinutes(value: string): number {
  const [hour, minute] = value.split(':') as [string, string];
  return Number(hour) * 60 + Number(minute);
}

export function ConfigChangeForm({
  facilityId,
  capacity,
  initial,
}: {
  facilityId: string;
  capacity: number;
  initial: {
    slotMinutes: number;
    quotaKind: 'DAILY' | 'WEEKLY' | 'MONTHLY';
    quotaLimit: number;
    advanceDays: number;
    openStart: string;
    openEnd: string;
    openDays: string[];
    schedule: FacilitySchedule;
  };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPayload['data'] | null>(null);
  const [working, setWorking] = useState(false);
  const dialog = useFormDialog(working);
  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors },
  } = useForm<ConfigValues>({
    resolver: zodResolver(configSchema),
    defaultValues: {
      slotMinutes: String(initial.slotMinutes),
      quotaKind: initial.quotaKind,
      quotaLimit: String(initial.quotaLimit),
      advanceDays: String(initial.advanceDays),
      effectiveAt: '',
      openStart: initial.openStart,
      openEnd: closingInputValue(initial.openEnd),
      openDays: initial.openDays,
    },
  });

  const buildBody = (values: ConfigValues): Record<string, unknown> | null => {
    const closing = closingScheduleValue(values.openEnd);
    if (toMinutes(closing) <= toMinutes(values.openStart)) {
      setServerError('Opening end must be after opening start.');
      return null;
    }
    const effectiveAt = new Date(values.effectiveAt);
    if (Number.isNaN(effectiveAt.getTime())) {
      setServerError('The effective time is invalid.');
      return null;
    }
    const days: Record<
      string,
      { open: Array<{ start: string; end: string }>; breaks: Array<{ start: string; end: string }> }
    > = {};
    for (const day of ['0', '1', '2', '3', '4', '5', '6']) {
      days[day] = values.openDays.includes(day)
        ? { open: [{ start: values.openStart, end: closing }], breaks: [] }
        : { open: [], breaks: [] };
    }
    return {
      schedule:
        values.openStart === initial.openStart &&
        closing === initial.openEnd &&
        [...values.openDays].sort().join(',') === [...initial.openDays].sort().join(',')
          ? initial.schedule
          : { days, holidays: initial.schedule.holidays },
      slotMinutes: Number(values.slotMinutes),
      capacity,
      quotaKind: values.quotaKind,
      quotaLimit: Number(values.quotaLimit),
      advanceDays: Number(values.advanceDays),
      effectiveAt: effectiveAt.toISOString(),
    };
  };

  const onPreview = handleSubmit(async (values) => {
    setServerError(null);
    setPreview(null);
    const body = buildBody(values);
    if (body === null) return;
    setWorking(true);
    try {
      const response = await fetch(`/api/admin/facilities/${facilityId}/config-preview`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
        setServerError(payload?.error?.message ?? 'Could not preview the config change.');
        return;
      }
      const parsed = (await response.json()) as PreviewPayload;
      setPreview(parsed.data);
    } catch {
      setServerError('Could not preview the config change.');
    } finally {
      setWorking(false);
    }
  });

  const onCommit = async () => {
    if (preview === null) return;
    setServerError(null);
    const values = getValues();
    const body = buildBody(values);
    if (body === null) return;
    setWorking(true);
    try {
      const key =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-config`;
      const response = await fetch(`/api/admin/facilities/${facilityId}/config-commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ ...body, previewToken: preview.previewToken }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
        if (payload?.error?.code === 'CONFIG_IMPACT_CHANGED') {
          setPreview(null);
        }
        setServerError(payload?.error?.message ?? 'Could not commit the config change.');
        return;
      }
      toast.success('Config committed.');
      dialog?.complete();
      setPreview(null);
      router.refresh();
    } catch {
      setServerError('Could not commit the config change.');
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="config-change">
      <form
        data-testid="config-change-form"
        onSubmit={onPreview}
        onChange={() => setPreview(null)}
        noValidate
        className="flex min-w-0 flex-col gap-4"
      >
        <fieldset disabled={working} className="flex min-w-0 flex-col gap-4">
          {serverError !== null ? (
            <p
              data-testid="config-change-error"
              role="alert"
              className="text-body leading-body font-medium text-danger-foreground"
            >
              {serverError}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField label="Slot length (minutes)" htmlFor="config-change-slot">
              <input
                data-testid="config-change-slot-minutes"
                type="number"
                min={5}
                className={INPUT_CLASS}
                {...register('slotMinutes')}
              />
            </FormField>
            <FormField label="Quota period" htmlFor="config-change-kind">
              <Select
                icon={SelectIconCalendarDays}
                data-testid="config-change-quota-kind"
                className={INPUT_CLASS}
                {...register('quotaKind')}
              >
                <option value="DAILY">Daily</option>
                <option value="WEEKLY">Weekly</option>
                <option value="MONTHLY">Monthly</option>
              </Select>
            </FormField>
            <FormField label="Quota slots per period" htmlFor="config-change-limit">
              <input
                data-testid="config-change-quota-limit"
                type="number"
                min={0}
                className={INPUT_CLASS}
                {...register('quotaLimit')}
              />
            </FormField>
            <FormField label="Advance booking days" htmlFor="config-change-advance">
              <input
                data-testid="config-change-advance-days"
                type="number"
                min={0}
                className={INPUT_CLASS}
                {...register('advanceDays')}
              />
            </FormField>
            <div className="sm:col-span-2">
              <FormField
                label="Effective at"
                htmlFor="config-change-effective"
                error={errors.effectiveAt?.message ?? ''}
              >
                <input
                  data-testid="config-change-effective-at"
                  type="datetime-local"
                  className={INPUT_CLASS}
                  {...register('effectiveAt')}
                />
              </FormField>
            </div>
          </div>
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="text-body font-medium text-foreground">Opening hours</legend>
            <p className="text-small text-muted-foreground">
              Current daily hours and breaks are kept unless you change the days or times below.
              Changing them applies these hours to all selected days and replaces their breaks.
              Holiday dates are kept.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {DAYS.map((day) => (
                <label key={day.key} className="flex items-center gap-2 text-body text-foreground">
                  <input
                    data-testid={`config-change-day-${day.key}`}
                    type="checkbox"
                    className={CHECKBOX_CLASS}
                    value={day.key}
                    {...register('openDays')}
                  />
                  {day.label}
                </label>
              ))}
            </div>
            {errors.openDays !== undefined ? (
              <p role="alert" className="text-body leading-body font-medium text-danger-foreground">
                {errors.openDays.message}
              </p>
            ) : null}
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Opens" htmlFor="config-change-open-start" className="min-w-0">
              <input
                data-testid="config-change-open-start"
                type="time"
                className={INPUT_CLASS}
                {...register('openStart')}
              />
            </FormField>
            <FormField
              label="Closes"
              htmlFor="config-change-open-end"
              hint="00:00 means midnight at the end of the day."
              className="min-w-0"
            >
              <input
                data-testid="config-change-open-end"
                type="time"
                className={INPUT_CLASS}
                {...register('openEnd')}
              />
            </FormField>
          </div>
          <FormActions onCancel={dialog?.requestClose} pending={working}>
            <Button
              data-testid="config-change-preview"
              type="submit"
              variant="secondary"
              loading={working}
            >
              Preview impact
            </Button>
          </FormActions>
        </fieldset>
      </form>
      {preview !== null ? (
        <section
          data-testid="config-change-preview-result"
          aria-label="Config impact preview"
          className="flex min-w-0 flex-col gap-4 rounded-lg border border-border bg-surface p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={preview.quotaOnlyReduction ? 'info' : 'neutral'}>
              {preview.quotaOnlyReduction ? 'Quota-only reduction' : 'Structural change'}
            </Badge>
            <span className="text-small text-muted-foreground">
              Based on config version {preview.configVersion}
            </span>
          </div>
          <div className="flex flex-col gap-1 border-t border-border pt-4 text-body">
            <p className="font-medium text-foreground">
              {preview.structuralConflicts.length} conflicting future slot
              {preview.structuralConflicts.length === 1 ? '' : 's'}
            </p>
            {preview.structuralConflicts.length === 0 ? (
              <p
                data-testid="config-change-no-conflicts"
                className="text-small text-muted-foreground"
              >
                No future bookings conflict with the proposed schedule, length, capacity, or
                closures.
              </p>
            ) : (
              <ul data-testid="config-change-conflicts" className="flex flex-col gap-1">
                {preview.structuralConflicts.slice(0, 20).map((slot) => (
                  <li key={slot.id} className="break-words text-body text-foreground">
                    {new Date(slot.startsAt).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' })}
                    {' · '}
                    {slot.conflicts.join(', ')}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-1 border-t border-border pt-4 text-body">
            <p className="font-medium text-foreground">
              {preview.quotaImpacts.length} room-period
              {preview.quotaImpacts.length === 1 ? '' : 's'} over the new limit
            </p>
            {preview.quotaImpacts.length === 0 ? (
              <p className="text-small text-muted-foreground">
                No room currently exceeds the proposed quota limit.
              </p>
            ) : (
              <ul data-testid="config-change-quota-impacts" className="flex flex-col gap-1">
                {preview.quotaImpacts.slice(0, 20).map((impact) => (
                  <li
                    key={`${impact.roomId}-${impact.periodKey}`}
                    className="break-words text-body text-foreground"
                  >
                    {impact.periodKey}: used {impact.used}, new limit {impact.newLimit}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-small text-muted-foreground">
              Quota-only reductions never cancel existing bookings; new requests are blocked until
              usage fits.
            </p>
          </div>
          <FormActions onCancel={dialog?.requestClose} pending={working}>
            <Button
              data-testid="config-change-commit"
              type="button"
              loading={working}
              disabled={preview.structuralConflicts.length > 0}
              onClick={() => void onCommit()}
            >
              Apply booking rules
            </Button>
          </FormActions>
        </section>
      ) : null}
    </div>
  );
}
