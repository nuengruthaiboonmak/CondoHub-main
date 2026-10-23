'use client';
import { FormActions } from '@/shared/ui/FormActions';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  FormField,
  INPUT_CLASS,
  serverErrorMessage,
  useFormDialog,
  useToast,
} from '@/shared/ui';
const schema = z.object({
  amount: z
    .string()
    .regex(/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/, 'Enter a positive amount with up to 2 decimals.')
    .refine((value) => /[1-9]/.test(value), 'Monthly rent must be greater than zero.'),
  effectiveMonth: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, 'Choose a month.'),
});
const invoiceSchema = z.object({
  cycle: z.string().regex(/^20\d{2}-(0[1-9]|1[0-2])$/, 'Choose a billing month.'),
});
type Values = z.infer<typeof schema>;
export function RentSettingsForm({
  roomId,
  tenancyId,
  currentMonth,
  value,
}: {
  roomId: string;
  tenancyId: string;
  currentMonth: string;
  value: { id: string; amount: string; effectiveMonth: string } | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: value?.amount ?? '',
      effectiveMonth:
        value && value.effectiveMonth >= currentMonth ? value.effectiveMonth : currentMonth,
    },
  });
  const dialog = useFormDialog(isSubmitting);
  const submit = handleSubmit(async (values) => {
    setError(null);
    const [whole, minor = ''] = values.amount.split('.');
    try {
      const response = await fetch(`/api/rooms/${roomId}/rent-settings`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          tenancyId,
          amount: { amount: `${whole}.${minor.padEnd(2, '0')}`, currency: 'THB' },
          effectiveMonth: values.effectiveMonth,
          expectedId: value?.id ?? null,
        }),
      });
      if (!response.ok) {
        setError(
          serverErrorMessage(
            await response.json().catch(() => null),
            'Could not save monthly rent.',
          ),
        );
        return;
      }
      toast.success('Monthly rent saved.');
      dialog?.complete();
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and retry.');
    }
  });
  return (
    <form
      data-testid="rent-settings-form"
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-5"
    >
      {error ? (
        <p
          role="alert"
          data-testid="rent-settings-error"
          className="text-body text-danger-foreground"
        >
          {error}
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Monthly rent (THB)"
          htmlFor="rent-settings-amount"
          required
          error={errors.amount?.message ?? ''}
        >
          <input
            data-testid="rent-settings-amount"
            inputMode="decimal"
            className={INPUT_CLASS}
            {...register('amount')}
          />
        </FormField>
        <FormField
          label="Effective from"
          htmlFor="rent-settings-month"
          required
          error={errors.effectiveMonth?.message ?? ''}
        >
          <input
            data-testid="rent-settings-month"
            type="month"
            min={currentMonth}
            className={INPUT_CLASS}
            {...register('effectiveMonth')}
          />
        </FormField>
      </div>
      <p className="text-small leading-relaxed text-muted-foreground">
        Rent is billed monthly and is due on the 5th. Rate changes apply from the chosen month.
        Issued invoices keep their original amount.
      </p>
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button
          type="submit"
          loading={isSubmitting}
          data-testid="rent-settings-save"
          className="self-start"
        >
          Save monthly rent
        </Button>
      </FormActions>
    </form>
  );
}
export function RentInvoiceForm({
  roomId,
  tenancyId,
  currentMonth,
  admin,
}: {
  roomId: string;
  tenancyId: string;
  currentMonth: string;
  admin: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof invoiceSchema>>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: { cycle: currentMonth },
  });
  const [error, setError] = useState<string | null>(null);
  const dialog = useFormDialog(isSubmitting);
  const submit = handleSubmit(async ({ cycle }) => {
    setError(null);
    try {
      const response = await fetch(`/api/rooms/${roomId}/rent-invoices`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ tenancyId, cycle }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(serverErrorMessage(body, 'Could not create the rent invoice.'));
        return;
      }
      if (body.data.invoiceId) {
        toast.success('Rent invoice ready.');
        router.push(`${admin ? '/admin/billing/invoices' : '/invoices'}/${body.data.invoiceId}`);
      } else {
        toast.info('This month needs a turnover review.');
        router.push(admin ? '/admin/billing/turnover-reviews' : '/invoices/turnover-reviews');
      }
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and retry.');
    }
  });
  return (
    <form
      data-testid="rent-invoice-form"
      noValidate
      onSubmit={submit}
      className="flex flex-col gap-4"
    >
      {error ? (
        <p
          role="alert"
          data-testid="rent-invoice-error"
          className="text-body text-danger-foreground"
        >
          {error}
        </p>
      ) : null}
      <FormField
        label="Billing month"
        htmlFor="rent-invoice-month"
        required
        error={errors.cycle?.message ?? ''}
      >
        <input
          data-testid="rent-invoice-month"
          type="month"
          min={currentMonth}
          required
          className={INPUT_CLASS}
          {...register('cycle')}
        />
      </FormField>
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button
          type="submit"
          loading={isSubmitting}
          data-testid="rent-invoice-create"
          className="self-start"
        >
          Create rent invoice
        </Button>
      </FormActions>
    </form>
  );
}
