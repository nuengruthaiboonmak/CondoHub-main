import { PROJECT_TIMEZONE } from '@/config/project';
import { deniedCopy, firstOf, rateLimitedCopy } from '@/shared/ui';

export const CHAT_PROJECT_TIMEZONE = PROJECT_TIMEZONE;

export const CHAT_PAGE_SIZE = 30;

export function chatDayKey(value: string): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHAT_PROJECT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}`;
}

export function formatChatDay(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    timeZone: CHAT_PROJECT_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatChatTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-US', {
    timeZone: CHAT_PROJECT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatChatExact(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    timeZone: CHAT_PROJECT_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function chatSendErrorCopy(code: string | undefined, fallback: string): string {
  if (code === 'FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED') {
    return 'Change your temporary password before sending messages.';
  }
  return firstOf(
    code,
    fallback,
    deniedCopy('This chat is not available. You may no longer have access to this room.'),
    rateLimitedCopy('Too many messages. Wait a moment, then retry.'),
  );
}
