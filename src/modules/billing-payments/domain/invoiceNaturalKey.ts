interface InvoiceSource {
  tenancyId?: string | null | undefined;
  sourceRuleId?: string | null | undefined;
  oneTimeChargeEventId?: string | null | undefined;
}
export function invoiceSourceMatches(
  kind: string,
  stored: InvoiceSource,
  requested: InvoiceSource,
): boolean {
  if (kind === 'PRIVATE_RENT' || kind === 'PROJECT_MANAGED_RENT')
    return stored.tenancyId === requested.tenancyId;
  if (requested.oneTimeChargeEventId)
    return stored.oneTimeChargeEventId === requested.oneTimeChargeEventId;
  return (
    !stored.oneTimeChargeEventId &&
    (stored.sourceRuleId ?? null) === (requested.sourceRuleId ?? null)
  );
}
