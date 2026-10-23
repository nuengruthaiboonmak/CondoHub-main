'use client';
import { closingScheduleValue } from './closingTime';
import { FormActions } from '@/shared/ui/FormActions';

import { Select } from '@/shared/ui/Select';
import { CalendarDays as SelectIconCalendarDays } from 'lucide-react';

import { useFormDialog } from '@/shared/ui/FormDialog';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Button, FormField, useToast } from '@/shared/ui';
import { CHECKBOX_CLASS, INPUT_CLASS, TEXTAREA_CLASS } from '@/shared/ui';

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

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(255),
  description: z.string().trim().max(20000).optional(),
  capacity: intString('Capacity', 1, 1000),
  slotMinutes: intString('Slot length', 5, 1440),
  quotaKind: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  quotaLimit: intString('Quota limit', 0, 100000),
  advanceDays: intString('Advance days', 0, 365),
  openStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.'),
  openEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.'),
  breakStart: z.string().optional(),
  breakEnd: z.string().optional(),
  openDays: z.array(z.string()).min(1, 'Select at least one open day.'),
});

type CreateValues = z.infer<typeof createSchema>;

interface ErrorPayload {
  error?: { message?: string };
}

function toMinutes(value: string): number {
  const [hour, minute] = value.split(':') as [string, string];
  return Number(hour) * 60 + Number(minute);
}

export function FacilityCreateForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      capacity: '1',
      slotMinutes: '60',
      quotaKind: 'DAILY',
      quotaLimit: '2',
      advanceDays: '14',
      openStart: '09:00',
      openEnd: '18:00',
      openDays: ['1', '2', '3', '4', '5'],
    },
  });

  const dialog = useFormDialog(isSubmitting);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const closing = closingScheduleValue(values.openEnd);
    if (toMinutes(closing) <= toMinutes(values.openStart)) {
      setServerError('Opening end must be after opening start.');
      return;
    }
    const hasBreak = (values.breakStart ?? '') !== '' || (values.breakEnd ?? '') !== '';
    if (hasBreak) {
      const breakPattern = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (
        !breakPattern.test(values.breakStart ?? '') ||
        !breakPattern.test(values.breakEnd ?? '')
      ) {
        setServerError('Break times must use HH:MM format.');
        return;
      }
      const breakStart = toMinutes(values.breakStart ?? '');
      const breakEnd = toMinutes(values.breakEnd ?? '');
      if (
        breakEnd <= breakStart ||
        breakStart < toMinutes(values.openStart) ||
        breakEnd > toMinutes(closing)
      ) {
        setServerError('The break must sit inside the opening window.');
        return;
      }
    }
    const days: Record<
      string,
      { open: Array<{ start: string; end: string }>; breaks: Array<{ start: string; end: string }> }
    > = {};
    for (const day of ['0', '1', '2', '3', '4', '5', '6']) {
      if (!values.openDays.includes(day)) {
        days[day] = { open: [], breaks: [] };
      } else {
        days[day] = {
          open: [{ start: values.openStart, end: closing }],
          breaks: hasBreak ? [{ start: values.breakStart ?? '', end: values.breakEnd ?? '' }] : [],
        };
      }
    }
    const response = await fetch('/api/admin/facilities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId,
        name: values.name,
        description: values.description ?? null,
        status: 'ACTIVE',
        capacity: Number(values.capacity),
        schedule: { days, holidays: [] },
        slotMinutes: Number(values.slotMinutes),
        quotaKind: values.quotaKind,
        quotaLimit: Number(values.quotaLimit),
        advanceDays: Number(values.advanceDays),
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
      setServerError(payload?.error?.message ?? 'Could not create the facility.');
      return;
    }
    toast.success('Facility created.');
    dialog?.complete();
    router.push(`/admin/facilities?query=${encodeURIComponent(values.name)}`);
    router.refresh();
  });

  return (
    <form
      data-testid="facility-create-form"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4 "
    >
      {serverError !== null ? (
        <p
          data-testid="facility-create-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4">
        <FormField
          label="Name"
          htmlFor="facility-create-name"
          error={errors.name?.message ?? ''}
          required
        >
          <input
            data-testid="facility-create-name"
            type="text"
            required
            className={INPUT_CLASS}
            {...register('name')}
          />
        </FormField>
      </div>
      <FormField
        label="Description"
        htmlFor="facility-create-description"
        hint="Shown to residents on the facility page."
      >
        <textarea
          data-testid="facility-create-description"
          rows={3}
          className={TEXTAREA_CLASS}
          {...register('description')}
        />
      </FormField>
      <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
        <FormField label="Seats per slot" htmlFor="facility-create-capacity">
          <input
            data-testid="facility-create-capacity"
            type="number"
            min={1}
            className={INPUT_CLASS}
            {...register('capacity')}
          />
        </FormField>
        <FormField label="Slot length (minutes)" htmlFor="facility-create-slot">
          <input
            data-testid="facility-create-slot-minutes"
            type="number"
            min={5}
            className={INPUT_CLASS}
            {...register('slotMinutes')}
          />
        </FormField>
        <FormField label="Quota period" htmlFor="facility-create-quota-kind">
          <Select
            icon={SelectIconCalendarDays}
            data-testid="facility-create-quota-kind"
            className={INPUT_CLASS}
            {...register('quotaKind')}
          >
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
          </Select>
        </FormField>
        <FormField label="Quota slots per period" htmlFor="facility-create-quota-limit">
          <input
            data-testid="facility-create-quota-limit"
            type="number"
            min={0}
            className={INPUT_CLASS}
            {...register('quotaLimit')}
          />
        </FormField>
        <FormField label="Advance booking days" htmlFor="facility-create-advance">
          <input
            data-testid="facility-create-advance-days"
            type="number"
            min={0}
            className={INPUT_CLASS}
            {...register('advanceDays')}
          />
        </FormField>
      </div>
      <fieldset className="flex min-w-0 flex-col gap-2 border-t border-border pt-4">
        <legend className="text-body font-medium text-foreground">Open days</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {DAYS.map((day) => (
            <label key={day.key} className="flex items-center gap-2 text-body text-foreground">
              <input
                data-testid={`facility-create-day-${day.key}`}
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
      <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
        <FormField label="Opens" htmlFor="facility-create-open-start" className="min-w-0">
          <input
            data-testid="facility-create-open-start"
            type="time"
            className={INPUT_CLASS}
            {...register('openStart')}
          />
        </FormField>
        <FormField
          label="Closes"
          htmlFor="facility-create-open-end"
          hint="00:00 means midnight at the end of the day."
          className="min-w-0"
        >
          <input
            data-testid="facility-create-open-end"
            type="time"
            className={INPUT_CLASS}
            {...register('openEnd')}
          />
        </FormField>
        <FormField
          label="Break start (optional)"
          htmlFor="facility-create-break-start"
          className="min-w-0"
        >
          <input
            data-testid="facility-create-break-start"
            type="time"
            className={INPUT_CLASS}
            {...register('breakStart')}
          />
        </FormField>
        <FormField
          label="Break end (optional)"
          htmlFor="facility-create-break-end"
          className="min-w-0"
        >
          <input
            data-testid="facility-create-break-end"
            type="time"
            className={INPUT_CLASS}
            {...register('breakEnd')}
          />
        </FormField>
      </div>
      <FormActions
        onCancel={() => (dialog ? dialog.requestClose() : router.push('/admin/facilities'))}
        pending={isSubmitting}
      >
        <Button data-testid="facility-create-submit" type="submit" loading={isSubmitting}>
          Create facility
        </Button>
      </FormActions>
    </form>
  );
}
