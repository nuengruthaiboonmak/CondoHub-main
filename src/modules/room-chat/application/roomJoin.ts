import 'server-only';
import { systemClock } from '@/shared/utils/clock';
import { isSystemAdmin, requireActiveAccount } from '@/modules/identity-access/application/index';
import { canActInRoom } from '@/modules/property-membership/application/index';

export async function authorizeRoomJoin(userId: string, roomId: string): Promise<boolean> {
  try {
    await requireActiveAccount(userId);
  } catch {
    return false;
  }
  try {
    const admin = await isSystemAdmin(userId);
    if (admin) return true;
  } catch {
    return false;
  }
  try {
    const verdict = await canActInRoom(userId, roomId, 'VIEW_CHAT', systemClock.now());
    return verdict.allowed;
  } catch {
    return false;
  }
}
