import { describe, expect, it } from 'vitest';
import {
  announcementFormSchema,
  publishingTimestamp,
  publishModeFor,
} from './announcementFormSchema';

describe('announcement publishing', () => {
  const values = { title: 'Community update', body: 'An update for residents.' };
  it.each(['', 'invalid', '2000-01-01T12:00'])(
    'rejects an empty, invalid or past schedule: %s',
    (publishAt) => {
      const parsed = announcementFormSchema.safeParse({
        ...values,
        publishMode: 'scheduled',
        publishAt,
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) expect(parsed.error.issues[0]?.path).toEqual(['publishAt']);
    },
  );
  it('accepts a future schedule without changing it into a draft', () => {
    expect(
      announcementFormSchema.safeParse({
        ...values,
        publishMode: 'scheduled',
        publishAt: '2099-01-01T12:00',
      }).success,
    ).toBe(true);
  });
  it('does not require a schedule for a draft or immediate publication', () => {
    for (const publishMode of ['draft', 'now'])
      expect(
        announcementFormSchema.safeParse({ ...values, publishMode, publishAt: '' }).success,
      ).toBe(true);
  });
  it('preserves the exact publication time when editing an already published announcement', () => {
    const original = '2026-10-01T03:04:05.678Z';
    expect(publishingTimestamp('now', '', original, new Date('2026-10-20T12:00:00Z'))).toBe(
      original,
    );
  });
  it('publishes a scheduled announcement immediately when requested', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(publishingTimestamp('now', '', '2026-11-01T00:00:00Z', now)).toBe(now.toISOString());
  });
  it('stores no publication date when returned to draft', () => {
    expect(publishingTimestamp('draft', '', '2026-10-01T03:04:05.678Z')).toBeNull();
  });
  it('initializes each publishing control from the saved state', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(publishModeFor(null, now)).toBe('draft');
    expect(publishModeFor('2026-10-01T00:00:00Z', now)).toBe('now');
    expect(publishModeFor('2026-11-01T00:00:00Z', now)).toBe('scheduled');
  });
});
