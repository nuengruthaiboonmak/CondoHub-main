export function kindLabel(kind: string): string {
  if (kind === 'PRIVATE_RENT') return 'Private rent';
  if (kind === 'PROJECT_MANAGED_RENT') return 'Project rent';
  return 'Common fee';
}

export function invoiceStateLabel(state: string): string {
  if (state === 'PAID') return 'Paid';
  if (state === 'PARTIALLY_PAID') return 'Partially paid';
  return 'Unpaid';
}

export function invoiceStateVariant(state: string): 'success' | 'info' | 'warning' {
  if (state === 'PAID') return 'success';
  if (state === 'PARTIALLY_PAID') return 'info';
  return 'warning';
}

export function turnoverStateLabel(state: string): string {
  if (state === 'RESOLVED') return 'Resolved';
  if (state === 'NO_CHARGE') return 'No charge';
  return 'Unresolved';
}

export function turnoverStateVariant(state: string): 'warning' | 'success' | 'neutral' {
  if (state === 'RESOLVED') return 'success';
  if (state === 'NO_CHARGE') return 'neutral';
  return 'warning';
}

export function submissionStateLabel(state: string): string {
  if (state === 'APPROVED') return 'Approved';
  if (state === 'REJECTED') return 'Rejected';
  return 'Pending';
}

export function submissionStateVariant(state: string): 'success' | 'danger' | 'warning' {
  if (state === 'APPROVED') return 'success';
  if (state === 'REJECTED') return 'danger';
  return 'warning';
}

export function jobRunStateVariant(state: string): 'success' | 'danger' | 'pending' {
  if (state === 'DONE') return 'success';
  if (state === 'ERROR') return 'danger';
  return 'pending';
}

export function chargeEventStatusVariant(status: string): 'success' | 'warning' | 'neutral' {
  if (status === 'ISSUED') return 'success';
  if (status === 'CANCELLED') return 'warning';
  return 'neutral';
}

export function formatInstant(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return date.toLocaleString('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
