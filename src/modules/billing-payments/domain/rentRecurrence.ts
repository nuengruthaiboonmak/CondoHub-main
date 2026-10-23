export interface TenancyOverlapInput {
  id: string;
  startsAt: Date;
  endsAt: Date | null;
  managementMode: 'PROJECT_MANAGED' | 'PRIVATE_OWNER_MANAGED';
}

export function tenancyOverlapsCycle(
  tenancy: Pick<TenancyOverlapInput, 'startsAt' | 'endsAt'>,
  cycleStart: Date,
  cycleEndExclusive: Date,
): boolean {
  if (tenancy.startsAt.getTime() >= cycleEndExclusive.getTime()) return false;
  if (tenancy.endsAt !== null && tenancy.endsAt.getTime() <= cycleStart.getTime()) return false;
  return true;
}

export function selectOverlappingTenancies(
  tenancies: TenancyOverlapInput[],
  cycleStart: Date,
  cycleEndExclusive: Date,
): TenancyOverlapInput[] {
  return tenancies.filter((tenancy) => tenancyOverlapsCycle(tenancy, cycleStart, cycleEndExclusive));
}

export type RentCycleDecision =
  | { outcome: 'VACANT' }
  | { outcome: 'ISSUE'; tenancy: TenancyOverlapInput }
  | { outcome: 'TURNOVER_REVIEW'; tenancies: TenancyOverlapInput[] };

export function decideRentCycle(
  tenancies: TenancyOverlapInput[],
  cycleStart: Date,
  cycleEndExclusive: Date,
): RentCycleDecision {
  const overlapping = selectOverlappingTenancies(tenancies, cycleStart, cycleEndExclusive);
  if (overlapping.length === 0) return { outcome: 'VACANT' };
  if (overlapping.length === 1) {
    const only = overlapping[0] as TenancyOverlapInput;
    return { outcome: 'ISSUE', tenancy: only };
  }
  return { outcome: 'TURNOVER_REVIEW', tenancies: overlapping };
}

export function rentKindFor(
  managementMode: TenancyOverlapInput['managementMode'],
): 'PRIVATE_RENT' | 'PROJECT_MANAGED_RENT' {
  return managementMode === 'PRIVATE_OWNER_MANAGED' ? 'PRIVATE_RENT' : 'PROJECT_MANAGED_RENT';
}

export function managementModeAt(
  tenancies: TenancyOverlapInput[],
  at: Date,
): TenancyOverlapInput['managementMode'] | null {
  const covering = tenancies.find(
    (tenancy) =>
      tenancy.startsAt.getTime() <= at.getTime() &&
      (tenancy.endsAt === null || at.getTime() < tenancy.endsAt.getTime()),
  );
  return covering === undefined ? null : covering.managementMode;
}
