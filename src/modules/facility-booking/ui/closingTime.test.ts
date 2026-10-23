import { describe, expect, it } from 'vitest';
import { closingInputValue, closingScheduleValue } from './closingTime';

describe('closing time at the end of a booking day', () => {
  it('displays end-of-day midnight in a native time input', () => {
    expect(closingInputValue('24:00')).toBe('00:00');
  });
  it('preserves the whole booking day when the input says midnight', () => {
    expect(closingScheduleValue('00:00')).toBe('24:00');
  });
  it('keeps ordinary closing hours unchanged in either direction', () => {
    expect(closingInputValue('20:30')).toBe('20:30');
    expect(closingScheduleValue('20:30')).toBe('20:30');
  });
  it('round-trips an existing all-day schedule without shifting its boundary', () => {
    expect(closingScheduleValue(closingInputValue('24:00'))).toBe('24:00');
  });
});
