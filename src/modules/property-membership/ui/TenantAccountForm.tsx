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
  username: z
    .string()
    .trim()
    .min(3)
    .max(30)
    .regex(/^[a-z0-9._]+$/, 'Use lowercase letters, digits, dots, and underscores.'),
  name: z.string().trim().min(1, 'Enter the tenant name.').max(255),
  email: z.string().trim().email('Enter a valid email address.').max(255),
});
type Values = z.infer<typeof schema>;
export function TenantAccountForm({ roomId }: { roomId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ username: string; tempPassword: string | null } | null>(
    null,
  );
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });
  const dialog = useFormDialog(isSubmitting);
  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      const response = await fetch(`/api/rooms/${roomId}/accounts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ ...values, targetRole: 'TENANT' }),
      });
      const body = await response.json();
      if (!response.ok) {
        setError(serverErrorMessage(body, 'Could not add the tenant account.'));
        return;
      }
      setResult({
        username: values.username,
        tempPassword: body.data.created ? body.data.tempPassword : null,
      });
      toast.success('Tenant added.');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and retry.');
    }
  });
  if (result)
    return (
      <div className="flex flex-col gap-5" data-testid="tenant-account-result">
        <p className="text-body text-body-secondary">
          The tenant can sign in to view this room, pay rent, report maintenance, book facilities,
          and use room chat.
        </p>
        {result.tempPassword ? (
          <>
            <FormField label="Username" htmlFor="tenant-account-result-username">
              <input readOnly value={result.username} className={INPUT_CLASS} />
            </FormField>
            <FormField
              label="Temporary password"
              htmlFor="tenant-account-result-password"
              hint="Share these sign-in details with the tenant. They must change the password at first login."
            >
              <input
                data-testid="tenant-account-password"
                readOnly
                value={result.tempPassword}
                className={INPUT_CLASS}
              />
            </FormField>
          </>
        ) : (
          <p className="text-body">
            An existing account was added. The tenant keeps their current sign-in details.
          </p>
        )}
        <Button
          onClick={() => dialog?.complete()}
          data-testid="tenant-account-done"
          className="self-end"
        >
          Done
        </Button>
      </div>
    );
  return (
    <form
      noValidate
      onSubmit={submit}
      data-testid="tenant-account-form"
      className="flex flex-col gap-5"
    >
      {error ? (
        <p role="alert" className="text-body text-danger-foreground">
          {error}
        </p>
      ) : null}
      <FormField
        label="Username"
        htmlFor="tenant-account-username"
        required
        error={errors.username?.message ?? ''}
      >
        <input
          data-testid="tenant-account-username"
          autoComplete="off"
          className={INPUT_CLASS}
          {...register('username')}
        />
      </FormField>
      <FormField
        label="Full name"
        htmlFor="tenant-account-name"
        required
        error={errors.name?.message ?? ''}
      >
        <input data-testid="tenant-account-name" className={INPUT_CLASS} {...register('name')} />
      </FormField>
      <FormField
        label="Email"
        htmlFor="tenant-account-email"
        required
        error={errors.email?.message ?? ''}
      >
        <input
          data-testid="tenant-account-email"
          type="email"
          className={INPUT_CLASS}
          {...register('email')}
        />
      </FormField>
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button type="submit" loading={isSubmitting} data-testid="tenant-account-submit">
          Create tenant account
        </Button>
      </FormActions>
    </form>
  );
}
