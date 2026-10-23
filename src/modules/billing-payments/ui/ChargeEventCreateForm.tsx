'use client';
import { FormActions } from '@/shared/ui/FormActions';

import { useFormDialog } from '@/shared/ui/FormDialog';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Button, FormField, useToast } from '@/shared/ui';
import { INPUT_CLASS } from '@/shared/ui';
import {
  chargeEventCreateSchema,
  type ChargeEventCreateValues,
} from '@/modules/billing-payments/ui/chargeEventFormSchema';

const FIELD_ORDER: Array<keyof ChargeEventCreateValues> = [
  'eventEffectiveDate',
  'configuredAmount',
  'contextNote',
];

interface ErrorPayload {
  error?: { code?: string; message?: string };
}

interface CreatedPayload {
  data?: { id?: string };
}

export function ChargeEventCreateForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<ChargeEventCreateValues>({
    resolver: zodResolver(chargeEventCreateSchema),
    defaultValues: { eventEffectiveDate: '', configuredAmount: '', contextNote: '' },
  });

  const onInvalid = (fieldErrors: typeof errors) => {
    const first = FIELD_ORDER.find((name) => fieldErrors[name] !== undefined);
    if (first !== undefined) setFocus(first);
  };

  const dialog = useFormDialog(isSubmitting);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    setConflict(false);
    const amount = values.configuredAmount?.trim() ?? '';
    const note = values.contextNote?.trim() ?? '';
    const response = await fetch('/api/admin/billing/common-fee-events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventEffectiveDate: values.eventEffectiveDate,
        status: 'OPEN',
        ...(amount === '' ? {} : { configuredAmount: { amount, currency: 'THB' } }),
        ...(note === '' ? {} : { chargeContext: { note } }),
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
      if (response.status === 401 || response.status === 403) {
        setServerError('Your session cannot create billing events. Sign in as a system admin.');
        return;
      }
      if (response.status === 409) setConflict(true);
      setServerError(payload?.error?.message ?? 'Could not create the billing event.');
      return;
    }
    const payload = (await response.json().catch(() => null)) as CreatedPayload | null;
    const createdId = payload?.data?.id;
    if (typeof createdId !== 'string' || createdId === '') {
      setServerError('The event was created but the response was empty. Reload the list.');
      return;
    }
    toast.success('Billing event created.');
    dialog?.complete();
    router.push(`/admin/billing/events/${createdId}`);
    router.refresh();
  }, onInvalid);

  return (
    <form
      data-testid="charge-event-create-form"
      onSubmit={onSubmit}
      noValidate
      className="flex min-w-0 flex-col gap-4"
    >
      {serverError !== null ? (
        <p
          data-testid="charge-event-create-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      {conflict ? (
        <p
          data-testid="charge-event-create-conflict"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          The event conflicts with an existing record.
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label="Effective date"
          htmlFor="charge-event-create-date"
          required
          error={errors.eventEffectiveDate?.message ?? ''}
        >
          <input
            data-testid="charge-event-create-date"
            type="date"
            className={INPUT_CLASS}
            {...register('eventEffectiveDate')}
          />
        </FormField>
        <FormField
          label="Amount (THB, optional)"
          htmlFor="charge-event-create-amount"
          error={errors.configuredAmount?.message ?? ''}
        >
          <input
            data-testid="charge-event-create-amount"
            type="text"
            inputMode="decimal"
            placeholder="3000.00"
            className={INPUT_CLASS}
            {...register('configuredAmount')}
          />
        </FormField>
      </div>
      <FormField
        label="Note (optional)"
        htmlFor="charge-event-create-note"
        error={errors.contextNote?.message ?? ''}
      >
        <input
          data-testid="charge-event-create-note"
          type="text"
          maxLength={500}
          className={INPUT_CLASS}
          {...register('contextNote')}
        />
      </FormField>
      <FormActions
        onCancel={() => (dialog ? dialog.requestClose() : router.push('/admin/billing/events'))}
        pending={isSubmitting}
        cancelTestId="charge-event-create-cancel"
      >
        <Button data-testid="charge-event-create-submit" type="submit" loading={isSubmitting}>
          Create event
        </Button>
      </FormActions>
    </form>
  );
}
