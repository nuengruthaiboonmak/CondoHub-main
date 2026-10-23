'use client';

import Link from 'next/link';
import { ArrowUpRight, Image as ImageIcon } from 'lucide-react';
import { AnnouncementImage } from './AnnouncementImage';

export function AnnouncementPreview({
  announcement,
  linkTestId,
}: {
  announcement: {
    id: string;
    title: string;
    body: string;
    publishAt: string | null;
    images: Array<{ id: string }>;
  };
  linkTestId?: string | undefined;
}) {
  const image = announcement.images[0];
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
      {image ? (
        <div className="p-3 pb-0">
          <AnnouncementImage
            imageId={image.id}
            testId={`announcement-preview-image-${announcement.id}`}
            compact
          />
        </div>
      ) : null}
      <div className="flex min-w-0 flex-col gap-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-caption text-muted-foreground">
          <span>Community update</span>
          {announcement.publishAt ? (
            <time dateTime={announcement.publishAt}>
              {new Intl.DateTimeFormat('en-US', {
                timeZone: 'Asia/Bangkok',
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              }).format(new Date(announcement.publishAt))}
            </time>
          ) : null}
        </div>
        <h2 className="text-heading font-semibold text-foreground">
          <Link
            href={`/announcements/${announcement.id}`}
            data-testid={linkTestId}
            className="flex items-start gap-3 rounded-lg hover:text-link"
          >
            <span className="min-w-0 flex-1 break-words">{announcement.title}</span>
            <ArrowUpRight
              aria-hidden="true"
              className="mt-1 size-4 shrink-0 text-muted-foreground"
            />
          </Link>
        </h2>
        <p className="line-clamp-3 whitespace-pre-line break-words text-body leading-relaxed text-body-secondary">
          {announcement.body}
        </p>
        {announcement.images.length > 1 ? (
          <Link
            href={`/announcements/${announcement.id}`}
            className="inline-flex w-fit items-center gap-1.5 text-small text-link"
          >
            <ImageIcon aria-hidden="true" className="size-4" />
            View all {announcement.images.length} images
          </Link>
        ) : null}
      </div>
    </article>
  );
}
