'use client';
import { TEXTAREA_CLASS } from '@/shared/ui/controlClasses';
import { FormActions } from '@/shared/ui/FormActions';

import { Select } from '@/shared/ui/Select';
import { UserRound as SelectIconUserRound } from 'lucide-react';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import {
  Button,
  FormDialog,
  useFormDialog,
  FormField,
  INPUT_CLASS,
  serverErrorMessage,
  useToast,
} from '@/shared/ui';

const usernameRule = z
  .string()
  .trim()
  .min(1, 'Username is required.')
  .max(30)
  .regex(/^[a-z0-9._]+$/, 'Use lowercase letters, digits, dots, and underscores.');

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');

const transferSchema = z.object({
  fromOwnershipId: z.string().min(1, 'Owner is required.'),
  toUsername: usernameRule,
  effectiveDate: dateString,
});

const removeSchema = z.object({
  ownershipId: z.string().min(1, 'Owner is required.'),
  effectiveDate: dateString,
});

type TransferValues = z.infer<typeof transferSchema>;
type RemoveValues = z.infer<typeof removeSchema>;

export interface OwnerOption {
  ownershipId: string;
  userId: string;
  name: string;
}

function toEffectiveAt(date: string): string {
  return `${date}T00:00:00+07:00`;
}

export function OwnershipManageForm({ roomId, owners }: { roomId: string; owners: OwnerOption[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      <FormDialog
        triggerLabel="Transfer ownership"
        title="Transfer ownership"
        triggerTestId="ownership-transfer-open"
        testId="ownership-transfer-dialog"
        variant="secondary"
        icon="none"
      >
        <TransferForm roomId={roomId} owners={owners} />
      </FormDialog>
      <FormDialog
        triggerLabel="Remove owner"
        title="Remove owner"
        triggerTestId="ownership-remove-open"
        testId="ownership-remove-dialog"
        variant="secondary"
        icon="none"
      >
        <RemoveForm roomId={roomId} owners={owners} />
      </FormDialog>
      <FormDialog
        triggerLabel="Correct ownership dates"
        title="Correct ownership dates"
        description="Adjust a recorded ownership period with an audit reason."
        triggerTestId="ownership-correct-open"
        testId="ownership-correct-dialog"
        variant="secondary"
        icon="none"
      >
        <CorrectionForm roomId={roomId} owners={owners} />
      </FormDialog>
    </div>
  );
}

const correctionSchema = z
  .object({
    ownershipId: z.string().min(1, 'Owner is required.'),
    startDate: z.union([dateString, z.literal('')]),
    endDate: z.union([dateString, z.literal('')]),
    reason: z.string().trim().min(1, 'Explain why this correction is needed.').max(2000),
  })
  .refine((values) => values.startDate !== '' || values.endDate !== '', {
    message: 'Enter a corrected start or end date.',
    path: ['startDate'],
  });

function CorrectionForm({ roomId, owners }: { roomId: string; owners: OwnerOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof correctionSchema>>({
    resolver: zodResolver(correctionSchema),
    defaultValues: { ownershipId: '', startDate: '', endDate: '', reason: '' },
  });
  const dialog = useFormDialog(isSubmitting);
  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const response = await fetch(`/api/admin/rooms/${roomId}/ownerships`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'CORRECT',
          ownershipId: values.ownershipId,
          reason: values.reason,
          ...(values.startDate ? { startAt: toEffectiveAt(values.startDate) } : {}),
          ...(values.endDate ? { endAt: toEffectiveAt(values.endDate) } : {}),
        }),
      });
      if (!response.ok) {
        setServerError(
          serverErrorMessage(
            await response.json().catch(() => null),
            'Could not correct ownership.',
          ),
        );
        return;
      }
      toast.success('Ownership dates corrected.');
      dialog?.complete();
      router.refresh();
    } catch {
      setServerError('Could not connect. Please try again.');
    }
  });
  return (
    <form
      data-testid="ownership-correct-form"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4"
    >
      {serverError ? (
        <p role="alert" className="text-body text-danger-foreground">
          {serverError}
        </p>
      ) : null}
      <FormField
        label="Owner"
        htmlFor="ownership-correct-owner"
        error={errors.ownershipId?.message ?? ''}
        required
      >
        <Select
          icon={SelectIconUserRound}
          data-testid="ownership-correct-owner"
          className={INPUT_CLASS}
          {...register('ownershipId')}
        >
          <option value="">Select an owner</option>
          {owners.map((owner) => (
            <option key={owner.ownershipId} value={owner.ownershipId}>
              {owner.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        label="Corrected start date"
        htmlFor="ownership-correct-start"
        error={errors.startDate?.message ?? ''}
        hint="Leave blank to keep the recorded start date."
      >
        <input
          data-testid="ownership-correct-start"
          type="date"
          className={INPUT_CLASS}
          {...register('startDate')}
        />
      </FormField>
      <FormField
        label="Corrected end date"
        htmlFor="ownership-correct-end"
        error={errors.endDate?.message ?? ''}
        hint="Leave blank to keep the recorded end date."
      >
        <input
          data-testid="ownership-correct-end"
          type="date"
          className={INPUT_CLASS}
          {...register('endDate')}
        />
      </FormField>
      <FormField
        label="Reason"
        htmlFor="ownership-correct-reason"
        error={errors.reason?.message ?? ''}
        required
      >
        <textarea
          data-testid="ownership-correct-reason"
          rows={3}
          className={TEXTAREA_CLASS}
          {...register('reason')}
        />
      </FormField>
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button data-testid="ownership-correct-submit" type="submit" loading={isSubmitting}>
          Save correction
        </Button>
      </FormActions>
    </form>
  );
}

const assignSchema = z.object({
  username: usernameRule,
  effectiveDate: z.union([dateString, z.literal('')]).optional(),
});

type AssignValues = z.infer<typeof assignSchema>;

export function OwnershipAssignForm({
  roomId,
  mode = 'assign',
}: {
  roomId: string;
  mode?: 'assign' | 'co-owner';
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AssignValues>({
    resolver: zodResolver(assignSchema),
    defaultValues: { username: '', effectiveDate: '' },
  });

  const dialog = useFormDialog(isSubmitting);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const response = await fetch(
        mode === 'assign' ? `/api/admin/rooms/${roomId}/owners` : `/api/rooms/${roomId}/co-owners`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            username: values.username,
            ...(mode !== 'assign' ||
            values.effectiveDate === '' ||
            values.effectiveDate === undefined
              ? {}
              : { effectiveAt: toEffectiveAt(values.effectiveDate) }),
          }),
        },
      );
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setServerError(serverErrorMessage(payload, 'Could not assign the owner.'));
        return;
      }
      toast.success(mode === 'assign' ? 'Owner assigned.' : 'Co-owner added.');
      dialog?.complete();
      reset();
      router.refresh();
    } catch {
      setServerError('Could not connect. Please try again.');
    }
  });

  return (
    <form
      data-testid="ownership-assign-form"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4 "
    >
      {serverError !== null ? (
        <p
          data-testid="ownership-assign-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <FormField
        label="Username"
        htmlFor="ownership-assign-username"
        error={errors.username?.message ?? ''}
        hint="Lowercase letters, digits, dots, and underscores. The account must already exist."
        required
      >
        <input
          data-testid="ownership-assign-username"
          type="text"
          required
          autoComplete="off"
          className={INPUT_CLASS}
          {...register('username')}
        />
      </FormField>
      {mode === 'assign' ? (
        <FormField
          label="Effective date (optional)"
          htmlFor="ownership-assign-date"
          error={errors.effectiveDate?.message ?? ''}
          hint="Defaults to today."
        >
          <input
            data-testid="ownership-assign-date"
            type="date"
            className={INPUT_CLASS}
            {...register('effectiveDate')}
          />
        </FormField>
      ) : null}
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button data-testid="ownership-assign-submit" type="submit" loading={isSubmitting}>
          {mode === 'assign' ? 'Assign owner' : 'Add co-owner'}
        </Button>
      </FormActions>
    </form>
  );
}

function TransferForm({ roomId, owners }: { roomId: string; owners: OwnerOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TransferValues>({
    resolver: zodResolver(transferSchema),
    defaultValues: { fromOwnershipId: '', toUsername: '', effectiveDate: '' },
  });

  const dialog = useFormDialog(isSubmitting);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const owner = owners.find((entry) => entry.ownershipId === values.fromOwnershipId);
    if (owner === undefined) {
      setServerError('Select the current owner to transfer from.');
      return;
    }
    try {
      const response = await fetch(`/api/admin/rooms/${roomId}/ownerships`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'TRANSFER',
          fromUserId: owner.userId,
          toUsername: values.toUsername,
          effectiveAt: toEffectiveAt(values.effectiveDate),
        }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setServerError(serverErrorMessage(payload, 'Could not transfer ownership.'));
        return;
      }
      toast.success('Ownership transferred.');
      dialog?.complete();
      reset();
      router.refresh();
    } catch {
      setServerError('Could not connect. Please try again.');
    }
  });

  return (
    <form
      data-testid="ownership-transfer-form"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4 "
    >
      {serverError !== null ? (
        <p
          data-testid="ownership-transfer-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <FormField
        label="From owner"
        htmlFor="ownership-transfer-from"
        error={errors.fromOwnershipId?.message ?? ''}
        required
      >
        <Select
          icon={SelectIconUserRound}
          data-testid="ownership-transfer-from"
          className={INPUT_CLASS}
          {...register('fromOwnershipId')}
        >
          <option value="">Select an owner</option>
          {owners.map((owner) => (
            <option key={owner.ownershipId} value={owner.ownershipId}>
              {owner.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        label="To username"
        htmlFor="ownership-transfer-to"
        error={errors.toUsername?.message ?? ''}
        hint="Lowercase letters, digits, dots, and underscores. The account must already exist."
        required
      >
        <input
          data-testid="ownership-transfer-to"
          type="text"
          required
          autoComplete="off"
          className={INPUT_CLASS}
          {...register('toUsername')}
        />
      </FormField>
      <FormField
        label="Effective date"
        htmlFor="ownership-transfer-date"
        error={errors.effectiveDate?.message ?? ''}
        required
      >
        <input
          data-testid="ownership-transfer-date"
          type="date"
          required
          className={INPUT_CLASS}
          {...register('effectiveDate')}
        />
      </FormField>
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button data-testid="ownership-transfer-submit" type="submit" loading={isSubmitting}>
          Transfer ownership
        </Button>
      </FormActions>
    </form>
  );
}

function RemoveForm({ roomId, owners }: { roomId: string; owners: OwnerOption[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<RemoveValues>({
    resolver: zodResolver(removeSchema),
    defaultValues: { ownershipId: '', effectiveDate: '' },
  });

  const dialog = useFormDialog(isSubmitting);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const response = await fetch(`/api/admin/rooms/${roomId}/ownerships`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'REMOVE',
          ownershipId: values.ownershipId,
          effectiveAt: toEffectiveAt(values.effectiveDate),
        }),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setServerError(serverErrorMessage(payload, 'Could not remove the owner.'));
        return;
      }
      toast.success('Owner removed.');
      dialog?.complete();
      reset();
      router.refresh();
    } catch {
      setServerError('Could not connect. Please try again.');
    }
  });

  return (
    <form
      data-testid="ownership-remove-form"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-4 "
    >
      {serverError !== null ? (
        <p
          data-testid="ownership-remove-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <FormField
        label="Owner"
        htmlFor="ownership-remove-owner"
        error={errors.ownershipId?.message ?? ''}
        required
      >
        <Select
          icon={SelectIconUserRound}
          data-testid="ownership-remove-owner"
          className={INPUT_CLASS}
          {...register('ownershipId')}
        >
          <option value="">Select an owner</option>
          {owners.map((owner) => (
            <option key={owner.ownershipId} value={owner.ownershipId}>
              {owner.name}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        label="Effective date"
        htmlFor="ownership-remove-date"
        error={errors.effectiveDate?.message ?? ''}
        required
      >
        <input
          data-testid="ownership-remove-date"
          type="date"
          required
          className={INPUT_CLASS}
          {...register('effectiveDate')}
        />
      </FormField>
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button
          data-testid="ownership-remove-submit"
          type="submit"
          variant="destructive"
          loading={isSubmitting}
        >
          Remove owner
        </Button>
      </FormActions>
    </form>
  );
}
