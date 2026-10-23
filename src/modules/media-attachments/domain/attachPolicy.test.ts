import { describe, expect, it } from 'vitest';
import { IMAGE_COUNT_CAPS } from '@/config/imageLimits';
import { validateAttachable, type AttachCandidate } from './attachPolicy';

const ENTITY = { type: 'announcement', id: '01934f3a-aaaa-7d4e-8f90-abcdef123456' };

function candidate(overrides?: Partial<AttachCandidate>): AttachCandidate {
  return {
    id: '01934f3a-bbbb-7d4e-8f90-abcdef123456',
    state: 'READY',
    scope: 'ANNOUNCEMENT',
    uploadedBy: 'admin-1',
    ownerEntityType: null,
    ownerEntityId: null,
    ...overrides,
  };
}

describe('UT-UP-02 attach validation: ownership, scope, READY, uniqueness', () => {
  it('accepts the owner’s own unattached READY images within cap', () => {
    expect(
      validateAttachable(['img-1'], [candidate({ id: 'img-1' })], {
        scope: 'ANNOUNCEMENT',
        entityRef: ENTITY,
        ownerUserId: 'admin-1',
        maxCount: 5,
      }),
    ).toBeNull();
  });

  it('accepts an empty attach set as a no-op', () => {
    expect(
      validateAttachable([], [], {
        scope: 'ANNOUNCEMENT',
        entityRef: ENTITY,
        ownerUserId: 'admin-1',
        maxCount: 5,
      }),
    ).toBeNull();
  });

  it('rejects duplicate ids inside one operation', () => {
    expect(
      validateAttachable(['img-1', 'img-1'], [candidate({ id: 'img-1' })], {
        scope: 'ANNOUNCEMENT',
        entityRef: ENTITY,
        ownerUserId: 'admin-1',
        maxCount: 5,
      }),
    ).toBe('Duplicate image ids are not allowed.');
  });

  it('rejects missing images', () => {
    expect(
      validateAttachable(['img-1', 'img-gone'], [candidate({ id: 'img-1' })], {
        scope: 'ANNOUNCEMENT',
        entityRef: ENTITY,
        ownerUserId: 'admin-1',
        maxCount: 5,
      }),
    ).toBe('One or more images were not found.');
  });

  it('rejects non-READY images so PENDING can never attach', () => {
    for (const state of ['PENDING', 'UPLOADED', 'REJECTED', 'ORPHANED'] as const) {
      expect(
        validateAttachable(['img-1'], [candidate({ id: 'img-1', state })], {
          scope: 'ANNOUNCEMENT',
          entityRef: ENTITY,
          ownerUserId: 'admin-1',
          maxCount: 5,
        }),
      ).toBe('Only verified images can be attached.');
    }
  });

  it('rejects scope spoofing: a CHAT image cannot attach to an announcement', () => {
    expect(
      validateAttachable(['img-1'], [candidate({ id: 'img-1', scope: 'CHAT' })], {
        scope: 'ANNOUNCEMENT',
        entityRef: ENTITY,
        ownerUserId: 'admin-1',
        maxCount: 5,
      }),
    ).toBe('The image scope does not match.');
  });

  it('rejects another user’s images', () => {
    expect(
      validateAttachable(['img-1'], [candidate({ id: 'img-1', uploadedBy: 'someone-else' })], {
        scope: 'ANNOUNCEMENT',
        entityRef: ENTITY,
        ownerUserId: 'admin-1',
        maxCount: 5,
      }),
    ).toBe('Only your own images can be attached.');
  });
});

describe('UT-UP-02 F-02 single-attach: one image belongs to at most one entity', () => {
  it('rejects attaching an image that is already attached to another record', () => {
    expect(
      validateAttachable(
        ['img-1'],
        [candidate({ id: 'img-1', ownerEntityType: 'announcement', ownerEntityId: 'other-record' })],
        {
          scope: 'ANNOUNCEMENT',
          entityRef: ENTITY,
          ownerUserId: 'admin-1',
          maxCount: 5,
        },
      ),
    ).toBe('This image is already attached to another record.');
  });

  it('allows re-attaching to the same entity so idempotent updates keep working', () => {
    expect(
      validateAttachable(
        ['img-1'],
        [candidate({ id: 'img-1', ownerEntityType: ENTITY.type, ownerEntityId: ENTITY.id })],
        {
          scope: 'ANNOUNCEMENT',
          entityRef: ENTITY,
          ownerUserId: 'admin-1',
          maxCount: 5,
        },
      ),
    ).toBeNull();
  });
});

