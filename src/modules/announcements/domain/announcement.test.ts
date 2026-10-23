import { describe, expect, it } from 'vitest';
import type { Actor } from '@/shared/auth/actor';
import {
  deriveAnnouncementStatus,
  isAnnouncementPublished,
} from './visibility';
import { compareFeedOrder, sortFeedOrder } from './feedOrder';
import { bumpRevision, snapshotAnnouncement } from './revisionPolicy';
import { canSeeAnnouncement } from './announcementPolicy';

const NOW = new Date('2026-10-14T09:00:00.000Z');
const PAST = new Date('2026-10-14T08:00:00.000Z');
const FUTURE = new Date('2026-10-14T10:00:00.000Z');

function actor(overrides?: Partial<Actor>): Actor {
  return {
    userId: 'user-1',
    isSystemAdmin: false,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    ...overrides,
  };
}

describe('UT-AN-01 visibility by publishAt/hiddenAt', () => {
  it('draft has no publishAt and never publishes on its own', () => {
    expect(deriveAnnouncementStatus({ publishAt: null, hiddenAt: null }, NOW)).toBe('DRAFT');
    expect(
      deriveAnnouncementStatus({ publishAt: null, hiddenAt: null }, new Date(NOW.getTime() + 86_400_000)),
    ).toBe('DRAFT');
    expect(isAnnouncementPublished({ publishAt: null, hiddenAt: null }, NOW)).toBe(false);
  });

  it('scheduled becomes published when the clock passes publishAt without any stored state', () => {
    expect(deriveAnnouncementStatus({ publishAt: FUTURE, hiddenAt: null }, NOW)).toBe('SCHEDULED');
    expect(isAnnouncementPublished({ publishAt: FUTURE, hiddenAt: null }, NOW)).toBe(false);
    expect(deriveAnnouncementStatus({ publishAt: FUTURE, hiddenAt: null }, FUTURE)).toBe('PUBLISHED');
    expect(deriveAnnouncementStatus({ publishAt: PAST, hiddenAt: null }, NOW)).toBe('PUBLISHED');
    expect(isAnnouncementPublished({ publishAt: PAST, hiddenAt: null }, NOW)).toBe(true);
  });

  it('hiddenAt conceals regardless of publishAt', () => {
    expect(deriveAnnouncementStatus({ publishAt: PAST, hiddenAt: PAST }, NOW)).toBe('HIDDEN');
    expect(deriveAnnouncementStatus({ publishAt: null, hiddenAt: PAST }, NOW)).toBe('HIDDEN');
    expect(deriveAnnouncementStatus({ publishAt: FUTURE, hiddenAt: PAST }, NOW)).toBe('HIDDEN');
    expect(isAnnouncementPublished({ publishAt: PAST, hiddenAt: PAST }, NOW)).toBe(false);
  });
});

