'use client';
import { FormActions } from '@/shared/ui/FormActions';

import { useFormDialog } from '@/shared/ui/FormDialog';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, CHECKBOX_CLASS, FormField, INPUT_CLASS, useToast } from '@/shared/ui';
import { PaymentImageUploader, type SlipUpload } from './PaymentSlipUploader';
import { PaymentImage } from './PaymentImage';

const schema = z.object({
  bankName: z.string().trim().min(1, 'Enter the bank name.').max(120),
  accountName: z.string().trim().min(1, 'Enter the account holder name.').max(200),
  accountNumber: z.string().trim().min(1, 'Enter the account number.').max(80),
});
type Values = z.infer<typeof schema>;
export interface PaymentSettingsValue extends Values {
  id: string;
  qrImageId: string | null;
}

export function PaymentSettingsForm({
  roomId,
  payeeType,
  value,
}: {
  roomId?: string;
  payeeType: 'PROJECT' | 'OWNER';
  value: PaymentSettingsValue | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [upload, setUpload] = useState<SlipUpload | null>(null);
  const [retainedQr, setRetainedQr] = useState(value?.qrImageId ?? null);
  const [fillMissing, setFillMissing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      bankName: value?.bankName ?? '',
      accountName: value?.accountName ?? '',
      accountNumber: value?.accountNumber ?? '',
    },
  });
  const dialog = useFormDialog(isSubmitting || uploading);
  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      const response = await fetch(
        payeeType === 'PROJECT'
          ? '/api/admin/billing/payment-settings'
          : `/api/rooms/${roomId}/payment-settings`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
          body: JSON.stringify({
            ...values,
            payeeType,
            expectedId: value?.id ?? null,
            qrImageId: upload?.imageId ?? retainedQr,
            applyToUnconfiguredInvoices: fillMissing,
          }),
        },
      );
      if (!response.ok) {
        const payload = await response.json();
        setError(payload.error?.message ?? 'Could not save payment details. Retry in a moment.');
        return;
      }
      toast.success('Payment details saved.');
      dialog?.complete();
      router.refresh();
    } catch {
      setError('Could not save payment details. Check your connection and retry.');
    }
  });
  return (
    <form
      data-testid="payment-settings-form"
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-5"
    >
      {error ? (
        <p role="alert" className="text-body text-danger-foreground">
          {error}
        </p>
      ) : null}
      <fieldset disabled={isSubmitting || uploading} className="flex min-w-0 flex-col gap-5">
        <FormField
          label="Bank name"
          htmlFor="payment-settings-bank"
          required
          {...(errors.bankName?.message ? { error: errors.bankName.message } : {})}
        >
          <input
            data-testid="payment-settings-bank"
            className={INPUT_CLASS}
            autoComplete="off"
            {...register('bankName')}
          />
        </FormField>
        <FormField
          label="Account holder name"
          htmlFor="payment-settings-name"
          required
          {...(errors.accountName?.message ? { error: errors.accountName.message } : {})}
        >
          <input
            data-testid="payment-settings-name"
            className={INPUT_CLASS}
            autoComplete="off"
            {...register('accountName')}
          />
        </FormField>
        <FormField
          label="Account number"
          htmlFor="payment-settings-number"
          required
          {...(errors.accountNumber?.message ? { error: errors.accountNumber.message } : {})}
        >
          <input
            data-testid="payment-settings-number"
            className={INPUT_CLASS}
            autoComplete="off"
            {...register('accountNumber')}
          />
        </FormField>
      </fieldset>
      {retainedQr && !upload ? (
        <div className="flex flex-col items-start gap-2">
          <PaymentImage
            imageId={retainedQr}
            alt="Current payment QR code"
            testId="payment-settings-current-qr"
          />
          <Button
            variant="ghost"
            onClick={() => setRetainedQr(null)}
            disabled={uploading || isSubmitting}
          >
            Remove QR code
          </Button>
        </div>
      ) : null}
      <fieldset disabled={isSubmitting} className="min-w-0">
        <PaymentImageUploader
          purpose="qr"
          {...(roomId ? { roomId } : {})}
          projectAccount={payeeType === 'PROJECT'}
          slip={upload}
          onChange={setUpload}
          onBusyChange={setUploading}
          testIdPrefix="payment-settings"
        />
      </fieldset>
      <label className="flex items-start gap-3 text-small leading-relaxed text-body-secondary">
        <input
          type="checkbox"
          className={CHECKBOX_CLASS}
          checked={fillMissing}
          disabled={uploading || isSubmitting}
          data-testid="payment-settings-fill-missing"
          onChange={(event) => setFillMissing(event.target.checked)}
        />
        <span>
          Also fill missing payment details on existing unpaid invoices. Invoices with payment
          submissions or an existing receiving account stay unchanged.
        </span>
      </label>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-small leading-relaxed text-muted-foreground">
          New invoices use these details. Existing receiving accounts are never overwritten.
        </p>
        <FormActions onCancel={dialog?.requestClose} pending={isSubmitting || uploading}>
          <Button
            type="submit"
            loading={isSubmitting}
            disabled={uploading}
            data-testid="payment-settings-save"
          >
            Save payment details
          </Button>
        </FormActions>
      </div>
    </form>
  );
}