describe('UT-UP-02 count caps N/N+1 for every D09-1 action', () => {
  it('slip allows exactly 1 and rejects 2', () => {
    const cap = IMAGE_COUNT_CAPS.SUBMIT_PAYMENT;
    expect(cap.max).toBe(1);
    expect(
      validateAttachable(['s1'], [candidate({ id: 's1', scope: 'PAYMENT_SLIP' })], {
        scope: 'PAYMENT_SLIP',
        entityRef: { type: 'payment_submission', id: 'sub-1' },
        ownerUserId: 'admin-1',
        maxCount: cap.max,
      }),
    ).toBeNull();
    expect(
      validateAttachable(
        ['s1', 's2'],
        [candidate({ id: 's1', scope: 'PAYMENT_SLIP' }), candidate({ id: 's2', scope: 'PAYMENT_SLIP' })],
        {
          scope: 'PAYMENT_SLIP',
          entityRef: { type: 'payment_submission', id: 'sub-1' },
          ownerUserId: 'admin-1',
          maxCount: cap.max,
        },
      ),
    ).toBe('Too many images. The maximum is 1.');
  });

  it('QR and chat allow 0..1 and reject 2', () => {
    for (const action of ['SAVE_PAYMENT_INSTRUCTION', 'SEND_CHAT_MESSAGE'] as const) {
      const cap = IMAGE_COUNT_CAPS[action];
      expect(cap.min).toBe(0);
      expect(cap.max).toBe(1);
      const ids = ['q1', 'q2'];
      const found = ids.map((id) => candidate({ id, scope: cap.scope }));
      expect(
        validateAttachable(ids, found, {
          scope: cap.scope,
          entityRef: { type: 'owner', id: 'owner-1' },
          ownerUserId: 'admin-1',
          maxCount: cap.max,
        }),
      ).toBe('Too many images. The maximum is 1.');
      expect(
        validateAttachable(['q1'], [candidate({ id: 'q1', scope: cap.scope })], {
          scope: cap.scope,
          entityRef: { type: 'owner', id: 'owner-1' },
          ownerUserId: 'admin-1',
          maxCount: cap.max,
        }),
      ).toBeNull();
    }
  });

  it('ticket create allows 5 and rejects 6; comment allows 3 and rejects 4', () => {
    const ticket = IMAGE_COUNT_CAPS.CREATE_TICKET;
    const five = ['t1', 't2', 't3', 't4', 't5'];
    expect(
      validateAttachable(
        five,
        five.map((id) => candidate({ id, scope: 'MAINTENANCE' })),
        {
          scope: 'MAINTENANCE',
          entityRef: { type: 'maintenance_request', id: 'ticket-1' },
          ownerUserId: 'admin-1',
          maxCount: ticket.max,
        },
      ),
    ).toBeNull();
    const six = [...five, 't6'];
    expect(
      validateAttachable(
        six,
        six.map((id) => candidate({ id, scope: 'MAINTENANCE' })),
        {
          scope: 'MAINTENANCE',
          entityRef: { type: 'maintenance_request', id: 'ticket-1' },
          ownerUserId: 'admin-1',
          maxCount: ticket.max,
        },
      ),
    ).toBe('Too many images. The maximum is 5.');
    const comment = IMAGE_COUNT_CAPS.ADD_TICKET_COMMENT;
    const four = ['c1', 'c2', 'c3', 'c4'];
    expect(
      validateAttachable(
        four,
        four.map((id) => candidate({ id, scope: 'MAINTENANCE' })),
        {
          scope: 'MAINTENANCE',
          entityRef: { type: 'maintenance_comment', id: 'comment-1' },
          ownerUserId: 'admin-1',
          maxCount: comment.max,
        },
      ),
    ).toBe('Too many images. The maximum is 3.');
  });

  it('announcement allows 5 and rejects 6', () => {
    const cap = IMAGE_COUNT_CAPS.PUBLISH_ANNOUNCEMENT;
    const six = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'];
    expect(
      validateAttachable(
        six,
        six.map((id) => candidate({ id })),
        {
          scope: 'ANNOUNCEMENT',
          entityRef: ENTITY,
          ownerUserId: 'admin-1',
          maxCount: cap.max,
        },
      ),
    ).toBe('Too many images. The maximum is 5.');
  });
});
