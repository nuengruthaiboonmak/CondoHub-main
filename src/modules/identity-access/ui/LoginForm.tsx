'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, FormField, INPUT_CLASS } from '@/shared/ui';
import { authClient } from '@/modules/identity-access/ui/authClient';

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required.'),
  password: z.string().min(1, 'Password is required.'),
});

type LoginValues = z.infer<typeof loginSchema>;

function safeReturnUrl(value: string | null): string {
  if (value === null || value === '') return '/';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//')) return '/';
  return value;
}

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({ resolver: zodResolver(loginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const result = await authClient.signIn.username({
      username: values.username,
      password: values.password,
    });
    if (result.error !== null) {
      setServerError('Invalid username or password.');
      return;
    }
    const session = await authClient.getSession();
    const user = session.data?.user as
      | { mustChangePassword?: unknown; accountStatus?: unknown }
      | undefined;
    if (user?.accountStatus === 'SUSPENDED') {
      await authClient.signOut();
      setServerError('This account is inactive. Contact your administrator to reactivate it.');
      return;
    }
    if (user?.mustChangePassword === true) {
      router.push('/change-password');
      return;
    }
    router.push(safeReturnUrl(searchParams.get('returnUrl')));
    router.refresh();
  });

  return (
    <form data-testid="login-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-title font-semibold tracking-tight text-foreground">Sign in</h2>
        <p className="text-small leading-6 text-muted-foreground">
          Use your username and password.
        </p>
      </div>
      {serverError !== null ? (
        <p
          data-testid="login-error"
          role="alert"
          className="rounded-md border border-danger-border bg-danger px-3 py-2 text-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <FormField
        label="Username"
        htmlFor="login-username"
        required
        {...(errors.username?.message !== undefined ? { error: errors.username.message } : {})}
      >
        <input
          data-testid="login-username"
          type="text"
          autoComplete="username"
          required
          placeholder="Your username"
          className={INPUT_CLASS}
          {...register('username')}
        />
      </FormField>
      <FormField
        label="Password"
        htmlFor="login-password"
        required
        {...(errors.password?.message !== undefined ? { error: errors.password.message } : {})}
      >
        <input
          data-testid="login-password"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Your password"
          className={INPUT_CLASS}
          {...register('password')}
        />
      </FormField>
      <Button data-testid="login-submit" type="submit" loading={isSubmitting}>
        Sign in
      </Button>
    </form>
  );
}
