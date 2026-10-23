'use client';
import { FormActions } from '@/shared/ui/FormActions';

import { Select } from '@/shared/ui/Select';
import { Building2 as SelectIconBuilding2 } from 'lucide-react';

import { useFormDialog } from '@/shared/ui/FormDialog';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Button, FormField, INPUT_CLASS, serverErrorMessage, useToast } from '@/shared/ui';

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

const createSchema = z
  .object({
    startsAt: dateString,
    endsAt: z.union([dateString, z.literal('')]).optional(),
    managementMode: z.enum(['PROJECT_MANAGED', 'PRIVATE_OWNER_MANAGED']),
  })
  .superRefine((values, ctx) => {
    if (values.endsAt !== undefined && values.endsAt !== '' && values.endsAt <= values.startsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'The end date must be after the start date.',
      });
    }
  });

type CreateValues = z.infer<typeof createSchema>;

function toEffectiveAt(date: string): string {
  return `${date}T00:00:00+07:00`;
}

export function TenancyCreateForm({
  roomId,
  allowProjectManaged,
}: {
  roomId: string;
  allowProjectManaged: boolean;
}) {
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
    defaultValues: {
      startsAt: '',
      endsAt: '',
      managementMode: allowProjectManaged ? 'PROJECT_MANAGED' : 'PRIVATE_OWNER_MANAGED',
    },
  });

  const dialog = useFormDialog(isSubmitting);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const response = await fetch(`/api/rooms/${roomId}/tenancies`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          startsAt: toEffectiveAt(values.startsAt),
          ...(values.endsAt === '' || values.endsAt === undefined
            ? {}
            : { endsAt: toEffectiveAt(values.endsAt) }),
          managementMode: values.managementMode,
        }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setServerError(serverErrorMessage(payload, 'Could not create the rental period.'));
        return;
      }
      const created: { data: { id: string } } = await response.json();
      toast.success('Rental period created.');
      dialog?.complete();
      reset();
      router.push(`/rooms/${roomId}/rental?tenancyId=${created.data.id}`);
      router.refresh();
    } catch {
      setServerError('Could not reach the server. Check your connection and try again.');
    }
  });

  return (
    <form
      data-testid="room-tenancy-create-form"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-5"
    >
      {serverError !== null ? (
        <p
          data-testid="room-tenancy-create-error"
          role="alert"
          className="text-sm font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label="Start date"
          htmlFor="room-tenancy-create-start"
          error={errors.startsAt?.message ?? ''}
          required
        >
          <input
            data-testid="room-tenancy-create-start"
            type="date"
            required
            className={INPUT_CLASS}
            {...register('startsAt')}
          />
        </FormField>
        <FormField
          label="End date (optional)"
          htmlFor="room-tenancy-create-end"
          error={errors.endsAt?.message ?? ''}
        >
          <input
            data-testid="room-tenancy-create-end"
            type="date"
            className={INPUT_CLASS}
            {...register('endsAt')}
          />
        </FormField>
      </div>
      {allowProjectManaged ? (
        <FormField label="Management" htmlFor="room-tenancy-create-mode">
          <Select
            icon={SelectIconBuilding2}
            data-testid="room-tenancy-create-mode"
            className={INPUT_CLASS}
            {...register('managementMode')}
          >
            <option value="PRIVATE_OWNER_MANAGED">Owner managed</option>
            <option value="PROJECT_MANAGED">Project managed</option>
          </Select>
        </FormField>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">
          The room owner receives rent and handles room repairs. Project-managed rentals are set up
          by an admin.
        </p>
      )}
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button data-testid="room-tenancy-create-submit" type="submit" loading={isSubmitting}>
          Create rental period
        </Button>
      </FormActions>
    </form>
  );
}
