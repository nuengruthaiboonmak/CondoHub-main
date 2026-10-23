import { describe, expect, it } from 'vitest';
import { AppError } from '@/shared/utils/errors';
import {
  assertTransitionAllowed,
  handlerTransitionsFrom,
  isHandlerTransitionAllowed,
  isReporterCancellable,
  isTerminalStatus,
} from './stateMachine';

describe('UT-MT-02 state machine allows handler transitions and locks terminal tickets without reopen', () => {
  it('exposes the full pending fan-out for handlers', () => {
    expect(handlerTransitionsFrom('PENDING')).toEqual([
      'IN_PROGRESS',
      'WAITING_FOR_INFO',
      'COMPLETED',
      'REJECTED',
      'CANCELLED',
    ]);
  });

  it('allows in progress to wait, complete, reject, or cancel without returning to pending', () => {
    expect(isHandlerTransitionAllowed('IN_PROGRESS', 'WAITING_FOR_INFO')).toBe(true);
    expect(isHandlerTransitionAllowed('IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(isHandlerTransitionAllowed('IN_PROGRESS', 'REJECTED')).toBe(true);
    expect(isHandlerTransitionAllowed('IN_PROGRESS', 'CANCELLED')).toBe(true);
    expect(isHandlerTransitionAllowed('IN_PROGRESS', 'PENDING')).toBe(false);
  });

  it('allows waiting for info to resume, complete, reject, or cancel', () => {
    expect(isHandlerTransitionAllowed('WAITING_FOR_INFO', 'IN_PROGRESS')).toBe(true);
    expect(isHandlerTransitionAllowed('WAITING_FOR_INFO', 'COMPLETED')).toBe(true);
    expect(isHandlerTransitionAllowed('WAITING_FOR_INFO', 'REJECTED')).toBe(true);
    expect(isHandlerTransitionAllowed('WAITING_FOR_INFO', 'CANCELLED')).toBe(true);
  });

  it('locks completed, rejected, and cancelled with no exit transition', () => {
    for (const terminal of ['COMPLETED', 'REJECTED', 'CANCELLED'] as const) {
      expect(isTerminalStatus(terminal)).toBe(true);
      expect(handlerTransitionsFrom(terminal)).toEqual([]);
      expect(() => assertTransitionAllowed(terminal, 'IN_PROGRESS')).toThrowError(AppError);
    }
    expect(isTerminalStatus('PENDING')).toBe(false);
    expect(isTerminalStatus('IN_PROGRESS')).toBe(false);
    expect(isTerminalStatus('WAITING_FOR_INFO')).toBe(false);
  });

  it('rejects same-status transitions and illegal jumps with validation errors', () => {
    expect(() => assertTransitionAllowed('PENDING', 'PENDING')).toThrowError(AppError);
    expect(() => assertTransitionAllowed('IN_PROGRESS', 'PENDING')).toThrowError(AppError);
  });

  it('UT-MT-05 restricts reporter cancellation to pending and waiting for info', () => {
    expect(isReporterCancellable('PENDING', 'CANCELLED')).toBe(true);
    expect(isReporterCancellable('WAITING_FOR_INFO', 'CANCELLED')).toBe(true);
    expect(isReporterCancellable('IN_PROGRESS', 'CANCELLED')).toBe(false);
    expect(isReporterCancellable('PENDING', 'COMPLETED')).toBe(false);
  });
});
