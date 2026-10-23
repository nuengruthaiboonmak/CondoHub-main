'use client';
import { Badge } from '@/shared/ui';

export function AccountAccessBadge({
  status,
}: {
  status?: 'ACTIVE' | 'INACTIVE' | 'DELETED' | undefined;
}) {
  if (!status || status === 'ACTIVE') return null;
  return (
    <Badge variant="neutral" className="ml-2 align-middle">
      {status === 'DELETED' ? 'Account deleted' : 'Account inactive'}
    </Badge>
  );
}
