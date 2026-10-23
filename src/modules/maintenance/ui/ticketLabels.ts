export function routingKindLabel(kind: string): string {
  if (kind === 'PRIVATE_OWNER') return 'Owner room';
  if (kind === 'PROJECT_MANAGED_PRIVATE') return 'Managed room';
  return 'Common area';
}

export function statusLabel(status: string): string {
  if (status === 'IN_PROGRESS') return 'In progress';
  if (status === 'WAITING_FOR_INFO') return 'Waiting for info';
  if (status === 'COMPLETED') return 'Completed';
  if (status === 'REJECTED') return 'Rejected';
  if (status === 'CANCELLED') return 'Cancelled';
  return 'Pending';
}

export function statusVariant(status: string): 'success' | 'danger' | 'info' | 'warning' | 'neutral' | 'pending' {
  if (status === 'COMPLETED') return 'success';
  if (status === 'REJECTED' || status === 'CANCELLED') return 'neutral';
  if (status === 'IN_PROGRESS') return 'info';
  if (status === 'WAITING_FOR_INFO') return 'warning';
  return 'pending';
}

export function isTerminalTicketStatus(status: string): boolean {
  return status === 'COMPLETED' || status === 'REJECTED' || status === 'CANCELLED';
}

export function formatInstant(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
