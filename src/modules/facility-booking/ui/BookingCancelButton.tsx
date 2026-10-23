'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, Dialog, FormField, useToast } from '@/shared/ui';
import { CHECKBOX_CLASS, INPUT_CLASS } from '@/shared/ui';

const cancelSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required.').max(2000),
  refundQuota: z.boolean().optional(),
});

type CancelValues = z.infer<typeof cancelSchema>;

interface ErrorPayload {
  error?: { message?: string };
}

export function BookingCancelButton({
  bookingId,
  slotId,
  startsAt,
  testId,
  admin,
}: {
  bookingId: string;
  slotId: string;
  startsAt: string;
  testId: string;
  admin?: boolean | undefined;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CancelValues>({ resolver: zodResolver(cancelSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const response = await fetch(`/api/bookings/${bookingId}/slots/${slotId}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        reason: values.reason,
        ...(admin === true ? { refundQuota: values.refundQuota ?? false } : {}),
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
      setServerError(payload?.error?.message ?? 'Could not cancel the slot.');
      return;
    }
    toast.success('Slot cancelled.');
    setOpen(false);
    reset();
    router.refresh();
  });

  const when = new Date(startsAt).toLocaleString('en-US', { timeZone: 'Asia/Bangkok' });

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        data-testid={`${testId}-open`}
        onClick={() => setOpen(true)}
      >
        Cancel
      </Button>
      <Dialog
        open={open}
        busy={isSubmitting}
        onClose={() => setOpen(false)}
        title="Cancel this slot"
        description={
          admin === true
            ? `Cancelling ${when} as admin. Choose whether the room quota is refunded.`
            : `Cancelling ${when}. Resident cancellations release the seat but keep the quota used.`
        }
        testId={testId}
        size="sm"
        actions={
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isSubmitting}
              onClick={() => setOpen(false)}
            >
              Keep slot
            </Button>
            <Button
              data-testid={`${testId}-submit`}
              type="submit"
              form={`${testId}-form`}
              size="sm"
              variant="destructive"
              loading={isSubmitting}
            >
              Confirm cancel
            </Button>
          </>
        }
      >
        <form
          id={`${testId}-form`}
          onSubmit={onSubmit}
          noValidate
          className="flex min-w-0 flex-col gap-3"
        >
          {serverError !== null ? (
            <p
              data-testid={`${testId}-error`}
              role="alert"
              className="text-body leading-body font-medium text-danger-foreground"
            >
              {serverError}
            </p>
          ) : null}
          <FormField
            label="Reason"
            htmlFor={`${testId}-reason`}
            error={errors.reason?.message ?? ''}
          >
            <input
              data-testid={`${testId}-reason`}
              type="text"
              className={INPUT_CLASS}
              {...register('reason')}
            />
          </FormField>
          {admin === true ? (
            <label className="flex items-center gap-2 text-body text-foreground">
              <input
                data-testid={`${testId}-refund`}
                type="checkbox"
                className={CHECKBOX_CLASS}
                {...register('refundQuota')}
              />
              Refund quota for this slot
            </label>
          ) : null}
        </form>
      </Dialog>
    </>
  );
}
