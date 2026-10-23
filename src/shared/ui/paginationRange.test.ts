import { describe, expect, it } from 'vitest';
import { paginationRange } from './paginationRange';

describe('bounded page navigation', () => {
  it('keeps the first, last, and nearby pages reachable in a large collection', () => {
    expect(paginationRange(100, 50)).toEqual([1, 'ellipsis', 49, 50, 51, 'ellipsis', 100]);
  });

  it('shows the next pages near the start', () => {
    expect(paginationRange(100, 1)).toEqual([1, 2, 3, 'ellipsis', 100]);
  });

  it('shows preceding pages near the end', () => {
    expect(paginationRange(100, 100)).toEqual([1, 'ellipsis', 98, 99, 100]);
  });

  it('shows every page for short collections', () => {
    expect(paginationRange(5, 3)).toEqual([1, 2, 3, 4, 5]);
  });
});
