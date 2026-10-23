import 'server-only';
import type { Tx } from '@/shared/db/transaction';
import { AppError } from '@/shared/utils/errors';
import { lockActiveAdministratorIds } from '../infrastructure/userRepository';

export async function lockCurrentLifecycleAdministrator(tx: Tx, actorId: string): Promise<void> {
  const administrators = await lockActiveAdministratorIds(tx);
  if (!administrators.includes(actorId)) throw new AppError('ACCESS_DENIED');
}
