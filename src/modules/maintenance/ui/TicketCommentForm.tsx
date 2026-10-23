'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button, FormField, TEXTAREA_CLASS, cx, deniedCopy, firstOf, rateLimitedCopy, useToast } from '@/shared/ui';
import {
  TicketImageUploader,
  type TicketUploadedImage,
} from '@/modules/maintenance/ui/TicketImageUploader';
import {
  ticketCommentFormSchema,
  type TicketCommentFormValues,
} from '@/modules/maintenance/ui/maintenanceFormSchemas';

interface ErrorPayload {
  error?: { code?: string; message?: string };
}

function commentErrorCopy(code: string | undefined, fallback: string): string {
  return firstOf(code, fallback, deniedCopy('This request is not available.'), rateLimitedCopy('Too many requests. Please wait a moment and retry.'));
}

export function TicketCommentForm({
  ticketId,
  testIdPrefix,
  onCommented,
}: {
  ticketId: string;
  testIdPrefix: string;
  onCommented: () => void;
}) {
  const { toast } = useToast();
  const [images, setImages] = useState<TicketUploadedImage[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setFocus,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<TicketCommentFormValues>({
    resolver: zodResolver(ticketCommentFormSchema),
    defaultValues: { body: '' },
  });

  const onSubmit = handleSubmit(
    async (values) => {
      setServerError(null);
      const response = await fetch(`/api/maintenance/${ticketId}/comments`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          body: values.body,
          imageIds: images.map((image) => image.imageId),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
        setServerError(
          commentErrorCopy(payload?.error?.code, payload?.error?.message ?? 'Could not post this comment. Check the form and retry.'),
        );
        return;
      }
      toast.success('Comment posted.');
      reset();
      setImages([]);
      onCommented();
    },
    () => setFocus('body'),
  );

  return (
    <form data-testid={`${testIdPrefix}-comment-form`} onSubmit={onSubmit} noValidate className="flex min-w-0 flex-col gap-3">
      {serverError !== null ? (
        <p data-testid={`${testIdPrefix}-comment-error`} role="alert" className="text-body leading-body font-medium text-danger-foreground">
          {serverError}
        </p>
      ) : null}
      <FormField label="Add a comment" htmlFor={`${testIdPrefix}-comment-body`} {...(errors.body?.message === undefined ? {} : { error: errors.body.message })} required>
        <textarea
          data-testid={`${testIdPrefix}-comment-body`}
          rows={4}
          maxLength={20000}
          required
          placeholder="Share an update or ask for clarification."
          className={cx(TEXTAREA_CLASS, 'leading-6')}
          {...register('body')}
        />
      </FormField>
      <TicketImageUploader
        images={images}
        onChange={setImages}
        testIdPrefix={`${testIdPrefix}-comment`}
        maxImages={3}
        entityType="maintenance_comment"
      />
      <div>
        <Button data-testid={`${testIdPrefix}-comment-submit`} type="submit" loading={isSubmitting} size="sm">
          Post comment
        </Button>
      </div>
    </form>
  );
}
