import 'server-only';
import { and, eq, gt, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '@/shared/db/transaction';
import { roomMembership } from './schema';

export function tenantOverlapScope(input: {
  userId: string;
  tenancyRef: SQL;
  serviceStartRef: SQL;
  serviceEndExclusiveRef: SQL;
}): SQL<boolean> {
  return sql<boolean>`exists (select 1 from "room_membership" as "rm" where "rm"."user_id" = ${input.userId} and "rm"."tenancy_id" = ${input.tenancyRef} and "rm"."tenancy_id" is not null and "rm"."start_at" < ${input.serviceEndExclusiveRef} and ("rm"."end_at" is null or "rm"."end_at" > ${input.serviceStartRef}))`;
}

export function roomResidencyScope(input: {
  userId: string;
  roomRef: SQL;
  at: Date;
}): SQL<boolean> {
  return sql<boolean>`exists (select 1 from "room_membership" as "rm" where "rm"."user_id" = ${input.userId} and "rm"."room_id" = ${input.roomRef} and ("rm"."tenancy_id" is null or exists (select 1 from "rental_period" as "rp" where "rp"."id" = "rm"."tenancy_id" and "rp"."state" <> 'CANCELLED')) and "rm"."start_at" <= ${input.at} and ("rm"."end_at" is null or "rm"."end_at" > ${input.at}))`;
}

export async function membershipOverlapsServiceWindow(
  conn: Db,
  input: { userId: string; tenancyId: string; serviceStart: Date; serviceEndExclusive: Date },
): Promise<boolean> {
  const rows = await conn
    .select({ id: roomMembership.id })
    .from(roomMembership)
    .where(
      and(
        eq(roomMembership.userId, input.userId),
        eq(roomMembership.tenancyId, input.tenancyId),
        lt(roomMembership.startAt, input.serviceEndExclusive),
        or(isNull(roomMembership.endAt), gt(roomMembership.endAt, input.serviceStart)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
