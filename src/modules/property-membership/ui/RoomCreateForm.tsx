'use client';
import { FormActions } from '@/shared/ui/FormActions';

import { Select } from '@/shared/ui/Select';
import { CircleCheck as SelectIconCircleCheck, Layers3 as SelectIconLayers3 } from 'lucide-react';

import { useFormDialog } from '@/shared/ui/FormDialog';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { Button, FormField, INPUT_CLASS, serverErrorMessage, useToast } from '@/shared/ui';

const createSchema = z.object({
  floorId: z.string().min(1, 'Floor is required.'),
  name: z.string().trim().min(1, 'Room name is required.').max(255),
  areaSqm: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, 'Area must be a number with up to 4 decimals.'),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

type CreateValues = z.infer<typeof createSchema>;

export interface RoomFloorOption {
  id: string;
  code: string;
  label: string;
}

export function RoomCreateForm({
  buildingId,
  floors,
  defaultFloorId = '',
}: {
  buildingId: string;
  floors: RoomFloorOption[];
  defaultFloorId?: string;
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
    defaultValues: { floorId: defaultFloorId, name: '', areaSqm: '', status: 'ACTIVE' },
  });

  const dialog = useFormDialog(isSubmitting);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const response = await fetch('/api/admin/rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          floorId: values.floorId,
          buildingId,
          name: values.name,
          areaSqm: values.areaSqm,
          status: values.status,
        }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setServerError(serverErrorMessage(payload, 'Could not create the room.'));
        return;
      }
      toast.success('Room created.');
      dialog?.complete();
      reset();
      router.refresh();
    } catch {
      setServerError('Could not reach the server. Check your connection and try again.');
    }
  });

  if (floors.length === 0) {
    return (
      <p
        data-testid="room-create-no-floors"
        className="text-small leading-small text-muted-foreground"
      >
        Create a floor first, then add rooms to it.
      </p>
    );
  }

  return (
    <form
      data-testid="room-create-form"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4 "
    >
      {serverError !== null ? (
        <p
          data-testid="room-create-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField
          label="Floor"
          htmlFor="room-create-floor"
          error={errors.floorId?.message ?? ''}
          required
        >
          <Select
            icon={SelectIconLayers3}
            data-testid="room-create-floor"
            className={INPUT_CLASS}
            {...register('floorId')}
          >
            <option value="">Select a floor</option>
            {floors.map((floor) => (
              <option key={floor.id} value={floor.id}>
                {floor.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="Room name"
          htmlFor="room-create-name"
          error={errors.name?.message ?? ''}
          required
        >
          <input
            data-testid="room-create-name"
            type="text"
            required
            className={INPUT_CLASS}
            {...register('name')}
          />
        </FormField>
        <FormField
          label="Area (sqm)"
          htmlFor="room-create-area"
          error={errors.areaSqm?.message ?? ''}
          hint="Number with up to 4 decimals."
          required
        >
          <input
            data-testid="room-create-area"
            type="text"
            required
            inputMode="decimal"
            className={INPUT_CLASS}
            {...register('areaSqm')}
          />
        </FormField>
        <FormField label="Status" htmlFor="room-create-status">
          <Select
            icon={SelectIconCircleCheck}
            data-testid="room-create-status"
            className={INPUT_CLASS}
            {...register('status')}
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
        </FormField>
      </div>
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button data-testid="room-create-submit" type="submit" loading={isSubmitting}>
          Create room
        </Button>
      </FormActions>
    </form>
  );
}
