export function canManageRent(isAdmin: boolean, isOwner: boolean, managementMode: string): boolean {
  return managementMode === 'PROJECT_MANAGED' ? isAdmin : !isAdmin && isOwner;
}

interface RentRule {
  roomId: string | null;
  kind: string;
  frequency: string;
  effectiveAt: Date;
  enabled: boolean;
}
export function selectRentRule<T extends RentRule>(
  rules: T[],
  roomId: string,
  kind: string,
  at: Date,
): T | null {
  return (
    [...rules]
      .filter(
        (rule) =>
          rule.enabled &&
          rule.kind === kind &&
          rule.frequency === 'MONTHLY' &&
          rule.effectiveAt <= at &&
          (rule.roomId === roomId || rule.roomId === null),
      )
      .sort(
        (left, right) =>
          Number(right.roomId === roomId) - Number(left.roomId === roomId) ||
          right.effectiveAt.getTime() - left.effectiveAt.getTime(),
      )[0] ?? null
  );
}
