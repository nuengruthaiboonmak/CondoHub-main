'use client';

import { SecureImage } from '@/shared/ui';

export function ChatImageBubble({
  imageId,
  alt,
  testId,
}: {
  imageId: string;
  alt: string;
  testId: string;
}) {
  return (
    <div className="w-64 max-w-full min-w-0">
      <SecureImage
        imageId={imageId}
        alt={alt}
        enlargeLabel="Open image preview"
        lightboxTitle="Image preview"
        testId={testId}
        buttonClassName="block h-48 w-full overflow-hidden rounded-xl border border-border bg-surface transition-[opacity,transform] duration-150 ease-out hover:opacity-90 focus-visible:outline-none motion-reduce:transition-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        imgClassName="h-full w-full object-contain"
        skeletonClassName="h-48 w-full"
        failedClassName="flex h-48 w-full items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 text-center text-small leading-small text-muted-foreground"
      />
    </div>
  );
}
