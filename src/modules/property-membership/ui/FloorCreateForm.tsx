'use client';
import { FormActions } from '@/shared/ui/FormActions';

import { useFormDialog } from '@/shared/ui/FormDialog';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Button, FormField, INPUT_CLASS, serverErrorMessage, useToast } from '@/shared/ui';

const createSchema = z.object({
  label: z.string().trim().min(1, 'Label is required.').max(255),
});

type CreateValues = z.infer<typeof createSchema>;

export function FloorCreateForm({ buildingId }: { buildingId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { label: '' },
  });

  const dialog = useFormDialog(isSubmitting);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const response = await fetch('/api/admin/floors', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          buildingId,
          label: values.label,
        }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setServerError(serverErrorMessage(payload, 'Could not create the floor.'));
        return;
      }
      toast.success('Floor created.');
      dialog?.complete();
      reset();
      router.refresh();
    } catch {
      setServerError('Could not reach the server. Check your connection and try again.');
    }
  });

  return (
    <form
      data-testid="floor-create-form"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-5"
    >
      {serverError !== null ? (
        <p
          data-testid="floor-create-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <div className="flex flex-col gap-4">
        <FormField
          label="Floor name"
          htmlFor="floor-create-label"
          error={errors.label?.message ?? ''}
          required
        >
          <input
            data-testid="floor-create-label"
            type="text"
            required
            placeholder="e.g. Ground floor or 12"
            className={INPUT_CLASS}
            {...register('label')}
          />
        </FormField>
      </div>
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button data-testid="floor-create-submit" type="submit" loading={isSubmitting}>
          Create floor
        </Button>
      </FormActions>
    </form>
  );
}
