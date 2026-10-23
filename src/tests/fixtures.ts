import { fakeUuid } from './fakes';

export type FixtureVariant = 'normal' | 'long-text' | 'edge';

export interface FixtureOptions<TOverrides> {
  variant?: FixtureVariant;
  overrides?: TOverrides;
}

export const LONG_TEXT_280 = 'L'.repeat(280);

export const LONG_TEXT_2000 = 'L'.repeat(2000);

export const LONG_TEXT_5000 = 'L'.repeat(5000);

function resolveVariant(opts?: { variant?: FixtureVariant }): FixtureVariant {
  return opts?.variant ?? 'normal';
}

export interface UserFixture {
  id: string;
  username: string;
  expectedUsername: string;
  email: string;
  name: string;
  phone: string;
  accountStatus: 'ACTIVE' | 'SUSPENDED';
  mustChangePassword: boolean;
}

const LONG_PERSON_NAME =
  'Alexandria Constantine Worthington Pemberton-Fitzgerald Montgomery-Smythe III';

export function buildUser(opts?: FixtureOptions<Partial<UserFixture>>): UserFixture {
  const variant = resolveVariant(opts);
  const id = fakeUuid({ prefix: '10000000' });
  const username = variant === 'long-text' ? `e2e_long_username_${'u'.repeat(60)}` : 'alex.rivera';
  return {
    id,
    username,
    expectedUsername: username.trim().toLowerCase(),
    email: variant === 'long-text' ? `${'e'.repeat(64)}@example.invalid` : 'alex.rivera@example.invalid',
    name: variant === 'long-text' ? LONG_PERSON_NAME : 'Alex Rivera',
    phone: variant === 'edge' ? '+6600000000' : '+6600000001',
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    ...opts?.overrides,
  };
}

export interface RoomFixture {
  id: string;
  buildingCode: string;
  roomCode: string;
  floorCode: string;
  areaSqm: string;
  notes: string | null;
}

export function buildRoom(opts?: FixtureOptions<Partial<RoomFixture>>): RoomFixture {
  const variant = resolveVariant(opts);
  return {
    id: fakeUuid({ prefix: '20000000' }),
    buildingCode: 'T1',
    roomCode: 'T1-101',
    floorCode: '1',
    areaSqm: variant === 'edge' ? '0.01' : '35.50',
    notes: variant === 'long-text' ? LONG_TEXT_2000 : variant === 'edge' ? '' : 'Corner unit near lobby.',
    ...opts?.overrides,
  };
}

export interface TicketFixture {
  subject: string;
  description: string;
  locationDescription: string;
}

export function buildTicket(opts?: FixtureOptions<Partial<TicketFixture>>): TicketFixture {
  const variant = resolveVariant(opts);
  if (variant === 'long-text') {
    return {
      subject: LONG_TEXT_280,
      description: LONG_TEXT_5000,
      locationDescription: LONG_TEXT_2000,
      ...opts?.overrides,
    };
  }
  return {
    subject: 'Leaking faucet in kitchen',
    description: 'The kitchen faucet drips constantly since yesterday morning.',
    locationDescription: 'Kitchen sink, unit T1-101.',
    ...opts?.overrides,
  };
}

export interface CommentFixture {
  body: string;
}

export function buildComment(opts?: FixtureOptions<Partial<CommentFixture>>): CommentFixture {
  const variant = resolveVariant(opts);
  return {
    body: variant === 'long-text' ? LONG_TEXT_2000 : 'Technician visit scheduled for tomorrow.',
    ...opts?.overrides,
  };
}

export interface MessageFixture {
  text: string | null;
}

export function buildMessage(opts?: FixtureOptions<Partial<MessageFixture>>): MessageFixture {
  const variant = resolveVariant(opts);
  if (variant === 'long-text') {
    return { text: LONG_TEXT_2000, ...opts?.overrides };
  }
  if (variant === 'edge') {
    return { text: 'x', ...opts?.overrides };
  }
  return { text: 'Hello neighbors, the lobby lift is back in service.', ...opts?.overrides };
}

export interface AnnouncementFixture {
  title: string;
  body: string;
}

export function buildAnnouncement(
  opts?: FixtureOptions<Partial<AnnouncementFixture>>,
): AnnouncementFixture {
  const variant = resolveVariant(opts);
  if (variant === 'long-text') {
    return { title: LONG_TEXT_280, body: LONG_TEXT_5000, ...opts?.overrides };
  }
  return {
    title: 'Scheduled water maintenance',
    body: 'Water supply will pause briefly on Sunday morning for scheduled maintenance.',
    ...opts?.overrides,
  };
}

export interface MoneyFixture {
  amount: string;
  currency: 'THB';
}

export function buildMoney(opts?: FixtureOptions<Partial<MoneyFixture>>): MoneyFixture {
  const variant = resolveVariant(opts);
  if (variant === 'edge') {
    return { amount: '0.00', currency: 'THB', ...opts?.overrides };
  }
  return { amount: '3000.00', currency: 'THB', ...opts?.overrides };
}

export interface RejectReasonFixture {
  reason: string;
}

export function buildRejectReason(
  opts?: FixtureOptions<Partial<RejectReasonFixture>>,
): RejectReasonFixture {
  const variant = resolveVariant(opts);
  return {
    reason:
      variant === 'long-text'
        ? LONG_TEXT_2000
        : 'The slip is blurry. Please upload a readable image.',
    ...opts?.overrides,
  };
}

export interface FacilityFixture {
  code: string;
  name: string;
  description: string | null;
}

export function buildFacility(opts?: FixtureOptions<Partial<FacilityFixture>>): FacilityFixture {
  const variant = resolveVariant(opts);
  if (variant === 'long-text') {
    return {
      code: 'POOL',
      name: `Swimming Pool ${LONG_TEXT_280}`,
      description: LONG_TEXT_2000,
      ...opts?.overrides,
    };
  }
  return {
    code: 'POOL',
    name: 'Swimming Pool',
    description: 'Outdoor pool on the ground floor.',
    ...opts?.overrides,
  };
}

export interface QuotaBoundaryFixture {
  quotaLimit: number;
  quotaUsed: number;
  requested: number;
}

export function quotaBoundaries(limit: number): QuotaBoundaryFixture[] {
  return [
    { quotaLimit: limit, quotaUsed: 0, requested: 1 },
    { quotaLimit: limit, quotaUsed: 1, requested: 1 },
    { quotaLimit: limit, quotaUsed: limit, requested: 0 },
    { quotaLimit: limit, quotaUsed: limit, requested: 1 },
    { quotaLimit: limit, quotaUsed: limit + 1, requested: 0 },
  ];
}
