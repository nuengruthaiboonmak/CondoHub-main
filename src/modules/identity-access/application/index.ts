import 'server-only';
export { getPeopleProfiles, searchUserAccounts } from './accountQueries';
export { deleteUser } from './deleteUser';

export { resolveOrCreateGrantUser } from './provisioning';
export type { GrantUserInput, GrantUserResult } from './provisioning';
export { provisionUser } from './provisionUser';
export type {
  MembershipAttacher,
  ProvisionRoomUserInput,
  ProvisionRoomUserResult,
  RoomEntitlementResolver,
} from './provisionUser';
export { provisionSystemUser } from './provisionSystemUser';
export type { AdminProvisionInput, AdminProvisionResult } from './provisionSystemUser';
export { provisionSeedUser } from './provisionSeedUser';
export type { SeedUserInput, SeedUserResult } from './provisionSeedUser';
export { resetPassword } from './resetPassword';
export type { ResetPasswordResult } from './resetPassword';
export { setAccountStatus, suspendUser, unsuspendUser } from './setAccountStatus';
export type { SetAccountStatusResult } from './setAccountStatus';
export { changePassword } from './changePassword';
export type { ChangePasswordInput, ChangePasswordResult } from './changePassword';
export {
  getSenderProfile,
  isSystemAdmin,
  requireActiveAccount,
  revokeAllSessions,
} from './accountQueries';
export type { ActiveActor, SenderProfile } from './accountQueries';
export { createIdentityCtx } from './ctx';
export type { IdentityCtx } from './ctx';
