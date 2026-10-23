'use client';
import { FormActions } from '@/shared/ui/FormActions';

import { useFormDialog } from '@/shared/ui/FormDialog';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Button, FormField, useToast } from '@/shared/ui';
import { INPUT_CLASS } from '@/shared/ui';

const closureSchema = z.object({
  startsAt: z.string().min(1, 'Start is required.'),
  endsAt: z.string().min(1, 'End is required.'),
  reason: z.string().trim().min(1, 'A reason is required.').max(2000),
});

type ClosureValues = z.infer<typeof closureSchema>;

interface ErrorPayload {
  error?: { message?: string };
}

export function ClosureCreateForm({ facilityId }: { facilityId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ClosureValues>({ resolver: zodResolver(closureSchema) });

  const dialog = useFormDialog(isSubmitting);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const startsAt = new Date(values.startsAt);
    const endsAt = new Date(values.endsAt);
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
      setServerError('The closure times are invalid.');
      return;
    }
    if (endsAt.getTime() <= startsAt.getTime()) {
      setServerError('The closure end must be after its start.');
      return;
    }
    const response = await fetch(`/api/admin/facilities/${facilityId}/closures`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        reason: values.reason,
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
      setServerError(payload?.error?.message ?? 'Could not add the closure.');
      return;
    }
    toast.success('Closure added.');
    dialog?.complete();
    reset();
    router.refresh();
  });

  return (
    <form
      data-testid="closure-create-form"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4 "
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h3 className="text-body font-semibold text-foreground">Add a closure</h3>
        <p className="text-small leading-small text-muted-foreground">
          Closed windows remove slots from booking until the closure ends.
        </p>
      </div>
      {serverError !== null ? (
        <p
          data-testid="closure-create-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormField
          label="Starts at"
          htmlFor="closure-create-start"
          error={errors.startsAt?.message ?? ''}
        >
          <input
            data-testid="closure-create-start"
            type="datetime-local"
            className={INPUT_CLASS}
            {...register('startsAt')}
          />
        </FormField>
        <FormField
          label="Ends at"
          htmlFor="closure-create-end"
          error={errors.endsAt?.message ?? ''}
        >
          <input
            data-testid="closure-create-end"
            type="datetime-local"
            className={INPUT_CLASS}
            {...register('endsAt')}
          />
        </FormField>
      </div>
      <FormField
        label="Reason"
        htmlFor="closure-create-reason"
        error={errors.reason?.message ?? ''}
      >
        <input
          data-testid="closure-create-reason"
          type="text"
          className={INPUT_CLASS}
          {...register('reason')}
        />
      </FormField>
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button data-testid="closure-create-submit" type="submit" loading={isSubmitting}>
          Add closure
        </Button>
      </FormActions>
    </form>
  );
}
