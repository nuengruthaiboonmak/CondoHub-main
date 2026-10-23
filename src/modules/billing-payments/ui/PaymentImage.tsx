'use client';

import { useEffect, useState } from 'react';
import { Skeleton } from '@/shared/ui';

interface AccessEnvelope {
  data: { url: string; expiresAt: string };
}

export function PaymentImage({
  imageId,
  alt,
  testId,
}: {
  imageId: string;
  alt: string;
  testId: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
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
      <p
        data-testid={`${testId}-unavailable`}
        className="text-small leading-small text-muted-foreground"
      >
        Image unavailable.
      </p>
    );
  }
  if (url === null) {
    return (
      <Skeleton
        data-testid={`${testId}-loading`}
        aria-label="Loading image"
        className="h-40 w-full max-w-sm"
      />
    );
  }
  return (
    <img
      data-testid={testId}
      src={url}
      alt={alt}
      loading="lazy"
      className="h-auto w-full max-w-sm rounded-lg border border-border object-contain"
    />
  );
}
