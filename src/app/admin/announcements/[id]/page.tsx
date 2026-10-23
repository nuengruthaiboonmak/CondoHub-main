import 'server-only';
import { redirect } from 'next/navigation';
import { getActorFromSession } from '@/shared/auth/actor';
import { systemClock } from '@/shared/utils/clock';
import {
  ActionMenu,
  Badge,
  FormDialog,
  PageHeader,
  ResourceDeleteControl,
  SectionCard,
} from '@/shared/ui';
import { getAnnouncementDetail } from '@/modules/announcements/application/index';
import { AnnouncementEditForm } from '@/modules/announcements/ui/AnnouncementEditForm';
import { AnnouncementStatusControl } from '@/modules/announcements/ui/AnnouncementStatusControl';
import { AnnouncementImage } from '@/modules/announcements/ui/AnnouncementImage';

export default async function AdminAnnouncementEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await getActorFromSession();
  if (actor === null) redirect('/login?returnUrl=/admin/announcements');
  if (!actor.isSystemAdmin) redirect('/');
  if (actor.mustChangePassword) redirect('/change-password');
  const { id } = await params;
  const detail = await getAnnouncementDetail(actor, id, systemClock.now());
  if (detail === null) redirect('/admin/announcements');
  return (
    <main
      data-testid="admin-announcement-edit-page"
      className="mx-auto flex w-full max-w-[var(--ui-content-wide)] flex-col gap-7 px-4 py-7 sm:px-6 lg:p-8"
    >
      <PageHeader
        title={detail.title}
        description="Review this community update and its publishing settings."
        backHref="/admin/announcements"
        backLabel="Back to announcements"
        backTestId="admin-announcement-edit-back"
        actions={
          <ActionMenu label="Announcement actions" testId="announcement-actions">
            <FormDialog
              icon="edit"
              triggerLabel="Edit announcement"
              title="Edit announcement"
              triggerTestId="announcement-edit-open"
              testId="announcement-edit-dialog"
              size="lg"
            >
              <AnnouncementEditForm
                announcementId={detail.id}
                initialTitle={detail.title}
                initialBody={detail.body}
                initialPublishAt={detail.publishAt}
                initialHiddenAt={detail.hiddenAt}
                initialImages={detail.images.map((image) => ({
                  imageId: image.id,
                  byteSize: image.byteSize,
                  mime: image.mime,
                }))}
                revisions={detail.revisions}
              />
            </FormDialog>
            <AnnouncementStatusControl id={detail.id} hidden={detail.hiddenAt !== null} />
            <ResourceDeleteControl
              resource="announcement"
              name={detail.title}
              endpoint={`/api/admin/announcements/${detail.id}`}
              testId="announcement-delete"
              redirectTo="/admin/announcements"
              description="This announcement will be removed from the directory and residents will no longer see it. Revision history stays recorded."
            />
          </ActionMenu>
        }
      />
      <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <SectionCard title="Announcement">
          <p className="whitespace-pre-wrap break-words text-body leading-relaxed text-body-secondary">
            {detail.body}
          </p>
          {detail.images.length > 0 ? (
            <div className="mt-6 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
              {detail.images.map((image, index) => (
                <AnnouncementImage
                  key={image.id}
                  imageId={image.id}
                  testId={`admin-announcement-edit-image-${index}`}
                />
              ))}
            </div>
          ) : (
            <p
              data-testid="admin-announcement-edit-no-images"
              className="mt-6 text-small text-muted-foreground"
            >
              No images attached.
            </p>
          )}
        </SectionCard>
        <SectionCard title="Publishing">
          <dl className="flex flex-col gap-5 text-body">
            <div>
              <dt className="mb-2 text-caption text-muted-foreground">Status</dt>
              <dd>
                <Badge
                  variant={
                    detail.hiddenAt ? 'neutral' : detail.status === 'PUBLISHED' ? 'success' : 'info'
                  }
                >
                  {detail.status}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-caption text-muted-foreground">Publish date</dt>
              <dd className="mt-1 font-medium">
                {detail.publishAt
                  ? new Intl.DateTimeFormat('en-US', {
                      timeZone: 'Asia/Bangkok',
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(detail.publishAt))
                  : 'Not scheduled'}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-muted-foreground">Revision</dt>
              <dd className="mt-1 font-medium">{detail.revision}</dd>
            </div>
          </dl>
        </SectionCard>
      </div>
    </main>
  );
}
