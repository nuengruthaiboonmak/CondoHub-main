import { describe, it, expect } from 'vitest';
import { invoiceSourceMatches } from './invoiceNaturalKey';
const original = { tenancyId: 'lease-a', sourceRuleId: 'rate-old', oneTimeChargeEventId: null };
describe('invoice source identity', () => {
  it('keeps rent identity stable when its rate rule changes', () => {
    expect(
      invoiceSourceMatches('PRIVATE_RENT', original, { ...original, sourceRuleId: 'rate-new' }),
    ).toBe(true);
    expect(
      invoiceSourceMatches('PROJECT_MANAGED_RENT', original, {
        ...original,
        sourceRuleId: 'rate-new',
      }),
    ).toBe(true);
    expect(
      invoiceSourceMatches('PRIVATE_RENT', original, { ...original, tenancyId: 'lease-b' }),
    ).toBe(false);
  });
  it('keeps recurring common fees separate by rule', () => {
    const fee = { ...original, tenancyId: null };
    expect(invoiceSourceMatches('COMMON_FEE', fee, fee)).toBe(true);
    expect(invoiceSourceMatches('COMMON_FEE', fee, { ...fee, sourceRuleId: 'rate-new' })).toBe(
      false,
    );
  });
  it('identifies one-time fees by the charge event independently of its rule', () => {
    const event = { tenancyId: null, sourceRuleId: 'old', oneTimeChargeEventId: 'event-a' };
    expect(invoiceSourceMatches('COMMON_FEE', event, { ...event, sourceRuleId: 'new' })).toBe(true);
    expect(
      invoiceSourceMatches('COMMON_FEE', event, { ...event, oneTimeChargeEventId: 'event-b' }),
    ).toBe(false);
  });
});
