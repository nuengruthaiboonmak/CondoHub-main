import 'server-only';
import type { Db } from '@/shared/db/transaction';
import { AppError } from '@/shared/utils/errors';
import { listPrivateRentalManagerGroups } from '@/modules/property-membership/application/accountResponsibilities';
import { listPrivateBillingManagerGroups } from '@/modules/billing-payments/application/accountResponsibilities';
import { listOpenPrivateManagerGroups } from '@/modules/maintenance/application/accountResponsibilities';
import { listRetainedPrivateManagerIds } from '../infrastructure/userRepository';
import { hasSolePrivateResponsibility } from '../domain/accountDeletionPolicy';

export async function assertAccountResponsibilitiesClosed(
  conn: Db,
  userId: string,
  at: Date,
): Promise<void> {
  const groups = [
    ...(await listPrivateRentalManagerGroups(conn, userId, at)),
    ...(await listPrivateBillingManagerGroups(conn, userId)),
    ...(await listOpenPrivateManagerGroups(conn, userId)),
  ];
  const retained = await listRetainedPrivateManagerIds(conn, [...new Set(groups.flat())]);
  if (hasSolePrivateResponsibility(userId, groups, retained))
    throw new AppError(
      'VALIDATION_ERROR',
      'This account still has work to close. Deactivate it while the account holder resolves their responsibilities, then try deleting again.',
    );
}
