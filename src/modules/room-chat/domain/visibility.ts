export interface ChatResidentIntervalLike {
  start: Date;
  end: Date | null;
}

export function messageVisibleAt(
  intervals: readonly ChatResidentIntervalLike[],
  messageAt: Date,
): boolean {
  return intervals.some(
    (interval) =>
      messageAt.getTime() >= interval.start.getTime() &&
      (interval.end === null || messageAt.getTime() < interval.end.getTime()),
  );
}

export interface VisibleSliceInput {
  intervals: readonly ChatResidentIntervalLike[];
  rangeStart: Date | null;
  rangeEnd: Date | null;
}

export function visibleSlices(input: VisibleSliceInput): ChatResidentIntervalLike[] {
  if (input.rangeStart === null && input.rangeEnd === null) {
    return input.intervals.map((interval) => ({ start: interval.start, end: interval.end }));
  }
  const clipped: ChatResidentIntervalLike[] = [];
  for (const interval of input.intervals) {
    const startMs =
      input.rangeStart === null
        ? interval.start.getTime()
        : Math.max(interval.start.getTime(), input.rangeStart.getTime());
    const intervalEndMs = interval.end === null ? null : interval.end.getTime();
    const rangeEndMs = input.rangeEnd === null ? null : input.rangeEnd.getTime();
    const endMs =
      intervalEndMs === null
        ? rangeEndMs
        : rangeEndMs === null
          ? intervalEndMs
          : Math.min(intervalEndMs, rangeEndMs);
    if (endMs !== null && endMs <= startMs) continue;
    clipped.push({ start: new Date(startMs), end: endMs === null ? null : new Date(endMs) });
  }
  return mergeAdjacent(clipped);
}

function mergeAdjacent(intervals: ChatResidentIntervalLike[]): ChatResidentIntervalLike[] {
  const sorted = [...intervals].sort((left, right) => left.start.getTime() - right.start.getTime());
  const merged: ChatResidentIntervalLike[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last === undefined) {
      merged.push({ start: current.start, end: current.end });
      continue;
    }
    const lastEndMs = last.end === null ? Number.POSITIVE_INFINITY : last.end.getTime();
    if (current.start.getTime() <= lastEndMs) {
      if (last.end === null || current.end === null) {
        last.end = null;
      } else if (current.end.getTime() > lastEndMs) {
        last.end = current.end;
      }
      continue;
    }
    merged.push({ start: current.start, end: current.end });
  }
  return merged;
}
