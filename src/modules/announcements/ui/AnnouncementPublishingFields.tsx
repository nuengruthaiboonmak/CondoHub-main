'use client';

import type { UseFormRegister } from 'react-hook-form';
import { CHECKBOX_CLASS, FormField, INPUT_CLASS } from '@/shared/ui';
import type { AnnouncementFormValues, PublishMode } from './announcementFormSchema';

export function AnnouncementPublishingFields({
  mode,
  register,
  error,
  prefix,
  currentlyPublished = false,
}: {
  mode: PublishMode;
  register: UseFormRegister<AnnouncementFormValues>;
  error?: string | undefined;
  prefix: 'announcement-create' | 'announcement-edit';
  currentlyPublished?: boolean;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3">
      <legend className="mb-2 text-body font-medium text-foreground">Publishing</legend>
      <div className="flex flex-wrap gap-2">
        {(
          [
            { value: 'draft', label: 'Save as draft' },
            { value: 'now', label: currentlyPublished ? 'Keep published' : 'Publish now' },
            { value: 'scheduled', label: 'Schedule for later' },
          ] as const
        ).map((option) => (
          <label
            key={option.value}
            className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-small has-checked:border-primary has-checked:bg-primary/5"
          >
            <input
              type="radio"
              data-testid={`${prefix}-mode-${option.value}`}
              value={option.value}
              className={CHECKBOX_CLASS}
              {...register('publishMode')}
            />
            {option.label}
          </label>
        ))}
      </div>
      {mode === 'scheduled' ? (
        <FormField label="Publish at" htmlFor={`${prefix}-publish-at`} error={error ?? ''} required>
          <input
            type="datetime-local"
            required
            data-testid={`${prefix}-publish-at`}
            className={INPUT_CLASS}
            {...register('publishAt')}
          />
        </FormField>
      ) : null}
    </fieldset>
  );
}
