'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Button, FormField, INPUT_CLASS, useToast } from '@/shared/ui';
import { authClient } from '@/modules/identity-access/ui/authClient';

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required.'),
    newPassword: z.string().min(12, 'New password must be at least 12 characters.'),
    confirmPassword: z.string().min(1, 'Please confirm the new password.'),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

export default function ChangePasswordForm({
  mode = 'first-login',
  onCancel,
  onPendingChange,
}: {
  mode?: 'first-login' | 'account';
  onCancel?: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({ resolver: zodResolver(changePasswordSchema) });

  useEffect(() => {
    onPendingChange?.(isSubmitting);
    return () => onPendingChange?.(false);
  }, [isSubmitting, onPendingChange]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      setServerError(null);
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { code?: string; message?: string; fieldErrors?: Record<string, string[]> };
        } | null;
        const fieldMessage = payload?.error?.fieldErrors?.newPassword?.[0];
        setServerError(fieldMessage ?? payload?.error?.message ?? 'Password change failed.');
        return;
      }
      toast.success('Password changed.', { description: 'Sign in with your new password.' });
      await authClient.signOut();
      router.push('/login');
      router.refresh();
    } catch {
      setServerError('Could not reach the server. Check your connection and try again.');
    }
  });

  return (
    <form
      data-testid="change-password-form"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-5"
    >
      {mode === 'first-login' ? (
        <div className="flex flex-col gap-1">
          <h2 className="text-title font-semibold tracking-tight text-foreground">
            Change password
          </h2>
          <p className="text-small leading-6 text-muted-foreground">
            Your password must be at least 12 characters and differ from your username and temporary
            password.
          </p>
        </div>
      ) : null}
      {serverError !== null ? (
        <p
          data-testid="change-password-error"
          role="alert"
          className="rounded-md border border-danger-border bg-danger px-3 py-2 text-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <FormField
        label="Current password"
        htmlFor="change-current"
        required
        {...(errors.currentPassword?.message !== undefined
          ? { error: errors.currentPassword.message }
          : {})}
      >
        <input
          data-testid="change-password-current"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Current password"
          className={INPUT_CLASS}
          {...register('currentPassword')}
        />
      </FormField>
      <FormField
        label="New password"
        htmlFor="change-new"
        required
        {...(errors.newPassword?.message !== undefined
          ? { error: errors.newPassword.message }
          : {})}
      >
        <input
          data-testid="change-password-new"
          type="password"
          autoComplete="new-password"
          required
          placeholder="At least 12 characters"
          className={INPUT_CLASS}
          {...register('newPassword')}
        />
      </FormField>
      <FormField
        label="Confirm new password"
        htmlFor="change-confirm"
        required
        {...(errors.confirmPassword?.message !== undefined
          ? { error: errors.confirmPassword.message }
          : {})}
      >
        <input
          data-testid="change-password-confirm"
          type="password"
          autoComplete="new-password"
          required
          placeholder="Repeat the new password"
          className={INPUT_CLASS}
          {...register('confirmPassword')}
        />
      </FormField>
      <div
        className={
          mode === 'account'
            ? 'flex flex-wrap items-center justify-end gap-2 border-t border-border pt-5'
            : 'grid'
        }
      >
        {onCancel ? (
          <Button
            data-testid="account-password-cancel"
            variant="secondary"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            Cancel
          </Button>
        ) : null}
        <Button data-testid="change-password-submit" type="submit" loading={isSubmitting}>
          Change password
        </Button>
      </div>
    </form>
  );
}
