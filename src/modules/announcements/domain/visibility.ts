export type AnnouncementStatus = 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'HIDDEN';

export interface AnnouncementTimestamps {
  publishAt: Date | null;
  hiddenAt: Date | null;
}

export function deriveAnnouncementStatus(
  announcement: AnnouncementTimestamps,
  now: Date,
): AnnouncementStatus {
  if (announcement.hiddenAt !== null) return 'HIDDEN';
  if (announcement.publishAt === null) return 'DRAFT';
  if (announcement.publishAt.getTime() > now.getTime()) return 'SCHEDULED';
  return 'PUBLISHED';
}

export function isAnnouncementPublished(announcement: AnnouncementTimestamps, now: Date): boolean {
  return deriveAnnouncementStatus(announcement, now) === 'PUBLISHED';
}
