'use client';
import { FormActions } from '@/shared/ui/FormActions';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, CHECKBOX_CLASS, FormField, INPUT_CLASS, serverErrorMessage } from '@/shared/ui';

const usernameRule = z
  .string()
  .trim()
  .min(1, 'Username is required.')
  .max(30)
  .regex(/^[a-z0-9._]+$/, 'Use lowercase letters, digits, dots, and underscores.');

const provisionSchema = z.object({
  username: usernameRule,
  email: z.string().trim().email('Enter a valid email.').max(255),
  name: z.string().trim().min(1, 'Name is required.').max(255),
  phone: z.string().trim().max(32).optional(),
  isSystemAdmin: z.boolean(),
});

type ProvisionValues = z.infer<typeof provisionSchema>;

interface ProvisionPayload {
  data?: { userId?: unknown; tempPassword?: unknown; created?: unknown };
}

export function extractProvisionedAccount(payload: unknown): {
  userId: string;
  tempPassword: string | null;
} {
  if (typeof payload !== 'object' || payload === null) return { userId: '', tempPassword: null };
  const data = (payload as ProvisionPayload).data;
  if (typeof data !== 'object' || data === null) return { userId: '', tempPassword: null };
  return {
    userId: typeof data.userId === 'string' ? data.userId : '',
    tempPassword: typeof data.tempPassword === 'string' ? data.tempPassword : null,
  };
}

export function UserProvisionForm({
  onDone,
  onCancel,
  onPendingChange,
}: {
  onDone: (userId: string, tempPassword: string | null) => void;
  onCancel: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ProvisionValues>({
    resolver: zodResolver(provisionSchema),
    defaultValues: { username: '', email: '', name: '', phone: '', isSystemAdmin: false },
  });

  useEffect(() => {
    onPendingChange(isSubmitting);
    return () => onPendingChange(false);
  }, [isSubmitting, onPendingChange]);
  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: values.username,
        email: values.email,
        name: values.name,
        ...(values.phone === '' || values.phone === undefined ? {} : { phone: values.phone }),
        isSystemAdmin: values.isSystemAdmin,
      }),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      setServerError(serverErrorMessage(payload, 'Could not provision the user.'));
      return;
    }
    const { userId, tempPassword } = extractProvisionedAccount(payload);
    onDone(userId, tempPassword);
  });

  return (
    <form
      data-testid="admin-users-provision-form"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
    >
      {serverError !== null ? (
        <p
          data-testid="admin-users-provision-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <FormField
        label="Username"
        htmlFor="admin-users-provision-username"
        error={errors.username?.message ?? ''}
        hint="Lowercase letters, digits, dots, and underscores."
        required
      >
        <input
          data-testid="admin-users-provision-username"
          type="text"
          required
          autoComplete="off"
          className={INPUT_CLASS}
          {...register('username')}
        />
      </FormField>
      <FormField
        label="Email"
        htmlFor="admin-users-provision-email"
        error={errors.email?.message ?? ''}
        required
      >
        <input
          data-testid="admin-users-provision-email"
          type="email"
          required
          autoComplete="off"
          className={INPUT_CLASS}
          {...register('email')}
        />
      </FormField>
      <FormField
        label="Full name"
        htmlFor="admin-users-provision-name"
        error={errors.name?.message ?? ''}
        required
      >
        <input
          data-testid="admin-users-provision-name"
          type="text"
          required
          autoComplete="off"
          className={INPUT_CLASS}
          {...register('name')}
        />
      </FormField>
      <FormField
        label="Phone (optional)"
        htmlFor="admin-users-provision-phone"
        error={errors.phone?.message ?? ''}
      >
        <input
          data-testid="admin-users-provision-phone"
          type="tel"
          autoComplete="off"
          className={INPUT_CLASS}
          {...register('phone')}
        />
      </FormField>
      <label className="flex items-center gap-2 text-body leading-body text-foreground">
        <input
          data-testid="admin-users-provision-admin"
          type="checkbox"
          className={CHECKBOX_CLASS}
          {...register('isSystemAdmin')}
        />
        System admin
      </label>
      <FormActions onCancel={onCancel} pending={isSubmitting}>
        <Button data-testid="admin-users-provision-submit" type="submit" loading={isSubmitting}>
          Provision user
        </Button>
      </FormActions>
    </form>
  );
}
