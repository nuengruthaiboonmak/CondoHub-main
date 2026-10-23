'use client';
import { FormActions } from '@/shared/ui/FormActions';

import { Select } from '@/shared/ui/Select';
import { DoorOpen as SelectIconDoorOpen } from 'lucide-react';

import { useFormDialog } from '@/shared/ui/FormDialog';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Button, FormField, INPUT_BASE_CLASS, cx, useToast } from '@/shared/ui';
import {
  TicketImageUploader,
  type TicketUploadedImage,
} from '@/modules/maintenance/ui/TicketImageUploader';
import {
  maintenanceRoutingKindOptions,
  ticketCreateFormSchema,
  type TicketCreateFormValues,
} from '@/modules/maintenance/ui/maintenanceFormSchemas';

export interface TicketRoomOption {
  id: string;
  label: string;
}

interface ErrorPayload {
  error?: { code?: string; message?: string };
}

interface CreateEnvelope {
  data?: { id?: string };
}

const KIND_META: Record<string, { label: string; hint: string }> = {
  COMMON_AREA: {
    label: 'Common area',
    hint: 'Lobbies, lifts, pools, and other shared spaces. No room needed.',
  },
  PRIVATE_OWNER: {
    label: 'Owner room',
    hint: 'Inside an owner-managed room. The room owners handle it.',
  },
  PROJECT_MANAGED_PRIVATE: {
    label: 'Managed room',
    hint: 'Inside a project-managed room. The management team handles it.',
  },
};

function createErrorCopy(code: string | undefined, fallback: string): string {
  if (code === 'RESOURCE_NOT_FOUND' || code === 'ACCESS_DENIED') {
    return 'This request is not available.';
  }
  if (code === 'RATE_LIMITED') return 'Too many requests. Please wait a moment and retry.';
  return fallback;
}

