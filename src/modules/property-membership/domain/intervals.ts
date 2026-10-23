export interface TimeInterval {
  start: Date;
  end: Date | null;
}

export function covers(interval: TimeInterval, at: Date): boolean {
  if (at.getTime() < interval.start.getTime()) return false;
  if (interval.end === null) return true;
  return at.getTime() < interval.end.getTime();
}

export function isValidInterval(start: Date, end: Date | null): boolean {
  if (end === null) return true;
  return end.getTime() > start.getTime();
}

export function overlaps(left: TimeInterval, right: TimeInterval): boolean {
  const leftEnd = left.end === null ? Number.POSITIVE_INFINITY : left.end.getTime();
  const rightEnd = right.end === null ? Number.POSITIVE_INFINITY : right.end.getTime();
  return left.start.getTime() < rightEnd && right.start.getTime() < leftEnd;
}

export function subtractIntervals(base: TimeInterval, cuts: TimeInterval[]): TimeInterval[] {
  const sorted = [...cuts]
    .filter((cut) => overlaps(base, cut))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const result: TimeInterval[] = [];
  let cursor = base.start.getTime();
  const baseEnd = base.end === null ? null : base.end.getTime();
  let swallowed = false;
  for (const cut of sorted) {
    const cutStart = cut.start.getTime();
    if (cutStart > cursor) {
      result.push({ start: new Date(cursor), end: new Date(cutStart) });
    }
    if (cut.end === null) {
      swallowed = true;
      break;
    }
    cursor = Math.max(cursor, cut.end.getTime());
    if (baseEnd !== null && cursor >= baseEnd) break;
  }
  if (!swallowed) {
    if (baseEnd === null) {
      result.push({ start: new Date(cursor), end: null });
    } else if (cursor < baseEnd) {
      result.push({ start: new Date(cursor), end: base.end });
    }
  }
  return mergeTouching(result);
}

function mergeTouching(intervals: TimeInterval[]): TimeInterval[] {
  const valid = intervals.filter((interval) => isValidInterval(interval.start, interval.end));
  const sorted = [...valid].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: TimeInterval[] = [];
  for (const current of sorted) {
    const last = merged[merged.length - 1];
    if (last === undefined) {
      merged.push({ start: current.start, end: current.end });
      continue;
    }
    const lastEnd = last.end === null ? Number.POSITIVE_INFINITY : last.end.getTime();
    if (current.start.getTime() <= lastEnd) {
      const currentEnd = current.end === null ? null : current.end.getTime();
      if (currentEnd === null || last.end === null) {
        last.end = null;
      } else if (currentEnd > lastEnd) {
        last.end = new Date(currentEnd);
      }
      continue;
    }
    merged.push({ start: current.start, end: current.end });
  }
  return merged.filter((interval) => isValidInterval(interval.start, interval.end));
}
