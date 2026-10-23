'use client';
import { FormActions } from '@/shared/ui/FormActions';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import {
  Button,
  FormField,
  INPUT_CLASS,
  serverErrorMessage,
  useFormDialog,
  useToast,
} from '@/shared/ui';

const schema = z.object({ name: z.string().trim().min(1, 'Building name is required.').max(255) });

export function BuildingEditForm({ buildingId, name }: { buildingId: string; name: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { name } });
  const dialog = useFormDialog(isSubmitting);
  const submit = handleSubmit(async (values) => {
    setError(null);
    try {
      const response = await fetch(`/api/admin/buildings/${buildingId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!response.ok) {
        setError(
          serverErrorMessage(
            await response.json().catch(() => null),
            'Could not update the building.',
          ),
        );
        return;
      }
      toast.success('Building updated.');
      dialog?.complete();
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    }
  });
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="text-body text-danger-foreground">
          {error}
        </p>
      ) : null}
      <FormField
        label="Building name"
        htmlFor="building-edit-name"
        error={errors.name?.message ?? ''}
        required
      >
        <input data-testid="building-edit-name" className={INPUT_CLASS} {...register('name')} />
      </FormField>
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button data-testid="building-edit-submit" type="submit" loading={isSubmitting}>
          Save building
        </Button>
      </FormActions>
    </form>
  );
}
