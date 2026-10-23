'use client';
import { FormActions } from '@/shared/ui/FormActions';

import { useFormDialog } from '@/shared/ui';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, deniedCopy, firstOf, useToast } from '@/shared/ui';
import {
  PaymentSlipUploader,
  type SlipUpload,
} from '@/modules/billing-payments/ui/PaymentSlipUploader';
import {
  paymentSubmitFormSchema,
  type PaymentSubmitFormValues,
} from '@/modules/billing-payments/ui/paymentFormSchemas';

interface ErrorPayload {
  error?: { code?: string; message?: string };
}

function submitErrorCopy(code: string | undefined, fallback: string): string {
  if (code === 'PENDING_PAYMENT_EXISTS') {
    return 'A slip is already awaiting review for this invoice. Wait for the review before submitting again.';
  }
  return firstOf(code, fallback, deniedCopy('This submission is not available.'));
}

export function PaymentSubmitForm({
  invoiceId,
  onSubmitted,
}: {
  invoiceId: string;
  onSubmitted: () => void;
}) {
  const { toast } = useToast();
  const [slip, setSlip] = useState<SlipUpload | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<PaymentSubmitFormValues>({
    resolver: zodResolver(paymentSubmitFormSchema),
    defaultValues: { imageId: '' },
  });

  const dialog = useFormDialog(isSubmitting);

  function onSlipChange(next: SlipUpload | null): void {
    setSlip(next);
    dialog?.markDirty();
    setValue('imageId', next?.imageId ?? '', { shouldValidate: true });
  }

  const onSubmit = handleSubmit(
    async (values) => {
      setServerError(null);
      const response = await fetch(`/api/invoices/${invoiceId}/submissions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ imageId: values.imageId }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
        setServerError(
          submitErrorCopy(
            payload?.error?.code,
            payload?.error?.message ?? 'Could not submit the payment slip.',
          ),
        );
        return;
      }
      toast.success('Payment slip submitted.');
      dialog?.complete();
      setSlip(null);
      setValue('imageId', '');
      onSubmitted();
    },
    () => {
      document.getElementById('payment-submit-upload-anchor')?.focus();
    },
  );

  return (
    <form
      data-testid="payment-submit-form"
      onSubmit={onSubmit}
      noValidate
      className="flex min-w-0 flex-col gap-3"
    >
      {serverError !== null ? (
        <p
          data-testid="payment-submit-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      {errors.imageId !== undefined ? (
        <p
          data-testid="payment-submit-missing"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {errors.imageId.message}
        </p>
      ) : null}
      <span id="payment-submit-upload-anchor" tabIndex={-1} className="outline-none" />
      <PaymentSlipUploader slip={slip} onChange={onSlipChange} testIdPrefix="payment-submit" />
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button data-testid="payment-submit-button" type="submit" loading={isSubmitting} size="sm">
          Submit slip
        </Button>
      </FormActions>
    </form>
  );
}
