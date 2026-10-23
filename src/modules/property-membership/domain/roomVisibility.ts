export function canViewRoom(isResident: boolean, isCurrentOwner: boolean): boolean {
  return isResident || isCurrentOwner;
}
