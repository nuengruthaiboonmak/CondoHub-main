'use client';

import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { Lightbox } from './Lightbox';
import { Skeleton } from './Skeleton';

interface AccessEnvelope {
  data: { url: string; expiresAt: string };
}

export function SecureImage({
  imageId,
  alt,
  enlargeLabel,
  lightboxTitle,
  testId,
  buttonClassName,
  imgClassName,
  skeletonClassName = 'h-40',
  failedClassName = 'flex items-center gap-2 text-small leading-small text-muted-foreground',
}: {
  imageId: string;
  alt: string;
  enlargeLabel: string;
  lightboxTitle: string;
  testId: string;
  buttonClassName: string;
  imgClassName: string;
  skeletonClassName?: string;
  failedClassName?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    setPreviewOpen(false);
    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/images/${imageId}/access`);
        if (!response.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const envelope = (await response.json()) as AccessEnvelope;
        if (!cancelled) setUrl(envelope.data.url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [imageId]);

  if (failed) {
    return (
      <p data-testid={`${testId}-unavailable`} className={failedClassName}>
        <ImageOff aria-hidden="true" className="size-4 shrink-0" />
        Image unavailable.
      </p>
    );
  }
  if (url === null) {
    return (
      <Skeleton
        data-testid={`${testId}-loading`}
        aria-label="Loading image"
        className={skeletonClassName}
      />
    );
  }
  return (
    <>
      <button
        type="button"
        data-testid={`${testId}-open`}
        onClick={() => setPreviewOpen(true)}
        aria-label={enlargeLabel}
        className={buttonClassName}
      >
        <img
          data-testid={testId}
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={imgClassName}
        />
      </button>
      <Lightbox
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        src={url}
        alt={alt}
        title={lightboxTitle}
        testId={`${testId}-preview`}
      />
    </>
  );
}
