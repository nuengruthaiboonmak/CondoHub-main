'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ImagePlus, SendHorizontal, X } from 'lucide-react';
import { Button, FormField } from '@/shared/ui';
import {
  CHAT_COMPOSER_TEXT_MAX,
  chatComposerFormSchema,
  type ChatComposerFormValues,
} from '@/modules/room-chat/ui/chatFormSchemas';

interface IntentEnvelope {
  data: { imageId: string; uploadUrl: string; expiresAt: string };
}

interface CompleteEnvelope {
  data: { imageId: string; byteSize: number; mimeVerified: string };
}

interface ErrorEnvelope {
  error: { code: string; message: string };
}

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];

function putBytes(url: string, file: File): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed with status ${xhr.status}.`));
    };
    xhr.onerror = () => reject(new Error('Upload failed.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    xhr.send(file);
  });
}

export interface ChatComposerAttachment {
  imageId: string;
  fileName: string;
}

export function ChatComposer({
  onSend,
  sending,
  testIdPrefix,
}: {
  onSend: (input: { text: string; attachment: ChatComposerAttachment | null }) => void;
  sending: boolean;
  testIdPrefix: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [attachment, setAttachment] = useState<ChatComposerAttachment | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    setFocus,
    reset,
    formState: { errors },
  } = useForm<ChatComposerFormValues>({
    resolver: zodResolver(chatComposerFormSchema),
    defaultValues: { text: '' },
  });

  const draft = useWatch({ control, name: 'text' });
  const textField = register('text');

  useEffect(() => {
    if (previewFile === null) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(previewFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewFile]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(144, Math.max(56, textarea.scrollHeight))}px`;
  }, [draft]);

  function clearAttachment(): void {
    setAttachment(null);
    setPreviewFile(null);
  }

  async function uploadFile(file: File): Promise<void> {
    if (uploading || sending) return;
    if (file.size > 5_000_000) {
      setUploadError('The image is too large. Choose an image up to 5 MB.');
      return;
    }
    if (!ACCEPTED.includes(file.type)) {
      setUploadError('Unsupported file type. Supported types: JPEG, PNG, WebP.');
      return;
    }
    if (attachment !== null) {
      setUploadError('Only 1 image per message. Remove the current image first.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    try {
      const intentResponse = await fetch('/api/images/intents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'CHAT',
          entityRef: { type: 'chat_message', id: null },
          contentType: file.type,
          fileName: file.name.slice(0, 255),
        }),
      });
      if (!intentResponse.ok) {
        const payload = (await intentResponse.json().catch(() => null)) as ErrorEnvelope | null;
        throw new Error(payload?.error.message ?? 'Could not start the upload.');
      }
      const intent = (await intentResponse.json()) as IntentEnvelope;
      await putBytes(intent.data.uploadUrl, file);
      const completeResponse = await fetch(`/api/images/${intent.data.imageId}/complete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (!completeResponse.ok) {
        const payload = (await completeResponse.json().catch(() => null)) as ErrorEnvelope | null;
        throw new Error(payload?.error.message ?? 'The image could not be verified.');
      }
      const completed = (await completeResponse.json()) as CompleteEnvelope;
      setAttachment({ imageId: completed.data.imageId, fileName: file.name });
      setPreviewFile(file);
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (inputRef.current !== null) inputRef.current.value = '';
    }
  }

  const onSubmit = handleSubmit(
    (values) => {
      if (uploading || sending) return;
      const text = values.text.trim();
      if (text === '' && attachment === null) {
        setFocus('text');
        return;
      }
      onSend({ text, attachment });
      reset();
      clearAttachment();
      setUploadError(null);
    },
    () => setFocus('text'),
  );

  return (
    <form
      data-testid={`${testIdPrefix}-composer`}
      onSubmit={onSubmit}
      noValidate
      className="flex min-w-0 shrink-0 flex-col gap-2.5 border-t border-border bg-surface p-3 sm:px-5 sm:py-4"
    >
      <input
        ref={inputRef}
        data-testid={`${testIdPrefix}-composer-upload-input`}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose an image to attach"
        disabled={uploading || sending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void uploadFile(file);
        }}
      />
      {attachment !== null ? (
        <div
          data-testid={`${testIdPrefix}-composer-attachment`}
          className="flex min-w-0 items-center gap-3 rounded-xl border border-border bg-background p-2 text-sm"
        >
          {previewUrl !== null ? (
            <img
              src={previewUrl}
              alt="Image ready to send"
              data-testid={`${testIdPrefix}-composer-preview`}
              className="size-12 shrink-0 rounded-lg object-cover"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-foreground">{attachment.fileName}</p>
            <p className="text-xs text-muted-foreground">Ready to send</p>
          </div>
          <Button
            data-testid={`${testIdPrefix}-composer-attachment-remove`}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove ${attachment.fileName}`}
            disabled={sending}
            onClick={clearAttachment}
          >
            <X aria-hidden="true" className="size-4" />
            Remove
          </Button>
        </div>
      ) : null}
      {uploading ? (
        <p
          data-testid={`${testIdPrefix}-composer-upload-progress`}
          role="status"
          className="text-small leading-small text-muted-foreground"
        >
          Uploading the image.
        </p>
      ) : null}
      {uploadError !== null ? (
        <p
          data-testid={`${testIdPrefix}-composer-upload-error`}
          role="alert"
          className="text-body leading-body font-medium text-danger-foreground"
        >
          {uploadError}
        </p>
      ) : null}
      <div className="rounded-xl border border-input-border bg-background p-2 focus-within:border-focus-ring focus-within:ring-1 focus-within:ring-focus-ring">
        <FormField
          label="Message"
          className="[&>label]:sr-only"
          htmlFor={`${testIdPrefix}-composer-text`}
          {...(errors.text?.message === undefined ? {} : { error: errors.text.message })}
          errorTestId={`${testIdPrefix}-composer-text-error`}
        >
          <textarea
            data-testid={`${testIdPrefix}-composer-text`}
            rows={2}
            maxLength={CHAT_COMPOSER_TEXT_MAX}
            placeholder="Write a message to the room."
            className="w-full min-w-0 resize-none rounded-lg border-0 bg-transparent px-2 py-1.5 text-body leading-6 text-foreground placeholder:text-input-placeholder focus:outline-none"
            {...textField}
            ref={(node) => {
              textField.ref(node);
              textareaRef.current = node;
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void onSubmit();
            }}
          />
        </FormField>
        <div className="flex items-center gap-2 pt-1">
          <Button
            data-testid={`${testIdPrefix}-composer-attach`}
            type="button"
            variant="ghost"
            size="sm"
            title="Attach a JPEG, PNG, or WebP image up to 5 MB"
            loading={uploading}
            disabled={attachment !== null || sending}
            onClick={() => inputRef.current?.click()}
            className="min-h-10 rounded-lg"
          >
            <ImagePlus aria-hidden="true" className="size-4" />
            <span className="text-small">Attach image</span>
          </Button>
          <span className="ml-auto hidden text-xs text-muted-foreground lg:block">
            Enter to send · Shift + Enter for a new line
          </span>
          <Button
            data-testid={`${testIdPrefix}-composer-send`}
            type="submit"
            loading={sending}
            disabled={uploading || (draft.trim() === '' && attachment === null)}
            size="sm"
            className="ml-auto min-h-10 rounded-lg lg:ml-2"
          >
            <SendHorizontal aria-hidden="true" className="size-4" />
            Send
          </Button>
        </div>
      </div>
    </form>
  );
}
