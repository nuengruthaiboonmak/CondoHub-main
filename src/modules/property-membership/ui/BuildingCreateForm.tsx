'use client';
import { FormActions } from '@/shared/ui/FormActions';

import { Select } from '@/shared/ui/Select';
import { CircleCheck as SelectIconCircleCheck } from 'lucide-react';

import { useFormDialog } from '@/shared/ui/FormDialog';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Button, FormField, INPUT_CLASS, serverErrorMessage, useToast } from '@/shared/ui';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(255),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

type CreateValues = z.infer<typeof createSchema>;

export function BuildingCreateForm({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', status: 'ACTIVE' },
  });

  const dialog = useFormDialog(isSubmitting);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const response = await fetch('/api/admin/buildings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId,
          name: values.name,
          status: values.status,
        }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setServerError(serverErrorMessage(payload, 'Could not create the building.'));
        return;
      }
      toast.success('Building created.');
      dialog?.complete();
      router.push(`/admin/buildings?query=${encodeURIComponent(values.name)}`);
      router.refresh();
    } catch {
      setServerError('Could not reach the server. Check your connection and try again.');
    }
  });

  return (
    <form
      data-testid="building-create-form"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4 "
    >
      {serverError !== null ? (
        <p
          data-testid="building-create-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4">
        <FormField
          label="Building name"
          htmlFor="building-create-name"
          error={errors.name?.message ?? ''}
          required
        >
          <input
            data-testid="building-create-name"
            type="text"
            required
            placeholder="e.g. North tower"
            className={INPUT_CLASS}
            {...register('name')}
          />
        </FormField>
      </div>
      <FormField label="Status" htmlFor="building-create-status">
        <Select
          icon={SelectIconCircleCheck}
          data-testid="building-create-status"
          className={INPUT_CLASS}
          {...register('status')}
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </Select>
      </FormField>
      <FormActions
        onCancel={() => (dialog ? dialog.requestClose() : router.push('/admin/buildings'))}
        pending={isSubmitting}
      >
        <Button data-testid="building-create-submit" type="submit" loading={isSubmitting}>
          Create building
        </Button>
      </FormActions>
    </form>
  );
}
