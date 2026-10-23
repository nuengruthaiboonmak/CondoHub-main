import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import type { ImageScope } from '@/shared/storage/objectKeys';
import type {
  ScopeAclCallback,
  ScopeAclImage,
  ScopeAclVerdict,
} from '../domain/scopeAcl';

const registry = new Map<ImageScope, ScopeAclCallback>();

let defaultsWired = false;

async function denyClosed(): Promise<ScopeAclVerdict> {
  return { allowed: false, reason: 'SCOPE_ACL_NOT_IMPLEMENTED' };
}

async function ensureDefaultsWired(): Promise<void> {
  if (defaultsWired) return;
  defaultsWired = true;
  const { wireAnnouncementScopeAcl } = await import(
    '@/modules/announcements/application/scopeCallbacks'
  );
  wireAnnouncementScopeAcl();
  const { wirePaymentScopeAcl } = await import(
    '@/modules/billing-payments/application/paymentScopeCallbacks'
  );
  wirePaymentScopeAcl();
  const { wireMaintenanceScopeAcl } = await import(
    '@/modules/maintenance/application/maintenanceScopeCallbacks'
  );
  wireMaintenanceScopeAcl();
  const { wireChatScopeAcl } = await import('@/modules/room-chat/application/chatScopeCallbacks');
  wireChatScopeAcl();
}

export function registerScopeAcl(scope: ImageScope, callback: ScopeAclCallback): void {
  registry.set(scope, callback);
}

export function resolveScopeAcl(scope: ImageScope): ScopeAclCallback {
  return registry.get(scope) ?? denyClosed;
}

export async function evaluateScopeAcl(
  scope: ImageScope,
  actor: Actor,
  image: ScopeAclImage,
  at: Date,
): Promise<ScopeAclVerdict> {
  await ensureDefaultsWired();
  return resolveScopeAcl(scope)(actor, image, at);
}

export function resetScopeAclRegistry(): void {
  registry.clear();
  defaultsWired = false;
}
