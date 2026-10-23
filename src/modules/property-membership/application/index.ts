import 'server-only';
export { deletePropertyResource } from './resourceLifecycle';

export { createPropertyCtx } from './ctx';
export type { PropertyCtx } from './ctx';
export {
  canActInRoom,
  getActiveResidentRooms,
  getCurrentOwners,
  getEligibleMaintenanceRooms,
  getMembershipIntervals,
  getOwnersAt,
  getRentalPeriods,
  getResidentIntervals,
  getRoomDetail,
  isOwnerAt,
  listMembershipWindowsByUser,
  membershipOverlapsServiceWindow,
  getRoomLabels,
  getTenancyLabels,
  resolveActorRooms,
  listActorRoomPage,
  roomResidencyScope,
  tenantOverlapScope,
} from './queries';
export { formatTenancyPeriod } from '../domain/tenancyLabel';
export type {
  MaintenanceRouting,
  MembershipInterval,
  MembershipWindowRef,
  OwnerRef,
  PmAction,
  RentalPeriodDto,
  ResidentInterval,
  RoomActVerdict,
  RoomDetail,
} from './queries';
export {
  createBuilding,
  updateBuildingDetails,
  createFloor,
  createRoom,
  deleteFloor,
  disableBuilding,
  disableRoom,
  enableBuilding,
  listAllBuildings,
  listBuildingPage,
  listBuildingStructures,
  previewRoomImpact,
  updateFloor,
  updateRoomDetails,
} from './structures';
export type { RoomImpactPreview } from './structures';
export { grantCoOwner, resolveGrantTargetByUsername } from './grantCoOwner';
export type { GrantCoOwnerInput, GrantCoOwnerResult } from './grantCoOwner';
export { seedOwnership } from './seedOwnership';
export {
  assignOwner,
  correctOwnershipInterval,
  removeOwnership,
  transferOwnership,
} from './ownershipAdmin';
export type {
  AssignOwnerInput,
  AssignOwnerResult,
  TransferOwnershipInput,
  TransferOwnershipResult,
} from './ownershipAdmin';
export {
  createTenancy,
  cancelScheduledTenancy,
  lockTenancyForBilling,
  endTenancyAt,
  listRoomActiveTenancies,
  listRoomTenancies,
} from './tenancies';
export type { CreateTenancyInput } from './tenancies';
export {
  addMembership,
  attachProvisionedMembership,
  endMembershipAt,
  listRoomMemberships,
  listCurrentRoomMemberships,
} from './memberships';
export type { AddMembershipInput } from './memberships';
export {
  attachRoomMembership,
  resolveRoomEntitlement,
  wireRoomProvisioningPorts,
} from './provisioningPorts';
export { parseWithFieldErrors } from './routeSchemas';
export type {
  BuildingBody,
  BuildingPatchBody,
  CoOwnerGrantBody,
  FloorBody,
  FloorPatchBody,
  MemberAddBody,
  MemberPatchBody,
  OwnerAssignBody,
  OwnershipAdminBody,
  RoomBody,
  RoomListQuery,
  RoomPatchBody,
  TenancyBody,
  TenancyPatchBody,
} from './routeSchemas';
