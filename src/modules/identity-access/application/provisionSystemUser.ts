import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import { AppError } from '@/shared/utils/errors';
import { writeAudit } from '@/shared/observability/audit';
import { canProvisionSystemWide } from '../domain/provisioningPolicy';
import { resolveOrCreateGrantUser } from './provisioning';
import type { IdentityCtx } from './ctx';

export interface AdminProvisionInput {
  username: string;
  email: string;
  name: string;
  phone?: string | undefined;
  isSystemAdmin?: boolean | undefined;
}

export type AdminProvisionResult =
  | { created: true; userId: string; tempPassword: string }
  | { created: false; userId: string };

export async function provisionSystemUser(
  actor: Actor,
  input: AdminProvisionInput,
  ctx: IdentityCtx,
): Promise<AdminProvisionResult> {
  if (!canProvisionSystemWide(actor)) throw new AppError('ACCESS_DENIED');
  return db.transaction(async (tx) => {
    const resolved = await resolveOrCreateGrantUser(
      tx,
      {
        username: input.username,
        email: input.email,
        name: input.name,
        phone: input.phone,
        isSystemAdmin: input.isSystemAdmin ?? false,
      },
      ctx,
    );
    await writeAudit(tx, {
      actorId: actor.userId,
      action: resolved.created ? 'user.provisioned' : 'user.provision.duplicate',
      resourceType: 'user',
      resourceId: resolved.userId,
      requestId: ctx.requestId,
      after: { scope: 'system', isSystemAdmin: input.isSystemAdmin ?? false },
    });
    if (resolved.created) {
      return { created: true, userId: resolved.userId, tempPassword: resolved.tempPassword };
    }
    return { created: false, userId: resolved.userId };
  });
}
