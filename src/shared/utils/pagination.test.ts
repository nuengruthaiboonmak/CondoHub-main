import { describe, expect, it } from 'vitest';
import {
  CHAT_DEFAULT_LIMIT,
  CHAT_MAX_LIMIT,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  parseChatLimit,
  parsePageParams,
} from './pagination';
import { AppError } from './errors';

const MESSAGE_ID = '01934f3a-1b2c-7d4e-8f90-abcdef123456';

describe('UT-SH-03 pagination and cursor', () => {
  it('applies PD-13 defaults and caps', () => {
    expect(parsePageParams({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
    expect(parsePageParams({ page: '2', pageSize: '10' })).toEqual({ page: 2, pageSize: 10 });
    expect(parsePageParams({ pageSize: '500' }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(parseChatLimit(undefined)).toBe(CHAT_DEFAULT_LIMIT);
    expect(parseChatLimit('10')).toBe(10);
    expect(parseChatLimit('500')).toBe(CHAT_MAX_LIMIT);
  });

  it('rejects non-positive pagination inputs', () => {
    expect(() => parsePageParams({ page: '0' })).toThrowError(AppError);
    expect(() => parsePageParams({ pageSize: '-1' })).toThrowError(AppError);
    expect(() => parsePageParams({ page: 'abc' })).toThrowError(AppError);
    expect(() => parseChatLimit('0')).toThrowError(AppError);
  });

  it('round-trips the frozen chat cursor codec', () => {
    const encoded = encodeCursor({ createdAt: '2026-10-14T07:30:00.000Z', id: MESSAGE_ID });
    expect(encoded).toBe(
      'eyJjcmVhdGVkQXQiOiIyMDI2LTEwLTE0VDA3OjMwOjAwLjAwMFoiLCJpZCI6IjAxOTM0ZjNhLTFiMmMtN2Q0ZS04ZjkwLWFiY2RlZjEyMzQ1NiJ9',
    );
    expect(decodeCursor(encoded)).toEqual({
      createdAt: '2026-10-14T07:30:00.000Z',
      id: MESSAGE_ID,
    });
  });

  it('round-trips Date cursor inputs', () => {
    const encoded = encodeCursor({ createdAt: new Date('2026-10-14T07:30:00.000Z'), id: MESSAGE_ID });
    expect(decodeCursor(encoded)).toEqual({
      createdAt: '2026-10-14T07:30:00.000Z',
      id: MESSAGE_ID,
    });
  });

  it('rejects malformed cursors with 400 semantics', () => {
    for (const bad of [
      '',
      'not-base64!!!',
      Buffer.from('[]', 'utf8').toString('base64url'),
      Buffer.from(JSON.stringify({ createdAt: 'nope', id: MESSAGE_ID }), 'utf8').toString('base64url'),
      Buffer.from(JSON.stringify({ createdAt: '2026-10-14T07:30:00.000Z', id: 'nope' }), 'utf8').toString('base64url'),
      Buffer.from(JSON.stringify({ createdAt: '2026-10-14T07:30:00.000Z' }), 'utf8').toString('base64url'),
    ]) {
      try {
        decodeCursor(bad);
        expect.unreachable(`cursor should reject: ${bad}`);
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe('VALIDATION_ERROR');
      }
    }
    expect(() => encodeCursor({ createdAt: 'nope', id: MESSAGE_ID })).toThrowError(AppError);
    expect(() =>
      encodeCursor({ createdAt: '2026-10-14T07:30:00.000Z', id: 'nope' }),
    ).toThrowError(AppError);
  });
});
