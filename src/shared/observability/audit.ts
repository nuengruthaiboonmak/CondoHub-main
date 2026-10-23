import type { Tx } from '../db/transaction';
import { auditLog } from '../db/schema/audit';

export type AuditJson = Record<string, unknown> | unknown[] | string | number | boolean | null;

export interface AuditEntry {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string;
  before?: AuditJson;
  after?: AuditJson;
  at?: Date;
}

export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLog).values({
    actorId: entry.actorId,
    action: entry.action,
    resourceType: entry.resourceType,
    resourceId: entry.resourceId,
    requestId: entry.requestId,
    beforeJson: (entry.before ?? null) as unknown as Record<string, unknown> | null,
    afterJson: (entry.after ?? null) as unknown as Record<string, unknown> | null,
    at: entry.at ?? new Date(),
  });
}
