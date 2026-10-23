import type { Actor } from '@/shared/auth/actor';
import type { ImageScope } from '@/shared/storage/objectKeys';

export type ScopeDenyReason =
  | 'SCOPE_ACL_NOT_IMPLEMENTED'
  | 'ACCOUNT_SUSPENDED'
  | 'FIRST_LOGIN_REQUIRED'
  | 'NOT_PUBLISHED'
  | 'ANNOUNCEMENT_HIDDEN'
  | 'ADMIN_ONLY'
  | 'NO_CURRENT_ACCESS';

export type ScopeEntityRef = { type: string; id: string } | null;

export interface ScopeAclImage {
  imageId?: string;
  scope: ImageScope;
  entityRef: ScopeEntityRef;
}

export interface ScopeAclVerdict {
  allowed: boolean;
  reason?: ScopeDenyReason | undefined;
}

export type ScopeAclCallback = (
  actor: Actor,
  image: ScopeAclImage,
  at: Date,
) => Promise<ScopeAclVerdict>;
