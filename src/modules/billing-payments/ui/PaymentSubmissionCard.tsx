'use client';
import { FormActions } from '@/shared/ui/FormActions';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Badge, Button, Dialog, FormField, deniedCopy, firstOf, useToast } from '@/shared/ui';
import type { PaymentSubmissionDto } from '@/modules/billing-payments/application/index';
import { PaymentImage } from '@/modules/billing-payments/ui/PaymentImage';
import { INPUT_CLASS } from '@/shared/ui';
import {
  formatInstant,
  submissionStateLabel,
  submissionStateVariant,
} from '@/modules/billing-payments/ui/billingLabels';
import {
  paymentApproveFormSchema,
  paymentRejectFormSchema,
  type PaymentApproveFormValues,
  type PaymentRejectFormValues,
} from '@/modules/billing-payments/ui/paymentFormSchemas';

interface ErrorPayload {
  error?: { code?: string; message?: string };
}

function reviewErrorCopy(code: string | undefined, fallback: string): string {
  if (code === 'PAYMENT_ALREADY_REVIEWED')
    return 'Someone reviewed this submission first. Reload the page.';
  if (code === 'PAYMENT_APPROVED_AMOUNT_EXCEEDS_OUTSTANDING') {
    return 'The approved amount is larger than the outstanding balance. Reload the page and retry.';
  }
  return firstOf(code, fallback, deniedCopy('This review is not available.'));
}

