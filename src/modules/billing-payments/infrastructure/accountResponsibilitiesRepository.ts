import 'server-only';
import { sql } from 'drizzle-orm';
import type { Db } from '@/shared/db/transaction';

export async function listPrivateBillingManagerGroups(
  conn: Db,
  userId: string,
): Promise<string[][]> {
  const result = await conn.execute<{ userIds: string[] }>(sql`
    select array_agg(distinct r.user_id) as "userIds"
    from private_rent_invoice_reviewer r
    join invoice i on i.id = r.invoice_id
    where i.kind = 'PRIVATE_RENT'
      and exists (select 1 from private_rent_invoice_reviewer target where target.invoice_id = i.id and target.user_id = ${userId})
      and (
        i.total > coalesce((select sum(p.approved_amount) from payment_submission p where p.invoice_id = i.id and p.state = 'APPROVED'), 0)
        or exists (select 1 from payment_submission p where p.invoice_id = i.id and p.state = 'PENDING')
      )
    group by i.id
    union all
    select array_agg(distinct o.user_id) as "userIds"
    from turnover_review_responsible_owner o
    join turnover_billing_review t on t.id = o.review_id
    where t.state = 'UNRESOLVED' and t.management_mode_at_creation = 'PRIVATE_OWNER_MANAGED'
      and exists (select 1 from turnover_review_responsible_owner target where target.review_id = t.id and target.user_id = ${userId})
    group by t.id
  `);
  return result.rows.map((row) => row.userIds);
}
