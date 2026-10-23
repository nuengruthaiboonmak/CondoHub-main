import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

import { ticketListQuery } from './routeSchemas';

describe('maintenance list views', () => {
  it('retains the selected history view for filtering before pagination', () => {
    expect(ticketListQuery.parse({ view: 'history', page: '3' })).toMatchObject({
      view: 'history',
      page: 3,
    });
  });

  it('rejects unknown views', () => {
    expect(ticketListQuery.safeParse({ view: 'everything' }).success).toBe(false);
  });
});
