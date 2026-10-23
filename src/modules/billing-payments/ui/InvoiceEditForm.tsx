'use client';
import { FormActions } from '@/shared/ui/FormActions';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, FormField, useFormDialog } from '@/shared/ui';
import { useToast } from '@/shared/ui';
import { INPUT_CLASS } from '@/shared/ui';
import {
  invoiceEditFormSchema,
  type InvoiceEditFormValues,
} from '@/modules/billing-payments/ui/paymentFormSchemas';

interface ErrorPayload {
  error?: { code?: string; message?: string };
}

export function InvoiceEditForm({
  invoiceId,
  version,
  currentTotal,
  onEdited,
}: {
  invoiceId: string;
  version: number;
  currentTotal: string;
  onEdited: () => void;
}) {
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<InvoiceEditFormValues>({
    resolver: zodResolver(invoiceEditFormSchema),
    defaultValues: { total: currentTotal, reason: '', expectedVersion: version },
  });
  const dialog = useFormDialog(isSubmitting);
  const onSubmit = handleSubmit(
    async (values) => {
      setServerError(null);
      setConflict(false);
      const trimmedReason = values.reason?.trim() ?? '';
      const response = await fetch(`/api/invoices/${invoiceId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          total: { amount: values.total.trim(), currency: 'THB' },
          expectedVersion: version,
          ...(trimmedReason === '' ? {} : { reason: trimmedReason }),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
        const code = payload?.error?.code;
        if (code === 'VERSION_CONFLICT') {
          setConflict(true);
          return;
        }
        if (code === 'RESOURCE_NOT_FOUND' || code === 'ACCESS_DENIED') {
          setServerError('This edit is not available.');
          return;
        }
        setServerError(payload?.error?.message ?? 'Could not update the invoice total.');
        return;
      }
      toast.success('Invoice total updated.');
      dialog?.complete();
      onEdited();
    },
    (invalid) => {
      if (invalid.total !== undefined) setFocus('total');
      else if (invalid.reason !== undefined) setFocus('reason');
    },
  );
  return (
    <form
      data-testid="invoice-edit-form"
      onSubmit={onSubmit}
      noValidate
      className="flex min-w-0 flex-col gap-4"
    >
      {serverError !== null ? (
        <p
          data-testid="invoice-edit-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      {conflict ? (
        <p
          data-testid="invoice-edit-conflict"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          Someone changed this invoice first. Reload the page to see the latest total.
        </p>
      ) : null}
      <FormField
        label="New total (THB)"
        htmlFor="invoice-edit-total"
        error={errors.total?.message ?? ''}
      >
        <input
          data-testid="invoice-edit-total"
          type="text"
          inputMode="decimal"
          placeholder="3000.00"
          className={INPUT_CLASS}
          {...register('total')}
        />
      </FormField>
      <FormField
        label="Reason (optional)"
        htmlFor="invoice-edit-reason"
        error={errors.reason?.message ?? ''}
      >
        <input
          data-testid="invoice-edit-reason"
          type="text"
          maxLength={2000}
          className={INPUT_CLASS}
          {...register('reason')}
        />
      </FormField>
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button data-testid="invoice-edit-submit" type="submit" loading={isSubmitting} size="sm">
          Update total
        </Button>
      </FormActions>
    </form>
  );
}
