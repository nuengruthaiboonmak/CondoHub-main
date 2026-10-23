'use client';
import { FormActions } from '@/shared/ui/FormActions';

import { useFormDialog } from '@/shared/ui/FormDialog';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { Button, FormField, INPUT_BASE_CLASS, cx, useToast } from '@/shared/ui';
import { AnnouncementPublishingFields } from './AnnouncementPublishingFields';
import {
  announcementFormSchema,
  publishingTimestamp,
  type AnnouncementFormValues,
} from './announcementFormSchema';
import {
  AnnouncementImageUploader,
  type UploadedImage,
} from '@/modules/announcements/ui/AnnouncementImageUploader';

export function AnnouncementCreateForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<AnnouncementFormValues>({
    resolver: zodResolver(announcementFormSchema),
    defaultValues: { publishMode: 'draft' },
  });
  const publishMode = watch('publishMode');

  const dialog = useFormDialog(isSubmitting);

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const response = await fetch('/api/admin/announcements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: values.title,
        body: values.body,
        publishAt: publishingTimestamp(values.publishMode, values.publishAt),
        imageIds: images.map((image) => image.imageId),
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      setServerError(
        payload?.error?.message ?? 'Could not create this announcement. Check the form and retry.',
      );
      return;
    }
    const created = (await response.json().catch(() => null)) as { data?: { id?: string } } | null;
    if (!created?.data?.id) {
      setServerError('The announcement was created. Open the announcements list to find it.');
      return;
    }
    toast.success('Announcement created.');
    dialog?.complete();
    router.push(`/admin/announcements/${created.data.id}`);
    router.refresh();
  });

  return (
    <form
      data-testid="announcement-create-form"
      onSubmit={onSubmit}
      noValidate
      className="flex min-w-0 flex-col gap-4"
    >
      {serverError !== null ? (
        <p
          data-testid="announcement-create-error"
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {serverError}
        </p>
      ) : null}
      <FormField
        label="Title"
        htmlFor="announcement-create-title"
        {...(errors.title?.message === undefined ? {} : { error: errors.title.message })}
        required
      >
        <input
          data-testid="announcement-create-title"
          type="text"
          required
          className={cx(INPUT_BASE_CLASS, 'h-10')}
          {...register('title')}
        />
      </FormField>
      <FormField
        label="Body"
        htmlFor="announcement-create-body"
        {...(errors.body?.message === undefined ? {} : { error: errors.body.message })}
        required
      >
        <textarea
          data-testid="announcement-create-body"
          rows={6}
          required
          className={cx(INPUT_BASE_CLASS, 'py-2 leading-6')}
          {...register('body')}
        />
      </FormField>
      <AnnouncementPublishingFields
        mode={publishMode}
        register={register}
        error={errors.publishAt?.message}
        prefix="announcement-create"
      />
      <AnnouncementImageUploader
        images={images}
        onChange={(next) => {
          setImages(next);
          dialog?.markDirty();
        }}
        testIdPrefix="announcement-create"
      />
      <FormActions
        onCancel={() => (dialog ? dialog.requestClose() : router.push('/admin/announcements'))}
        pending={isSubmitting}
        cancelTestId="announcement-create-cancel"
      >
        <Button data-testid="announcement-create-submit" type="submit" loading={isSubmitting}>
          Create announcement
        </Button>
      </FormActions>
    </form>
  );
}