describe('UT-AN-01 project-wide audience', () => {
  const published = { publishAt: PAST, hiddenAt: null };

  it('every active account sees the same published set', () => {
    const admin = actor({ isSystemAdmin: true });
    const owner = actor({ userId: 'owner-1' });
    const resident = actor({ userId: 'resident-9' });
    for (const candidate of [admin, owner, resident]) {
      expect(canSeeAnnouncement(candidate, published, 'FEED', NOW)).toEqual({ allowed: true });
      expect(canSeeAnnouncement(candidate, published, 'DETAIL', NOW)).toEqual({ allowed: true });
      expect(canSeeAnnouncement(candidate, published, 'IMAGE', NOW)).toEqual({ allowed: true });
    }
  });

  it('suspended and first-login accounts see nothing', () => {
    expect(
      canSeeAnnouncement(actor({ accountStatus: 'SUSPENDED' }), published, 'FEED', NOW),
    ).toEqual({ allowed: false, reason: 'ACCOUNT_SUSPENDED' });
    expect(
      canSeeAnnouncement(actor({ mustChangePassword: true }), published, 'DETAIL', NOW),
    ).toEqual({ allowed: false, reason: 'FIRST_LOGIN_REQUIRED' });
  });

  it('non-admin cannot see drafts, scheduled, hidden, or the archive', () => {
    const resident = actor();
    expect(
      canSeeAnnouncement(resident, { publishAt: null, hiddenAt: null }, 'FEED', NOW),
    ).toEqual({ allowed: false, reason: 'NOT_PUBLISHED' });
    expect(
      canSeeAnnouncement(resident, { publishAt: FUTURE, hiddenAt: null }, 'DETAIL', NOW),
    ).toEqual({ allowed: false, reason: 'NOT_PUBLISHED' });
    expect(
      canSeeAnnouncement(resident, { publishAt: PAST, hiddenAt: PAST }, 'FEED', NOW),
    ).toEqual({ allowed: false, reason: 'ANNOUNCEMENT_HIDDEN' });
    expect(canSeeAnnouncement(resident, published, 'ARCHIVE', NOW)).toEqual({
      allowed: false,
      reason: 'ADMIN_ONLY',
    });
  });

  it('admin sees drafts, scheduled, hidden archive, and hidden detail', () => {
    const admin = actor({ isSystemAdmin: true });
    expect(canSeeAnnouncement(admin, { publishAt: null, hiddenAt: null }, 'FEED', NOW)).toEqual({
      allowed: true,
    });
    expect(canSeeAnnouncement(admin, { publishAt: FUTURE, hiddenAt: null }, 'DETAIL', NOW)).toEqual(
      { allowed: true },
    );
    expect(canSeeAnnouncement(admin, published, 'ARCHIVE', NOW)).toEqual({ allowed: true });
    expect(
      canSeeAnnouncement(admin, { publishAt: PAST, hiddenAt: PAST }, 'DETAIL', NOW),
    ).toEqual({ allowed: true });
    expect(
      canSeeAnnouncement(admin, { publishAt: PAST, hiddenAt: PAST }, 'IMAGE', NOW),
    ).toEqual({ allowed: true });
    expect(canSeeAnnouncement(admin, { publishAt: PAST, hiddenAt: PAST }, 'FEED', NOW)).toEqual(
      { allowed: false, reason: 'ANNOUNCEMENT_HIDDEN' },
    );
  });
});

describe('UT-AN-01 feed ordering publishedAt DESC then id DESC', () => {
  it('orders by published instant first, uuid string second', () => {
    const rows = [
      { publishAt: PAST, id: 'b0000000-0000-4000-8000-000000000000' },
      { publishAt: NOW, id: 'a0000000-0000-4000-8000-000000000000' },
      { publishAt: PAST, id: 'c0000000-0000-4000-8000-000000000000' },
    ];
    expect(sortFeedOrder(rows).map((row) => row.id)).toEqual([
      'a0000000-0000-4000-8000-000000000000',
      'c0000000-0000-4000-8000-000000000000',
      'b0000000-0000-4000-8000-000000000000',
    ]);
    expect(
      compareFeedOrder({ publishAt: PAST, id: 'a' }, { publishAt: PAST, id: 'a' }),
    ).toBe(0);
  });
});

describe('UT-AN-01 revision metadata', () => {
  it('bump increments revision and stamps editedAt', () => {
    expect(bumpRevision(1, NOW)).toEqual({ nextRevision: 2, editedAt: NOW, snapshotVersion: 2 });
  });

  it('snapshot captures the full content row', () => {
    expect(
      snapshotAnnouncement({
        title: 'Lobby cleaning',
        body: 'Closed 9 to 11.',
        publishAt: PAST,
        imageIds: ['img-1'],
        revision: 2,
      }),
    ).toEqual({
      title: 'Lobby cleaning',
      body: 'Closed 9 to 11.',
      publishAt: PAST.toISOString(),
      imageIds: ['img-1'],
      revision: 2,
    });
  });
});