export function TicketCreateForm({
  privateRooms,
  managedRooms,
  defaultRoomId = '',
  defaultRoutingKind = 'COMMON_AREA',
}: {
  privateRooms: TicketRoomOption[];
  managedRooms: TicketRoomOption[];
  defaultRoomId?: string;
  defaultRoutingKind?: TicketCreateFormValues['routingKind'];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [images, setImages] = useState<TicketUploadedImage[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TicketCreateFormValues>({
    resolver: zodResolver(ticketCreateFormSchema),
    defaultValues: {
      routingKind: defaultRoutingKind,
      roomId: defaultRoomId,
      locationDescription: '',
      subject: '',
      description: '',
    },
  });
  const routingKind = watch('routingKind');
  const roomOptions = routingKind === 'PRIVATE_OWNER' ? privateRooms : managedRooms;

  const dialog = useFormDialog(isSubmitting);

  const onSubmit = handleSubmit(
    async (values) => {
      setServerError(null);
      const response = await fetch('/api/maintenance', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          routingKind: values.routingKind,
          ...(values.roomId !== undefined && values.roomId !== '' ? { roomId: values.roomId } : {}),
          locationDescription: values.locationDescription,
          subject: values.subject,
          description: values.description,
          imageIds: images.map((image) => image.imageId),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
        setServerError(
          createErrorCopy(
            payload?.error?.code,
            payload?.error?.message ?? 'Could not submit this request. Check the form and retry.',
          ),
        );
        return;
      }
      const payload = (await response.json().catch(() => null)) as CreateEnvelope | null;
      const id = payload?.data?.id;
      if (id === undefined || id === '') {
        setServerError('The request was submitted but the response was empty. Reload the page.');
        return;
      }
      toast.success('Request submitted.');
      dialog?.complete();
      router.push(`/maintenance/${id}`);
      router.refresh();
    },
    (invalid) => {
      if (invalid.roomId !== undefined) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document.getElementById('maintenance-create-room')?.focus({ preventScroll: false });
          });
        });
        return;
      }
      const target =
        invalid.locationDescription !== undefined
          ? document.getElementById('maintenance-create-location')
          : invalid.subject !== undefined
            ? document.getElementById('maintenance-create-subject')
            : invalid.description !== undefined
              ? document.getElementById('maintenance-create-description')
              : null;
      if (target !== null) {
        target.focus({ preventScroll: false });
        target.scrollIntoView({ block: 'nearest' });
      }
    },
  );

  return (
    <form
      data-testid="maintenance-create-form"
      onSubmit={onSubmit}
      noValidate
      className="flex min-w-0 flex-col gap-5"
    >
      {serverError !== null ? (
        <p
          data-testid="maintenance-create-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend className="text-body leading-body font-semibold text-foreground">
          Where is the problem?
        </legend>
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
          {maintenanceRoutingKindOptions.map((kind) => {
            const meta = KIND_META[kind] ?? { label: kind, hint: '' };
            const selected = routingKind === kind;
            return (
              <label
                key={kind}
                className={cx(
                  'flex cursor-pointer items-start gap-3 rounded-lg border bg-surface p-4 text-body leading-body transition-[border-color,background-color] duration-150 ease-out motion-reduce:transition-none',
                  selected ? 'border-primary' : 'border-border hover:border-border-strong',
                )}
              >
                <input
                  data-testid={`maintenance-create-kind-${kind}`}
                  type="radio"
                  value={kind}
                  aria-label={meta.label}
                  className="peer absolute size-5 cursor-pointer opacity-0"
                  {...register('routingKind', {
                    onChange: () => setValue('roomId', '', { shouldValidate: true }),
                  })}
                />
                <span
                  aria-hidden="true"
                  className={cx(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-[border-color,background-color] duration-150 ease-out motion-reduce:transition-none peer-focus-visible:ring-2 peer-focus-visible:ring-focus-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface',
                    selected ? 'border-primary bg-primary' : 'border-border-strong bg-surface',
                  )}
                >
                  <span
                    className={cx(
                      'size-2 rounded-full bg-primary-foreground',
                      selected ? 'block' : 'hidden',
                    )}
                  />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium text-foreground">{meta.label}</span>
                  <span className="text-xs leading-6 text-muted-foreground">{meta.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
        {errors.routingKind !== undefined ? (
          <p
            data-testid="maintenance-create-kind-error"
            role="alert"
            className="text-body leading-body font-medium text-danger-foreground"
          >
            {errors.routingKind.message}
          </p>
        ) : null}
      </fieldset>
      {routingKind !== 'COMMON_AREA' ? (
        <FormField
          label="Room"
          htmlFor="maintenance-create-room"
          {...(errors.roomId?.message === undefined ? {} : { error: errors.roomId.message })}
          required
          {...(roomOptions.length === 0
            ? { hint: 'No eligible rooms for this category. Check your memberships first.' }
            : {})}
        >
          <Select
            icon={SelectIconDoorOpen}
            data-testid="maintenance-create-room"
            required
            className={cx(INPUT_BASE_CLASS, 'h-10')}
            {...register('roomId')}
          >
            <option value="">Select a room</option>
            {roomOptions.map((room) => (
              <option key={room.id} value={room.id}>
                {room.label}
              </option>
            ))}
          </Select>
        </FormField>
      ) : null}
      <FormField
        label="Location"
        htmlFor="maintenance-create-location"
        {...(errors.locationDescription?.message === undefined
          ? {}
          : { error: errors.locationDescription.message })}
        required
      >
        <input
          data-testid="maintenance-create-location"
          type="text"
          maxLength={1000}
          required
          placeholder="Tower B lobby, near the lift hall"
          className={cx(INPUT_BASE_CLASS, 'h-10')}
          {...register('locationDescription')}
        />
      </FormField>
      <FormField
        label="Subject"
        htmlFor="maintenance-create-subject"
        {...(errors.subject?.message === undefined ? {} : { error: errors.subject.message })}
        required
      >
        <input
          data-testid="maintenance-create-subject"
          type="text"
          maxLength={255}
          required
          placeholder="Flickering light in the lobby"
          className={cx(INPUT_BASE_CLASS, 'h-10')}
          {...register('subject')}
        />
      </FormField>
      <FormField
        label="Details"
        htmlFor="maintenance-create-description"
        {...(errors.description?.message === undefined
          ? {}
          : { error: errors.description.message })}
        required
      >
        <textarea
          data-testid="maintenance-create-description"
          rows={5}
          maxLength={20000}
          required
          placeholder="Describe the problem, when it started, and anything the handler should know."
          className={cx(INPUT_BASE_CLASS, 'py-2 leading-6')}
          {...register('description')}
        />
      </FormField>
      <TicketImageUploader
        images={images}
        onChange={setImages}
        testIdPrefix="maintenance-create"
        maxImages={5}
        entityType="maintenance_request"
      />
      <FormActions
        onCancel={() => (dialog ? dialog.requestClose() : router.push('/maintenance'))}
        pending={isSubmitting}
        cancelTestId="maintenance-create-cancel"
      >
        <Button data-testid="maintenance-create-submit" type="submit" loading={isSubmitting}>
          Submit request
        </Button>
      </FormActions>
    </form>
  );
}
