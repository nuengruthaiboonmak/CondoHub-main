'use client';

import { ResourceStatusControl } from '@/shared/ui';

export function AnnouncementStatusControl({ id, hidden }: { id: string; hidden: boolean }) {
  return (
    <ResourceStatusControl
      resource="announcement"
      active={!hidden}
      endpoint={`/api/admin/announcements/${id}`}
      testId="announcement-status"
      description={
        hidden
          ? 'The announcement will follow its saved publishing schedule again. Drafts remain drafts.'
          : 'Residents will no longer see this announcement. Its content and publishing schedule stay recorded.'
      }
      requestBody={() => ({ hiddenAt: hidden ? null : new Date().toISOString() })}
    />
  );
}
