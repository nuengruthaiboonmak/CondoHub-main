'use client';
import { FormActions } from '@/shared/ui/FormActions';

import { Select } from '@/shared/ui/Select';
import { CircleCheck as SelectIconCircleCheck } from 'lucide-react';

import { useFormDialog } from '@/shared/ui';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Button,
  FormField,
  INPUT_BASE_CLASS,
  cx,
  deniedCopy,
  rateLimitedCopy,
  useToast,
} from '@/shared/ui';
import {
  ticketTransitionFormSchema,
  type TicketTransitionFormValues,
} from '@/modules/maintenance/ui/maintenanceFormSchemas';
import { isTerminalTicketStatus, statusLabel } from '@/modules/maintenance/ui/ticketLabels';
import {
  handlerTransitionsFrom,
  type TicketStatus,
} from '@/modules/maintenance/domain/stateMachine';

interface ErrorPayload {
  error?: { code?: string; message?: string };
}

function transitionErrorCopy(code: string | undefined, fallback: string): string {
  const denied = deniedCopy('This request is not available.')(code);
  if (denied !== null) return denied;
  if (code === 'VERSION_CONFLICT') {
    return 'Someone changed this request first. Reload the page and retry.';
  }
  const limited = rateLimitedCopy('Too many requests. Please wait a moment and retry.')(code);
  if (limited !== null) return limited;
  return fallback;
}

export type TicketTransitionAction = 'handler' | 'reporter-cancel';

export function TicketTransitionForm({
  ticketId,
  currentStatus,
  expectedVersion,
  mode,
  testIdPrefix,
  onTransitioned,
}: {
  ticketId: string;
  currentStatus: string;
  expectedVersion: number;
  mode: TicketTransitionAction;
  testIdPrefix: string;
  onTransitioned: () => void;
}) {
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const options =
    mode === 'reporter-cancel'
      ? (['CANCELLED'] as const)
      : (handlerTransitionsFrom(currentStatus as TicketStatus) as readonly string[]);
  const {
    register,
    handleSubmit,
    setFocus,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<TicketTransitionFormValues>({
    resolver: zodResolver(ticketTransitionFormSchema),
    defaultValues: {
      status: (mode === 'reporter-cancel' ? 'CANCELLED' : (options[0] ?? 'IN_PROGRESS')) as
        | 'PENDING'
        | 'IN_PROGRESS'
        | 'WAITING_FOR_INFO'
        | 'COMPLETED'
        | 'REJECTED'
        | 'CANCELLED',
      reason: '',
    },
  });
  const dialog = useFormDialog(isSubmitting);
  const status = watch('status');
  const terminal = isTerminalTicketStatus(currentStatus);

  if (terminal) return null;
  if (mode === 'handler' && options.length === 0) return null;

  const onSubmit = handleSubmit(
    async (values) => {
      setServerError(null);
      const response = await fetch(`/api/maintenance/${ticketId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: values.status,
          expectedVersion,
          ...(values.status === 'REJECTED' && values.reason !== undefined && values.reason !== ''
            ? { reason: values.reason.trim() }
            : {}),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
        setServerError(
          transitionErrorCopy(
            payload?.error?.code,
            payload?.error?.message ?? 'Could not update this request. Reload the page and retry.',
          ),
        );
        return;
      }
      toast.success('Request updated.');
      dialog?.complete();
      onTransitioned();
    },
    (invalid) => {
      if (invalid.status !== undefined) {
        setFocus('status');
        return;
      }
      setFocus('reason');
    },
  );

  return (
    <form
      data-testid={`${testIdPrefix}-transition-form`}
      onSubmit={onSubmit}
      noValidate
      className="flex min-w-0 flex-col gap-3"
    >
      {serverError !== null ? (
        <p
          data-testid={`${testIdPrefix}-transition-error`}
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      {mode === 'handler' ? (
        <FormField
          label="New status"
          htmlFor={`${testIdPrefix}-transition-status`}
          {...(errors.status?.message === undefined ? {} : { error: errors.status.message })}
          required
        >
          <Select
            icon={SelectIconCircleCheck}
            data-testid={`${testIdPrefix}-transition-status`}
            required
            className={cx(INPUT_BASE_CLASS, 'h-10')}
            {...register('status')}
          >
            {options.map((option) => (
              <option key={option} value={option}>
                {statusLabel(option)}
              </option>
            ))}
          </Select>
        </FormField>
      ) : (
        <input
          type="hidden"
          data-testid={`${testIdPrefix}-transition-status`}
          {...register('status')}
        />
      )}
      {mode === 'handler' && status === 'REJECTED' ? (
        <FormField
          label="Rejection reason"
          htmlFor={`${testIdPrefix}-transition-reason`}
          {...(errors.reason?.message === undefined ? {} : { error: errors.reason.message })}
          required
        >
          <input
            data-testid={`${testIdPrefix}-transition-reason`}
            type="text"
            maxLength={2000}
            required
            placeholder="Explain why this request cannot proceed."
            className={cx(INPUT_BASE_CLASS, 'h-10')}
            {...register('reason')}
          />
        </FormField>
      ) : null}
      <FormActions onCancel={dialog?.requestClose} pending={isSubmitting}>
        <Button
          data-testid={`${testIdPrefix}-transition-submit`}
          type="submit"
          variant={status === 'REJECTED' || status === 'CANCELLED' ? 'destructive' : 'primary'}
          loading={isSubmitting}
          size="sm"
        >
          {mode === 'reporter-cancel' ? 'Cancel request' : 'Update status'}
        </Button>
      </FormActions>
    </form>
  );
}
