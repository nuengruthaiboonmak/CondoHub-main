'use client';

import { useRef, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { Button } from '@/shared/ui';

export interface UploadedImage {
  imageId: string;
  fileName: string;
  byteSize: number;
  mimeVerified: string;
}

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
const MAX_IMAGES = 5;

function putWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void,
  onXhr: (xhr: XMLHttpRequest) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed with status ${xhr.status}.`));
    };
    xhr.onerror = () => reject(new Error('Upload failed.'));
    xhr.onabort = () => reject(new Error('Upload cancelled.'));
    onXhr(xhr);
    xhr.send(file);
  });
}

export function AnnouncementImageUploader({
  images,
  onChange,
  testIdPrefix,
}: {
  images: UploadedImage[];
  onChange: (images: UploadedImage[]) => void;
  testIdPrefix: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const cancelledRef = useRef(false);
  const [progress, setProgress] = useState<{ fileName: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function uploadFile(file: File): Promise<void> {
    if (!ACCEPTED.includes(file.type)) {
      setError('Unsupported file type. Supported types: JPEG, PNG, WebP.');
      return;
    }
    if (images.length >= MAX_IMAGES) {
      setError(`Too many images. The maximum is ${MAX_IMAGES}.`);
      return;
    }
    setBusy(true);
    setError(null);
    cancelledRef.current = false;
    setProgress({ fileName: file.name, percent: 0 });
    try {
      const intentResponse = await fetch('/api/images/intents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          scope: 'ANNOUNCEMENT',
          entityRef: { type: 'announcement', id: null },
          contentType: file.type,
          fileName: file.name.slice(0, 255),
        }),
      });
      if (!intentResponse.ok) {
        const payload = (await intentResponse.json().catch(() => null)) as ErrorEnvelope | null;
        throw new Error(payload?.error.message ?? 'Could not start the upload.');
      }
      const intent = (await intentResponse.json()) as IntentEnvelope;
      if (cancelledRef.current) throw new Error('Upload cancelled.');
      await putWithProgress(
        intent.data.uploadUrl,
        file,
        (percent) => setProgress({ fileName: file.name, percent }),
        (xhr) => {
          xhrRef.current = xhr;
        },
      );
      if (cancelledRef.current) throw new Error('Upload cancelled.');
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
      onChange([
        ...images,
        {
          imageId: completed.data.imageId,
          fileName: file.name,
          byteSize: completed.data.byteSize,
          mimeVerified: completed.data.mimeVerified,
        },
      ]);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
    } finally {
      xhrRef.current = null;
      setBusy(false);
      setProgress(null);
      if (inputRef.current !== null) inputRef.current.value = '';
    }
  }

  function cancelUpload(): void {
    cancelledRef.current = true;
    xhrRef.current?.abort();
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-body leading-body font-medium text-foreground">
          Images ({images.length}/{MAX_IMAGES})
        </span>
        <Button
          data-testid={`${testIdPrefix}-upload-btn`}
          type="button"
          variant="secondary"
          size="sm"
          loading={busy}
          disabled={images.length >= MAX_IMAGES}
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus aria-hidden="true" className="size-4" />
          Add image
        </Button>
      </div>
      <input
        ref={inputRef}
        data-testid={`${testIdPrefix}-upload-input`}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Choose an image to upload"
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file !== undefined) void uploadFile(file);
        }}
      />
      <p className="text-xs leading-6 text-muted-foreground">
        JPEG, PNG, or WebP. Up to 5 MB per image, up to 5 images.
      </p>
      {progress !== null ? (
        <div data-testid={`${testIdPrefix}-upload-progress`} role="status" className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              Uploading {progress.fileName} — {progress.percent}%
            </span>
            <Button
              data-testid={`${testIdPrefix}-upload-cancel`}
              type="button"
              variant="ghost"
              size="sm"
              onClick={cancelUpload}
            >
              <X aria-hidden="true" className="size-4" />
              Cancel
            </Button>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-skeleton">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      ) : null}
      {error !== null ? (
        <p data-testid={`${testIdPrefix}-upload-error`} role="alert" className="text-body leading-body font-medium text-danger-foreground">
          {error}
        </p>
      ) : null}
      {images.length > 0 ? (
        <ul data-testid={`${testIdPrefix}-image-list`} className="flex min-w-0 flex-col rounded-lg border border-border bg-surface">
          {images.map((image) => (
            <li
              key={image.imageId}
              className="flex min-w-0 items-center justify-between gap-2 border-b border-border p-2 pl-3 text-body leading-body last:border-b-0"
            >
              <span className="min-w-0 truncate text-foreground">{image.fileName}</span>
              <Button
                data-testid={`${testIdPrefix}-remove-${image.imageId}`}
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove ${image.fileName}`}
                onClick={() => onChange(images.filter((item) => item.imageId !== image.imageId))}
              >
                <X aria-hidden="true" className="size-4" />
                Remove
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
