export function canManagePaymentSettings(
  isAdmin: boolean,
  isCurrentOwner: boolean,
  payeeType: 'PROJECT' | 'OWNER',
): boolean {
  return payeeType === 'PROJECT' ? isAdmin : !isAdmin && isCurrentOwner;
}
