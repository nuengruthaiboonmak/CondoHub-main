import 'server-only';
import { emitChatAccessRevoked } from '../infrastructure/chatFanOut';

export function emitRoomAccessRevoked(roomId: string): void {
  emitChatAccessRevoked(roomId);
}
