'use client';
import { Pencil } from 'lucide-react';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import {
  Button,
  Dialog,
  FormField,
  INPUT_CLASS,
  ResourceDeleteControl,
  ResourceStatusControl,
  serverErrorMessage,
  useToast,
} from '@/shared/ui';

const editSchema = z.object({
  label: z.string().trim().min(1, 'Label is required.').max(255),
});

type EditValues = z.infer<typeof editSchema>;

export function FloorRowActions({
  floorId,
  label,
  status,
}: {
  floorId: string;
  label: string;
  status: 'ACTIVE' | 'INACTIVE';
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { label },
  });

  const onEdit = handleSubmit(async (values) => {
    setEditError(null);
    const response = await fetch(`/api/admin/floors/${floorId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label: values.label }),
    });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      setEditError(serverErrorMessage(payload, 'Could not update the floor.'));
      return;
    }
    setEditOpen(false);
    toast.success('Floor updated.');
    router.refresh();
  });

  return (
    <>
      <span className="flex flex-wrap gap-2">
        <Button
          data-testid={`floor-edit-open-${floorId}`}
          variant="secondary"
          size="sm"
          onClick={() => setEditOpen(true)}
        >
          <Pencil aria-hidden="true" className="size-4" />
          Edit
        </Button>
        <ResourceStatusControl
          resource="floor"
          active={status === 'ACTIVE'}
          endpoint={`/api/admin/floors/${floorId}`}
          testId={`floor-status-${floorId}`}
          description="An inactive floor stops new room activity. Each room keeps its own status."
        />
        <ResourceDeleteControl
          resource="floor"
          name={label}
          endpoint={`/api/admin/floors/${floorId}`}
          testId="floor-delete"
          triggerTestId={`floor-delete-open-${floorId}`}
          dialogTestId="floor-delete-confirm"
          description="This floor and its rooms will be removed from the directory. End active or scheduled rentals and memberships first. Bills and history stay recorded."
        />
      </span>
      <Dialog
        open={editOpen}
        busy={isSubmitting}
        onClose={() => setEditOpen(false)}
        title="Edit floor"
        description="Update the floor name."
        size="sm"
        testId="floor-edit-dialog"
        actions={
          <>
            <Button variant="secondary" disabled={isSubmitting} onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid="floor-edit-submit"
              loading={isSubmitting}
              onClick={() => void onEdit()}
            >
              Save floor
            </Button>
          </>
        }
      >
        <form
          data-testid="floor-edit-form"
          onSubmit={onEdit}
          noValidate
          className="flex flex-col gap-4"
        >
          {editError !== null ? (
            <p
              data-testid="floor-edit-error"
              role="alert"
              className="text-sm font-medium text-danger-foreground"
            >
              {editError}
            </p>
          ) : null}
          <FormField
            label="Floor name"
            htmlFor="floor-edit-label"
            error={errors.label?.message ?? ''}
            required
          >
            <input
              data-testid="floor-edit-label"
              type="text"
              required
              className={INPUT_CLASS}
              {...register('label')}
            />
          </FormField>
        </form>
      </Dialog>
    </>
  );
}
