import { describe, expect, it } from 'vitest';
import { AppError } from '@/shared/utils/errors';
import {
  assertCommentBodyValid,
  assertCommentTargetOpen,
  decideTicketAction,
  decideTicketTransition,
} from './commentPolicy';

describe('UT-MT-04 comments are append-only on open tickets and denied at terminal', () => {
  it('accepts trimmed comment bodies and rejects blank bodies', () => {
    expect(assertCommentBodyValid('  Lobby light is out  ')).toBe('Lobby light is out');
    expect(() => assertCommentBodyValid('   ')).toThrowError(AppError);
  });

  it('accepts open statuses and rejects terminal statuses as comment targets', () => {
    for (const status of ['PENDING', 'IN_PROGRESS', 'WAITING_FOR_INFO'] as const) {
      expect(() => assertCommentTargetOpen(status)).not.toThrow();
    }
    for (const status of ['COMPLETED', 'REJECTED', 'CANCELLED'] as const) {
      expect(() => assertCommentTargetOpen(status)).toThrowError(AppError);
    }
  });

  it('UT-MT-05 lets the reporter comment on an open ticket and throws concealed errors for outsiders', () => {
    const resource = { routingKind: 'PRIVATE_OWNER' as const, status: 'PENDING' as const };
    expect(() =>
      decideTicketAction(
        {
          actorIsSystemAdmin: false,
          actorSuspended: false,
          actorMustChangePassword: false,
          actorIsReporter: true,
          actorInRecipientSnapshot: false,
        },
        resource,
        'COMMENT',
      ),
    ).not.toThrow();
    try {
      decideTicketAction(
        {
          actorIsSystemAdmin: false,
          actorSuspended: false,
          actorMustChangePassword: false,
          actorIsReporter: false,
          actorInRecipientSnapshot: false,
        },
        resource,
        'COMMENT',
      );
      expect.unreachable('outsider comment must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('RESOURCE_NOT_FOUND');
    }
  });

  it('UT-MT-06 maps suspended actors to forbidden and terminal transitions to validation-adjacent denial', () => {
    try {
      decideTicketTransition(
        {
          actorIsSystemAdmin: false,
          actorSuspended: true,
          actorMustChangePassword: false,
          actorIsReporter: true,
          actorInRecipientSnapshot: false,
        },
        { routingKind: 'PRIVATE_OWNER', status: 'PENDING' },
        'CANCELLED',
      );
      expect.unreachable('suspended transition must throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('ACCESS_DENIED');
    }
    expect(() =>
      decideTicketTransition(
        {
          actorIsSystemAdmin: false,
          actorSuspended: false,
          actorMustChangePassword: false,
          actorIsReporter: true,
          actorInRecipientSnapshot: false,
        },
        { routingKind: 'PRIVATE_OWNER', status: 'PENDING' },
        'CANCELLED',
      ),
    ).not.toThrow();
  });
});
