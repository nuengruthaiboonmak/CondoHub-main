import { AppError } from '@/shared/utils/errors';

export type ChatAction = 'VIEW_CHAT' | 'SEND_CHAT' | 'JOIN_SOCKET' | 'VIEW_IMAGE';

export interface ChatActorGrants {
  actorIsSystemAdmin: boolean;
  actorHasCurrentRoomAccess: boolean;
}

export type ChatAccessVerdict = { allowed: true } | { allowed: false; httpStatus: 403 | 404 };

export function evaluateChatAccess(
  grants: ChatActorGrants,
  action: ChatAction,
): ChatAccessVerdict {
  void action;
  if (grants.actorIsSystemAdmin) return { allowed: true };
  if (grants.actorHasCurrentRoomAccess) return { allowed: true };
  return { allowed: false, httpStatus: 404 };
}

export function decideChatAction(grants: ChatActorGrants, action: ChatAction): void {
  const verdict = evaluateChatAccess(grants, action);
  if (!verdict.allowed) {
    if (verdict.httpStatus === 403) throw new AppError('ACCESS_DENIED');
    throw new AppError('RESOURCE_NOT_FOUND');
  }
}
