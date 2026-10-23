import 'server-only';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Db, Tx } from '@/shared/db/transaction';
import {
  maintenanceRecipient,
  maintenanceRequest,
  type MaintenanceRoutingKind,
  type MaintenanceStatus,
} from './schema';

export async function listOpenPrivateManagerGroups(conn: Db, userId: string): Promise<string[][]> {
  const result = await conn.execute<{ userIds: string[] }>(sql`
    select array_agg(distinct r.recipient_user_id) as "userIds"
    from maintenance_recipient r
    join maintenance_request t on t.id = r.request_id
    where t.routing_kind = 'PRIVATE_OWNER' and t.status in ('PENDING', 'IN_PROGRESS', 'WAITING_FOR_INFO')
      and exists (select 1 from maintenance_recipient target where target.request_id = t.id and target.recipient_user_id = ${userId})
    group by t.id
  `);
  return result.rows.map((row) => row.userIds);
}

export interface TicketRecord {
  id: string;
  reporterId: string;
  roomId: string | null;
  locationDescription: string;
  routingKind: MaintenanceRoutingKind;
  status: MaintenanceStatus;
  subject: string;
  description: string;
  version: number;
  snapshotBoundaryAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function toRecord(row: typeof maintenanceRequest.$inferSelect): TicketRecord {
  return {
    id: row.id,
    reporterId: row.reporterId,
    roomId: row.roomId,
    locationDescription: row.locationDescription,
    routingKind: row.routingKind,
    status: row.status,
    subject: row.subject,
    description: row.description,
    version: row.version,
    snapshotBoundaryAt: row.snapshotBoundaryAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function findTicketById(conn: Db, id: string): Promise<TicketRecord | null> {
  const rows = await conn
    .select()
    .from(maintenanceRequest)
    .where(eq(maintenanceRequest.id, id))
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function lockTicketForUpdate(tx: Tx, id: string): Promise<TicketRecord | null> {
  const rows = await tx
    .select()
    .from(maintenanceRequest)
    .where(eq(maintenanceRequest.id, id))
    .for('update')
    .limit(1);
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function insertTicket(
  tx: Tx,
  input: {
    reporterId: string;
    roomId: string | null;
    locationDescription: string;
    routingKind: MaintenanceRoutingKind;
    subject: string;
    description: string;
    snapshotBoundaryAt: Date;
  },
): Promise<TicketRecord> {
  const rows = await tx
    .insert(maintenanceRequest)
    .values({
      reporterId: input.reporterId,
      roomId: input.roomId,
      locationDescription: input.locationDescription,
      routingKind: input.routingKind,
      status: 'PENDING',
      subject: input.subject,
      description: input.description,
      version: 1,
      snapshotBoundaryAt: input.snapshotBoundaryAt,
    })
    .returning();
  const row = rows[0];
  if (row === undefined) throw new Error('The ticket insert returned no row.');
  return toRecord(row);
}

export async function updateTicketStatus(
  tx: Tx,
  input: { id: string; fromVersion: number; toStatus: MaintenanceStatus; at: Date },
): Promise<TicketRecord | null> {
  const rows = await tx
    .update(maintenanceRequest)
    .set({ status: input.toStatus, version: input.fromVersion + 1, updatedAt: input.at })
    .where(
      and(eq(maintenanceRequest.id, input.id), eq(maintenanceRequest.version, input.fromVersion)),
    )
    .returning();
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}

export async function isTicketRecipient(
  conn: Db,
  input: { ticketId: string; userId: string },
): Promise<boolean> {
  const rows = await conn
    .select({ id: maintenanceRecipient.id })
    .from(maintenanceRecipient)
    .where(
      and(
        eq(maintenanceRecipient.requestId, input.ticketId),
        eq(maintenanceRecipient.recipientUserId, input.userId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function insertTicketRecipients(
  tx: Tx,
  input: {
    ticketId: string;
    recipients: Array<{ userId: string; ownershipIntervalRef: string | null }>;
    assignedAt: Date;
    assignedBy: string;
  },
): Promise<void> {
  if (input.recipients.length === 0) return;
  await tx.insert(maintenanceRecipient).values(
    input.recipients.map((recipient) => ({
      requestId: input.ticketId,
      recipientUserId: recipient.userId,
      ownershipIntervalRef: recipient.ownershipIntervalRef,
      assignedAt: input.assignedAt,
      assignedBy: input.assignedBy,
    })),
  );
}

export async function isTicketMemberVisible(
  conn: Db,
  input: { ticketId: string; userId: string },
): Promise<boolean> {
  const rows = await conn
    .select({ id: maintenanceRequest.id })
    .from(maintenanceRequest)
    .leftJoin(
      maintenanceRecipient,
      and(
        eq(maintenanceRecipient.requestId, maintenanceRequest.id),
        eq(maintenanceRecipient.recipientUserId, input.userId),
      ),
    )
    .where(
      and(
        eq(maintenanceRequest.id, input.ticketId),
        or(
          eq(maintenanceRequest.reporterId, input.userId),
          sql`${maintenanceRecipient.id} IS NOT NULL`,
        ),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface TicketListPage {
  rows: TicketRecord[];
  total: number;
}

export interface TicketListFilter {
  view?: 'open' | 'history' | undefined;
  roomId?: string | undefined;
  routingKind?: MaintenanceRoutingKind | undefined;
  status?: MaintenanceStatus | undefined;
  limit: number;
  offset: number;
}

function buildListConditions(input: TicketListFilter) {
  const conditions = [];
  if (input.view === 'open')
    conditions.push(
      inArray(maintenanceRequest.status, ['PENDING', 'IN_PROGRESS', 'WAITING_FOR_INFO']),
    );
  if (input.view === 'history')
    conditions.push(inArray(maintenanceRequest.status, ['COMPLETED', 'REJECTED', 'CANCELLED']));
  if (input.roomId !== undefined) conditions.push(eq(maintenanceRequest.roomId, input.roomId));
  if (input.routingKind !== undefined) {
    conditions.push(eq(maintenanceRequest.routingKind, input.routingKind));
  }
  if (input.status !== undefined) conditions.push(eq(maintenanceRequest.status, input.status));
  return conditions;
}

export async function listTicketsForAdmin(
  conn: Db,
  input: TicketListFilter,
): Promise<TicketListPage> {
  const where = and(
    inArray(maintenanceRequest.routingKind, ['COMMON_AREA', 'PROJECT_MANAGED_PRIVATE']),
    ...buildListConditions(input),
  );
  const rows = await conn
    .select()
    .from(maintenanceRequest)
    .where(where)
    .orderBy(desc(maintenanceRequest.createdAt), desc(maintenanceRequest.id))
    .limit(input.limit)
    .offset(input.offset);
  const counted = await conn
    .select({ count: sql<number>`count(*)` })
    .from(maintenanceRequest)
    .where(where);
  return { rows: rows.map(toRecord), total: Number(counted[0]?.count ?? 0) };
}

export async function listTicketsForMember(
  conn: Db,
  input: TicketListFilter & { userId: string },
): Promise<TicketListPage> {
  const where = and(
    or(
      eq(maintenanceRequest.reporterId, input.userId),
      sql`EXISTS (SELECT 1 FROM "maintenance_recipient" WHERE "maintenance_recipient"."request_id" = "maintenance_request"."id" AND "maintenance_recipient"."recipient_user_id" = ${input.userId})`,
    ),
    ...buildListConditions(input),
  );
  const rows = await conn
    .select()
    .from(maintenanceRequest)
    .where(where)
    .orderBy(desc(maintenanceRequest.createdAt), desc(maintenanceRequest.id))
    .limit(input.limit)
    .offset(input.offset);
  const counted = await conn
    .select({ count: sql<number>`count(*)` })
    .from(maintenanceRequest)
    .where(where);
  return { rows: rows.map(toRecord), total: Number(counted[0]?.count ?? 0) };
}
