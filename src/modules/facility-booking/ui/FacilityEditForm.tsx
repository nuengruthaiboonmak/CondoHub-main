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
import { Button, FormField, useToast } from '@/shared/ui';
import { INPUT_CLASS, TEXTAREA_CLASS } from '@/shared/ui';

const editSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(255),
  description: z.string().trim().max(20000).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  capacity: z.string().refine(
    (value) => {
      const parsed = Number(value);
      return value.trim() !== '' && Number.isInteger(parsed) && parsed >= 1 && parsed <= 1000;
    },
    { message: 'Capacity must be an integer between 1 and 1000.' },
  ),
});

type EditValues = z.infer<typeof editSchema>;

interface ErrorPayload {
  error?: { message?: string };
}

export function FacilityEditForm({
  facilityId,
  initial,
}: {
  facilityId: string;
  initial: {
    name: string;
    description: string | null;
    status: 'ACTIVE' | 'INACTIVE';
    capacity: number;
  };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: initial.name,
      description: initial.description ?? '',
      status: initial.status,
      capacity: String(initial.capacity),
    },
  });

  const dialog = useFormDialog(isSubmitting);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const response = await fetch(`/api/admin/facilities/${facilityId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: values.name,
        description: values.description === '' ? null : (values.description ?? null),
        status: values.status,
        capacity: Number(values.capacity),
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
      setServerError(payload?.error?.message ?? 'Could not save the facility.');
      return;
    }
    toast.success('Facility saved.');
    dialog?.complete();
    router.refresh();
  });

  return (
    <form
      data-testid="facility-edit-form"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4 "
    >
      {serverError !== null ? (
        <p
          data-testid="facility-edit-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label="Name"
          htmlFor="facility-edit-name"
          error={errors.name?.message ?? ''}
          required
        >
          <input
            data-testid="facility-edit-name"
            type="text"
            required
            className={INPUT_CLASS}
            {...register('name')}
          />
        </FormField>
        <FormField label="Seats per slot" htmlFor="facility-edit-capacity">
          <input
            data-testid="facility-edit-capacity"
            type="number"
            min={1}
            className={INPUT_CLASS}
            {...register('capacity')}
          />
        </FormField>
      </div>
      <FormField
        label="Description"
        htmlFor="facility-edit-description"
        hint="Shown to residents on the facility page."
      >
        <textarea
          data-testid="facility-edit-description"
          rows={3}
          className={TEXTAREA_CLASS}
          {...register('description')}
        />
      </FormField>
      <FormField label="Status" htmlFor="facility-edit-status">
        <Select
          icon={SelectIconCircleCheck}
          data-testid="facility-edit-status"
          className={INPUT_CLASS}
          {...register('status')}
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </Select>
      </FormField>
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button data-testid="facility-edit-submit" type="submit" loading={isSubmitting}>
          Save facility
        </Button>
      </FormActions>
    </form>
  );
}
