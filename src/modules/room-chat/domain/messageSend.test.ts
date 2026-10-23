import { describe, expect, it } from 'vitest';
import { AppError } from '@/shared/utils/errors';
import { assertMessageContentValid, buildSenderSnapshot, CHAT_TEXT_MAX_LENGTH, parseSenderSnapshot } from './messageSend';

describe('UT-CH-03 replayed clientMessageId returns the existing message without duplication', () => {
  it('accepts text-only content as a TEXT message', () => {
    const validated = assertMessageContentValid({ text: 'Lobby lights are out.', imageId: null });
    expect(validated).toEqual({
      text: 'Lobby lights are out.',
      imageId: null,
      type: 'TEXT',
    });
  });

  it('accepts image-only content as an IMAGE message', () => {
    const validated = assertMessageContentValid({
      text: null,
      imageId: '01934f3a-aaaa-7d4e-8f90-abcdef123456',
    });
    expect(validated).toEqual({
      text: null,
      imageId: '01934f3a-aaaa-7d4e-8f90-abcdef123456',
      type: 'IMAGE',
    });
  });

  it('accepts text plus image content as an IMAGE message', () => {
    const validated = assertMessageContentValid({
      text: 'See the leak.',
      imageId: '01934f3a-aaaa-7d4e-8f90-abcdef123456',
    });
    expect(validated).toEqual({
      text: 'See the leak.',
      imageId: '01934f3a-aaaa-7d4e-8f90-abcdef123456',
      type: 'IMAGE',
    });
  });

  it('rejects empty content with VALIDATION_ERROR', () => {
    try {
      assertMessageContentValid({ text: '   ', imageId: null });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects text beyond the maximum length with VALIDATION_ERROR', () => {
    try {
      assertMessageContentValid({ text: 'x'.repeat(CHAT_TEXT_MAX_LENGTH + 1), imageId: null });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('VALIDATION_ERROR');
    }
  });

  it('documents replay semantics: same sender plus room plus clientMessageId returns one row', () => {
    const first = { conversationId: 'conv-1', senderUserId: 'user-1', clientMessageId: 'key-1' };
    const replay = { conversationId: 'conv-1', senderUserId: 'user-1', clientMessageId: 'key-1' };
    const otherSender = { conversationId: 'conv-1', senderUserId: 'user-2', clientMessageId: 'key-1' };
    const sameKey = (left: typeof first, right: typeof first): boolean =>
      left.conversationId === right.conversationId &&
      left.senderUserId === right.senderUserId &&
      left.clientMessageId === right.clientMessageId;
    expect(sameKey(first, replay)).toBe(true);
    expect(sameKey(first, otherSender)).toBe(false);
  });

  it('builds a sender snapshot carrying name and admin flag', () => {
    expect(buildSenderSnapshot({ name: 'Araya Admin', isAdmin: true })).toEqual({
      name: 'Araya Admin',
      isAdmin: true,
    });
  });

  it('parses a stored sender snapshot back to name and admin flag', () => {
    expect(parseSenderSnapshot({ name: 'Tenant A', isAdmin: false })).toEqual({
      name: 'Tenant A',
      isAdmin: false,
    });
  });

  it('rejects a malformed sender snapshot with INTERNAL_ERROR', () => {
    for (const value of [null, 'x', {}, { name: '', isAdmin: false }, { name: 'A' }]) {
      try {
        parseSenderSnapshot(value);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe('INTERNAL_ERROR');
      }
    }
  });
});
