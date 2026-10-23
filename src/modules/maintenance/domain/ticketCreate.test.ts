import { describe, expect, it } from 'vitest';
import { AppError } from '@/shared/utils/errors';
import {
  actorWindowBoundToTenancies,
  assertRecipientsPresent,
  assertRoutingSelectionValid,
  assertSelectedRoomEligible,
} from './ticketCreate';

describe('UT-MT-02 create validation keeps common area roomless and room tickets eligible', () => {
  it('accepts a common area ticket without a room and rejects any room payload', () => {
    expect(() =>
      assertRoutingSelectionValid({ routingKind: 'COMMON_AREA', roomId: null }),
    ).not.toThrow();
    expect(() =>
      assertRoutingSelectionValid({ routingKind: 'COMMON_AREA', roomId: undefined }),
    ).not.toThrow();
    expect(() =>
      assertRoutingSelectionValid({
        routingKind: 'COMMON_AREA',
        roomId: '01934f3a-1b2c-7d4e-8f90-abcdef123456',
      }),
    ).toThrowError(AppError);
  });

  it('requires exactly one room for private owner and project-managed private tickets', () => {
    expect(() =>
      assertRoutingSelectionValid({ routingKind: 'PRIVATE_OWNER', roomId: null }),
    ).toThrowError(AppError);
    expect(() =>
      assertRoutingSelectionValid({
        routingKind: 'PRIVATE_OWNER',
        roomId: '01934f3a-1b2c-7d4e-8f90-abcdef123456',
      }),
    ).not.toThrow();
    expect(() =>
      assertRoutingSelectionValid({ routingKind: 'PROJECT_MANAGED_PRIVATE', roomId: null }),
    ).toThrowError(AppError);
    expect(() =>
      assertRoutingSelectionValid({
        routingKind: 'PROJECT_MANAGED_PRIVATE',
        roomId: '01934f3a-1b2c-7d4e-8f90-abcdef123456',
      }),
    ).not.toThrow();
  });

  it('accepts only rooms from the eligible list returned for the routing kind', () => {
    expect(() =>
      assertSelectedRoomEligible({
        roomId: '01934f3a-1b2c-7d4e-8f90-abcdef123456',
        eligibleRoomIds: ['01934f3a-1b2c-7d4e-8f90-abcdef123456'],
      }),
    ).not.toThrow();
    expect(() =>
      assertSelectedRoomEligible({
        roomId: '01934f3a-9d8e-7c6b-5a43-210fedcba987',
        eligibleRoomIds: ['01934f3a-1b2c-7d4e-8f90-abcdef123456'],
      }),
    ).toThrowError(AppError);
  });

  it('rejects private owner tickets when the selected room has zero owners', () => {
    expect(() => assertRecipientsPresent(2)).not.toThrow();
    expect(() => assertRecipientsPresent(0)).toThrowError(AppError);
  });

  it('binds the reporter window to the covering project-managed tenancy id', () => {
    const at = new Date('2026-10-01T00:00:00.000Z');
    const start = new Date('2026-09-01T00:00:00.000Z');
    const roomId = '01934f3a-1b2c-7d4e-8f90-abcdef123456';
    const pmTenancy = '01934f3a-9d8e-7c6b-5a43-210fedcba987';
    expect(
      actorWindowBoundToTenancies(
        [{ roomId, tenancyId: pmTenancy, start, end: null }],
        roomId,
        new Set([pmTenancy]),
        at,
      ),
    ).toBe(true);
  });

  it('denies a private-tenancy member even when the room also has a project-managed tenancy', () => {
    const at = new Date('2026-10-01T00:00:00.000Z');
    const start = new Date('2026-09-01T00:00:00.000Z');
    const roomId = '01934f3a-1b2c-7d4e-8f90-abcdef123456';
    const pmTenancy = '01934f3a-9d8e-7c6b-5a43-210fedcba987';
    const privateTenancy = '01934f3a-aaaa-7d4e-8f90-abcdef123456';
    expect(
      actorWindowBoundToTenancies(
        [{ roomId, tenancyId: privateTenancy, start, end: null }],
        roomId,
        new Set([pmTenancy]),
        at,
      ),
    ).toBe(false);
    expect(
      actorWindowBoundToTenancies(
        [{ roomId, tenancyId: null, start, end: null }],
        roomId,
        new Set([pmTenancy]),
        at,
      ),
    ).toBe(false);
  });
});
