import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { env } from '@/config/env';
import { AppError } from '@/shared/utils/errors';

export const JOB_SECRET_HEADER = 'x-job-secret';

export function verifyJobSecret(request: Request): void {
  const presented = request.headers.get(JOB_SECRET_HEADER) ?? '';
  const expected = env.JOB_TRIGGER_SECRET;
  const presentedBuffer = Buffer.from(presented);
  const expectedBuffer = Buffer.from(expected);
  const matches =
    presentedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(presentedBuffer, expectedBuffer);
  if (!matches) throw new AppError('AUTH_REQUIRED', 'Invalid job credentials.');
}
