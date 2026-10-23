export function hasSolePrivateResponsibility(
  userId: string,
  managerGroups: readonly (readonly string[])[],
  retainedManagers: readonly string[],
): boolean {
  const retained = new Set(retainedManagers);
  return managerGroups.some(
    (group) => group.includes(userId) && !group.some((id) => id !== userId && retained.has(id)),
  );
}
