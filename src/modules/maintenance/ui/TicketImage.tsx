'use client';

import { SecureImage } from '@/shared/ui';

export function TicketImage({
  imageId,
  alt,
  testId,
}: {
  imageId: string;
  alt: string;
  testId: string;
}) {
  return (
    <SecureImage
      imageId={imageId}
      alt={alt}
      enlargeLabel={`Enlarge ${alt}`}
      lightboxTitle={alt}
      testId={testId}
      buttonClassName="block w-full cursor-zoom-in overflow-hidden rounded-lg border border-border bg-surface transition-[border-color,opacity] duration-150 ease-out hover:border-border-strong hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
      imgClassName="h-auto max-h-72 w-full object-contain"
    />
  );
}
