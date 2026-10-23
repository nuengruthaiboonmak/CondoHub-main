import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import type { Tx } from '@/shared/db/transaction';
import type {
  ProvisionTargetRole,
  RoomEntitlement,
} from '@/modules/identity-access/domain/provisioningPolicy';

export interface RoomProvisioningPorts {
  resolveEntitlement(actor: Actor, roomId: string): Promise<RoomEntitlement | null>;
  attachMembership(
    tx: Tx,
    input: { roomId: string; userId: string; targetRole: ProvisionTargetRole },
  ): Promise<{ membershipId: string }>;
}

let ports: RoomProvisioningPorts | null = null;

export function setRoomProvisioningPorts(next: RoomProvisioningPorts): void {
  ports = next;
}

export function getRoomProvisioningPorts(): RoomProvisioningPorts {
  if (ports === null) throw new Error('Room provisioning ports are not wired.');
  return ports;
}
