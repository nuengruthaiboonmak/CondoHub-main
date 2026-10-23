export function closingInputValue(value: string): string {
  return value === '24:00' ? '00:00' : value;
}

export function closingScheduleValue(value: string): string {
  return value === '00:00' ? '24:00' : value;
}