function ApproveForm({
  submissionId,
  outstanding,
  onDone,
  onClose,
  onPendingChange,
}: {
  submissionId: string;
  outstanding: string;
  onDone: () => void;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<PaymentApproveFormValues>({
    resolver: zodResolver(paymentApproveFormSchema),
    defaultValues: { amount: '' },
  });
  useEffect(() => {
    onPendingChange(isSubmitting);
    return () => onPendingChange(false);
  }, [isSubmitting, onPendingChange]);
  const onSubmit = handleSubmit(
    async (values) => {
      setServerError(null);
      const response = await fetch(`/api/payment-submissions/${submissionId}/approve`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ amount: { amount: values.amount.trim(), currency: 'THB' } }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
        setServerError(
          reviewErrorCopy(
            payload?.error?.code,
            payload?.error?.message ?? 'Could not approve the submission.',
          ),
        );
        return;
      }
      toast.success('Submission approved.');
      onDone();
    },
    () => setFocus('amount'),
  );
  return (
    <form
      data-testid={`payment-approve-form-${submissionId}`}
      onSubmit={onSubmit}
      noValidate
      id={`payment-approve-form-${submissionId}`}
      className="flex min-w-0 flex-col gap-3"
    >
      {serverError !== null ? (
        <p
          data-testid={`payment-approve-error-${submissionId}`}
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <FormField
        label="Approved amount (THB)"
        htmlFor={`payment-approve-amount-${submissionId}`}
        hint={`Outstanding balance: ${outstanding} THB.`}
        error={errors.amount?.message ?? ''}
        errorTestId={`payment-approve-amount-error-${submissionId}`}
      >
        <input
          data-testid={`payment-approve-amount-${submissionId}`}
          type="text"
          inputMode="decimal"
          placeholder="3000.00"
          className={INPUT_CLASS}
          {...register('amount')}
        />
      </FormField>
      <FormActions onCancel={onClose} pending={isSubmitting}>
        <Button
          data-testid={`payment-approve-submit-${submissionId}`}
          type="submit"
          loading={isSubmitting}
          size="sm"
        >
          Approve
        </Button>
      </FormActions>
    </form>
  );
}

function RejectForm({
  submissionId,
  onDone,
  onClose,
  onPendingChange,
}: {
  submissionId: string;
  onDone: () => void;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<PaymentRejectFormValues>({
    resolver: zodResolver(paymentRejectFormSchema),
    defaultValues: { reason: '' },
  });
  useEffect(() => {
    onPendingChange(isSubmitting);
    return () => onPendingChange(false);
  }, [isSubmitting, onPendingChange]);
  const onSubmit = handleSubmit(
    async (values) => {
      setServerError(null);
      const response = await fetch(`/api/payment-submissions/${submissionId}/reject`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ reason: values.reason.trim() }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
        setServerError(
          reviewErrorCopy(
            payload?.error?.code,
            payload?.error?.message ?? 'Could not reject the submission.',
          ),
        );
        return;
      }
      toast.success('Submission rejected.');
      onDone();
    },
    () => setFocus('reason'),
  );
  return (
    <form
      data-testid={`payment-reject-form-${submissionId}`}
      onSubmit={onSubmit}
      noValidate
      id={`payment-reject-form-${submissionId}`}
      className="flex min-w-0 flex-col gap-3"
    >
      {serverError !== null ? (
        <p
          data-testid={`payment-reject-error-${submissionId}`}
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <FormField
        label="Rejection reason"
        htmlFor={`payment-reject-reason-${submissionId}`}
        error={errors.reason?.message ?? ''}
        errorTestId={`payment-reject-reason-error-${submissionId}`}
      >
        <input
          data-testid={`payment-reject-reason-${submissionId}`}
          type="text"
          maxLength={2000}
          className={INPUT_CLASS}
          {...register('reason')}
        />
      </FormField>
      <FormActions onCancel={onClose} pending={isSubmitting}>
        <Button
          data-testid={`payment-reject-submit-${submissionId}`}
          type="submit"
          variant="destructive"
          loading={isSubmitting}
          size="sm"
        >
          Reject
        </Button>
      </FormActions>
    </form>
  );
}

export function PaymentSubmissionCard({
  submission,
  outstanding,
  approveBlocked,
  canReview,
  onReviewed,
}: {
  submission: PaymentSubmissionDto;
  outstanding: string;
  approveBlocked: boolean;
  canReview: boolean;
  onReviewed: () => void;
}) {
  const [working, setWorking] = useState(false);
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  const close = (): void => setDialog(null);
  return (
    <li
      data-testid={`payment-submission-${submission.id}`}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="ui-tabular min-w-0 break-all text-small leading-small text-muted-foreground">
          {submission.id.slice(0, 8)}
        </span>
        <Badge
          data-testid={`payment-submission-state-${submission.id}`}
          variant={submissionStateVariant(submission.state)}
        >
          {submissionStateLabel(submission.state)}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small leading-small text-muted-foreground ui-tabular">
        {submission.approvedAmount !== null ? (
          <span>
            Approved {submission.approvedAmount.amount} {submission.approvedAmount.currency}
          </span>
        ) : null}
        <span>
          {submission.reviewedAt === null
            ? 'Not reviewed yet'
            : formatInstant(submission.reviewedAt)}
        </span>
      </div>
      {submission.rejectReason !== null ? (
        <p
          data-testid={`payment-submission-reason-${submission.id}`}
          className="break-words text-body leading-body text-foreground"
        >
          Reason: {submission.rejectReason}
        </p>
      ) : null}
      <PaymentImage
        imageId={submission.imageId}
        alt="Payment slip attachment"
        testId={`payment-submission-slip-${submission.id}`}
      />
      {submission.state === 'PENDING' && canReview ? (
        <div className="flex min-w-0 flex-col gap-3">
          {approveBlocked ? (
            <p
              data-testid={`payment-approve-blocked-${submission.id}`}
              role="alert"
              className="text-body leading-body text-warning-foreground"
            >
              This invoice is already paid. Pending slips can only be rejected.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {!approveBlocked ? (
              <Button
                data-testid={`payment-approve-toggle-${submission.id}`}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setDialog('approve')}
              >
                Approve
              </Button>
            ) : null}
            <Button
              data-testid={`payment-reject-toggle-${submission.id}`}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setDialog('reject')}
            >
              Reject
            </Button>
          </div>
          <Dialog
            open={dialog === 'approve'}
            busy={working}
            onClose={close}
            title="Approve this slip"
            description={`Confirm the approved amount for slip ${submission.id.slice(0, 8)}.`}
            testId={`payment-approve-toggle-${submission.id}`}
            size="sm"
          >
            <ApproveForm
              onPendingChange={setWorking}
              submissionId={submission.id}
              outstanding={outstanding}
              onDone={() => {
                close();
                onReviewed();
              }}
              onClose={close}
            />
          </Dialog>
          <Dialog
            open={dialog === 'reject'}
            busy={working}
            onClose={close}
            title="Reject this slip"
            description={`The payer sees the rejection reason for slip ${submission.id.slice(0, 8)}.`}
            testId={`payment-reject-toggle-${submission.id}`}
            size="sm"
          >
            <RejectForm
              onPendingChange={setWorking}
              submissionId={submission.id}
              onDone={() => {
                close();
                onReviewed();
              }}
              onClose={close}
            />
          </Dialog>
        </div>
      ) : null}
    </li>
  );
}
