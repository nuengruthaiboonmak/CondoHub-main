import 'server-only';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import { Badge, EmptyState } from '@/shared/ui';
import { getAnnouncementDetail } from '@/modules/announcements/application/index';
import { AnnouncementImage } from '@/modules/announcements/ui/AnnouncementImage';

export const revalidate = 60;

function formatDate(value: string | null): string {
  if (value === null) return 'Draft';
  const date = new Date(value);
  return date.toLocaleString('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function AnnouncementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/announcements');
  if (actor.mustChangePassword) redirect('/change-password');
  if (actor.accountStatus !== 'ACTIVE') redirect('/login?returnUrl=/announcements');
  const { id } = await params;
  const detail = await getAnnouncementDetail(actor, id, systemClock.now());
  if (detail === null) {
    return (
      <main
        data-testid="announcement-detail-page"
        className="mx-auto w-full max-w-[var(--ui-content-wide)] p-4 sm:p-6"
      >
        <EmptyState
          data-testid="announcement-detail-missing"
          title="Announcement not available"
          description="This announcement does not exist or is no longer visible."
          action={
            <Link
              data-testid="announcement-detail-back"
              href="/announcements"
              className="inline-flex items-center gap-1 text-body leading-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
              Back to announcements
            </Link>
          }
        />
      </main>
    );
  }
  return (
    <main
      data-testid="announcement-detail-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <Link
        data-testid="announcement-detail-back"
        href="/announcements"
        className="inline-flex w-fit items-center gap-1.5 rounded-md text-body leading-body font-medium text-link underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to announcements
      </Link>
      <article className="flex min-w-0 flex-col gap-4 max-w-4xl rounded-xl border border-border bg-surface p-5 sm:p-8">
        <div className="flex min-w-0 flex-col gap-2">
          <h1
            data-testid="announcement-detail-title"
            className="break-words text-display leading-display font-semibold tracking-tight text-foreground"
          >
            {detail.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span data-testid="announcement-detail-date">{formatDate(detail.publishAt)}</span>
            {detail.editedAt !== null ? (
              <Badge data-testid="announcement-detail-edited" variant="neutral">
                Edited
              </Badge>
            ) : null}
          </div>
        </div>
        <p
          data-testid="announcement-detail-body"
          className="whitespace-pre-wrap break-words text-body leading-relaxed text-body-secondary"
        >
          {detail.body}
        </p>
        {detail.images.length > 0 ? (
          <div
            className="flex min-w-0 flex-col gap-3 border-t border-border pt-4"
            aria-label="Attached images"
          >
            {detail.images.map((image, index) => (
              <AnnouncementImage
                key={image.id}
                imageId={image.id}
                testId={`announcement-detail-image-${index}`}
              />
            ))}
          </div>
        ) : null}
      </article>
    </main>
  );
}
