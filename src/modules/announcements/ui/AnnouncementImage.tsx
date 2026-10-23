'use client';

import { SecureImage } from '@/shared/ui';

export function AnnouncementImage({
  imageId,
  testId,
  compact = false,
}: {
  imageId: string;
  testId: string;
  compact?: boolean;
}) {
  return (
    <SecureImage
      imageId={imageId}
      alt="Announcement attachment"
      enlargeLabel="Enlarge announcement attachment"
      lightboxTitle="Announcement attachment"
      testId={testId}
      buttonClassName="block w-full cursor-zoom-in overflow-hidden rounded-lg border border-border bg-surface transition-[border-color,opacity] duration-150 ease-out hover:border-border-strong hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring motion-reduce:transition-none"
      imgClassName={
        compact
          ? 'aspect-[16/9] max-h-72 w-full bg-background object-contain'
          : 'h-auto max-h-96 w-full object-contain'
      }
    />
  );
}
