import { AppError } from '@/shared/utils/errors';
import { isUuid } from '@/shared/utils/uuid';

export function readChargeEventRoomScope(context: unknown): string[] | null {
  if (!context || typeof context !== 'object' || Array.isArray(context) || !('roomIds' in context))
    return null;
  const ids = (context as Record<string, unknown>).roomIds;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 10000 ||
    ids.some((id) => typeof id !== 'string' || !isUuid(id))
  )
    throw new AppError(
      'VALIDATION_ERROR',
      'The saved event audience is invalid. Review this event before issuing invoices.',
    );
  return [...new Set(ids as string[])];
}

export function getChargeEventNote(context: unknown): string | null {
  if (context === null || typeof context !== 'object' || Array.isArray(context)) return null;
  const note = (context as Record<string, unknown>).note;
  return typeof note === 'string' && note.trim() !== '' ? note.trim() : null;
}
