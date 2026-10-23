import 'server-only';
import type { Actor } from '@/shared/auth/actor';
import { db } from '@/shared/db/client';
import type { Db } from '@/shared/db/transaction';
import { AppError } from '@/shared/utils/errors';
import { satangToDecimalString } from '@/shared/utils/money';
import { formatProjectDate, projectDateParts } from '@/shared/utils/clock';
import {
  listMembershipWindowsByUser,
  type MembershipWindowRef,
} from '@/modules/property-membership/application/index';
import type { InvoiceKind } from '../infrastructure/schema';
import {
  allowedInvoiceKinds,
  evaluateInvoiceAccess,
  membershipOverlapsServicePeriod,
  type InvoiceAccessContext,
  type InvoiceQueueAction,
  type InvoiceListView,
} from '../domain/invoicePolicy';
import {
  deriveInvoiceState,
  isOverdue,
  outstandingSatang,
  type DerivedInvoiceState,
} from '../domain/paymentState';
import {
  findInvoiceById,
  isFeeResponsibleOwner,
  isInvoiceMemberVisible,
  isRentReviewer,
  listInvoicesForMember,
  listInvoicesScoped,
  readInvoiceBalance,
  tenantOverlapsInvoice,
  type InvoiceRecord,
} from '../infrastructure/invoiceRepository';

export interface InvoiceDto {
  id: string;
  roomId: string;
  tenancyId: string | null;
  kind: InvoiceKind;
  periodStart: string;
  periodEnd: string;
  total: { amount: string; currency: 'THB' };
  dueDate: string;
  issuedAt: string | null;
  version: number;
  state: DerivedInvoiceState;
  approvedTotal: { amount: string; currency: 'THB' };
  outstanding: { amount: string; currency: 'THB' };
  overdue: boolean;
  pendingOnPaid: boolean;
}

export interface InvoicePage {
  rows: InvoiceDto[];
  total: number;
}

function toDto(
  row: InvoiceRecord,
  balance: { approvedTotal: bigint; pendingCount: number },
  at: Date,
): InvoiceDto {
  const outstanding = outstandingSatang(row.total, balance.approvedTotal);
  const state = deriveInvoiceState(row.total, balance.approvedTotal);
  const today = formatProjectDate(projectDateParts(at, row.snapshotTimezone));
  return {
    id: row.id,
    roomId: row.roomId,
    tenancyId: row.tenancyId,
    kind: row.kind,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    total: { amount: satangToDecimalString(row.total), currency: 'THB' },
    dueDate: row.dueDate,
    issuedAt: row.issuedAt === null ? null : row.issuedAt.toISOString(),
    version: row.version,
    state,
    approvedTotal: { amount: satangToDecimalString(balance.approvedTotal), currency: 'THB' },
    outstanding: { amount: satangToDecimalString(outstanding), currency: 'THB' },
    overdue: isOverdue({
      projectToday: today,
      dueDate: row.dueDate,
      outstandingSatang: outstanding,
    }),
    pendingOnPaid: state === 'PAID' && balance.pendingCount > 0,
  };
}

function assertActive(actor: Actor): void {
  if (actor.accountStatus !== 'ACTIVE') throw new AppError('ACCESS_DENIED');
  if (actor.mustChangePassword) throw new AppError('FIRST_LOGIN_PASSWORD_CHANGE_REQUIRED');
}

async function windowsFor(
  conn: Db,
  userId: string,
  cache: MembershipWindowRef[] | null,
): Promise<MembershipWindowRef[]> {
  void conn;
  if (cache !== null) return cache;
  return listMembershipWindowsByUser(userId);
}

function windowTenantOverlap(windows: MembershipWindowRef[], row: InvoiceRecord): boolean {
  if (row.tenancyId === null) return false;
  return windows.some(
    (window) =>
      window.tenancyId === row.tenancyId &&
      membershipOverlapsServicePeriod({
        membershipStart: window.start,
        membershipEnd: window.end,
        serviceStart: row.serviceStart,
        serviceEndExclusive: row.serviceEndExclusive,
      }),
  );
}

function windowResidentOfRoom(
  windows: MembershipWindowRef[],
  row: InvoiceRecord,
  at: Date,
): boolean {
  return windows.some(
    (window) =>
      window.roomId === row.roomId &&
      window.start.getTime() <= at.getTime() &&
      (window.end === null || window.end.getTime() > at.getTime()),
  );
}

export interface InvoiceAccessProbe {
  context: InvoiceAccessContext;
  windows: MembershipWindowRef[];
}

export async function probeInvoiceAccess(
  actor: Actor,
  row: InvoiceRecord,
  at: Date,
  conn: Db = db,
  cached: MembershipWindowRef[] | null = null,
): Promise<InvoiceAccessProbe> {
  const windows = await windowsFor(conn, actor.userId, cached);
  const [rentReviewer, feeResponsible] = await Promise.all([
    row.kind === 'PRIVATE_RENT'
      ? isRentReviewer(conn, { invoiceId: row.id, userId: actor.userId })
      : Promise.resolve(false),
    row.kind === 'COMMON_FEE'
      ? isFeeResponsibleOwner(conn, { invoiceId: row.id, userId: actor.userId })
      : Promise.resolve(false),
  ]);
  const tenantOverlap =
    row.tenancyId === null
      ? false
      : windowTenantOverlap(windows, row) ||
        (await tenantOverlapsInvoice(conn, {
          userId: actor.userId,
          tenancyId: row.tenancyId,
          serviceStart: row.serviceStart,
          serviceEndExclusive: row.serviceEndExclusive,
        }));
  return {
    windows,
    context: {
      kind: row.kind,
      actorIsSystemAdmin: actor.isSystemAdmin,
      actorSuspended: actor.accountStatus !== 'ACTIVE',
      actorMustChangePassword: actor.mustChangePassword,
      inRentReviewerSnapshot: rentReviewer,
      inFeeResponsibleSnapshot: feeResponsible,
      tenantOverlap,
      activeResidentOfRoom: windowResidentOfRoom(windows, row, at),
      currentOwnerOfRoom: false,
      invoicePaid: false,
      pendingOnInvoice: false,
    },
  };
}

export function decideInvoiceAction(
  context: InvoiceAccessContext,
  action: InvoiceQueueAction,
): void {
  const verdict = evaluateInvoiceAccess(context, action);
  if (!verdict.allowed) {
    if (verdict.httpStatus === 403) throw new AppError('ACCESS_DENIED');
    throw new AppError('RESOURCE_NOT_FOUND');
  }
}

export async function listInvoices(
  actor: Actor,
  input: {
    roomId?: string | undefined;
    kind?: InvoiceKind | undefined;
    oneTimeChargeEventId?: string | undefined;
    view?: InvoiceListView | undefined;
    page: number;
    pageSize: number;
    at: Date;
  },
  conn: Db = db,
): Promise<InvoicePage> {
  assertActive(actor);
  const allowedKinds = allowedInvoiceKinds(actor.isSystemAdmin);
  if (input.kind !== undefined && !allowedKinds.includes(input.kind)) {
    throw new AppError('RESOURCE_NOT_FOUND');
  }
  const limit = Math.min(Math.max(input.pageSize, 1), 100);
  const offset = (Math.max(input.page, 1) - 1) * limit;
  if (actor.isSystemAdmin) {
    if (input.view === 'receivable') return { rows: [], total: 0 };
    const page = await listInvoicesScoped(conn, {
      allowedKinds,
      limit,
      offset,
      ...(input.roomId !== undefined ? { roomId: input.roomId } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.oneTimeChargeEventId !== undefined
        ? { oneTimeChargeEventId: input.oneTimeChargeEventId }
        : {}),
    });
    return {
      rows: await Promise.all(
        page.rows.map(async (row) => {
          const balance = await conn.transaction((tx) => readInvoiceBalance(tx, row.id));
          return toDto(row, balance, input.at);
        }),
      ),
      total: page.total,
    };
  }
  const page = await listInvoicesForMember(conn, {
    userId: actor.userId,
    at: input.at,
    limit,
    offset,
    view: input.view,
    ...(input.roomId !== undefined ? { roomId: input.roomId } : {}),
    ...(input.kind !== undefined ? { kind: input.kind } : {}),
    ...(input.oneTimeChargeEventId !== undefined
      ? { oneTimeChargeEventId: input.oneTimeChargeEventId }
      : {}),
  });
  return {
    rows: await Promise.all(
      page.rows.map(async (row) => {
        const balance = await conn.transaction((tx) => readInvoiceBalance(tx, row.id));
        return toDto(row, balance, input.at);
      }),
    ),
    total: page.total,
  };
}

export async function getInvoice(
  actor: Actor,
  id: string,
  at: Date,
  conn: Db = db,
): Promise<InvoiceDto | null> {
  assertActive(actor);
  const row = await findInvoiceById(conn, id);
  if (row === null) return null;
  if (actor.isSystemAdmin) {
    if (row.kind === 'PRIVATE_RENT') return null;
    const balance = await conn.transaction((tx) => readInvoiceBalance(tx, row.id));
    return toDto(row, balance, at);
  }
  const visible = await isInvoiceMemberVisible(conn, {
    invoiceId: row.id,
    userId: actor.userId,
    at,
  });
  if (!visible) return null;
  const balance = await conn.transaction((tx) => readInvoiceBalance(tx, row.id));
  return toDto(row, balance, at);
}

export async function requireInvoiceForAction(
  actor: Actor,
  id: string,
  action: InvoiceQueueAction,
  at: Date,
  conn: Db = db,
): Promise<InvoiceRecord> {
  assertActive(actor);
  const row = await findInvoiceById(conn, id);
  if (row === null) throw new AppError('RESOURCE_NOT_FOUND');
  if (actor.isSystemAdmin) {
    if (row.kind === 'PRIVATE_RENT') throw new AppError('RESOURCE_NOT_FOUND');
    const balance = await conn.transaction((tx) => readInvoiceBalance(tx, row.id));
    decideInvoiceAction(
      {
        kind: row.kind,
        actorIsSystemAdmin: true,
        actorSuspended: false,
        actorMustChangePassword: false,
        inRentReviewerSnapshot: false,
        inFeeResponsibleSnapshot: false,
        tenantOverlap: false,
        activeResidentOfRoom: false,
        currentOwnerOfRoom: false,
        invoicePaid: deriveInvoiceState(row.total, balance.approvedTotal) === 'PAID',
        pendingOnInvoice: balance.pendingCount > 0,
      },
      action,
    );
    return row;
  }
  const visible = await isInvoiceMemberVisible(conn, {
    invoiceId: row.id,
    userId: actor.userId,
    at,
  });
  if (!visible) throw new AppError('RESOURCE_NOT_FOUND');
  const balance = await conn.transaction((tx) => readInvoiceBalance(tx, row.id));
  const probe = await probeInvoiceAccess(actor, row, at, conn);
  decideInvoiceAction(
    {
      ...probe.context,
      invoicePaid: deriveInvoiceState(row.total, balance.approvedTotal) === 'PAID',
      pendingOnInvoice: balance.pendingCount > 0,
    },
    action,
  );
  return row;
}

export async function getInvoiceUiPermissions(actor: Actor, id: string, at: Date) {
  assertActive(actor);
  const row = await findInvoiceById(db, id);
  if (!row) throw new AppError('RESOURCE_NOT_FOUND');
  const [{ context }, balance] = await Promise.all([
    probeInvoiceAccess(actor, row, at),
    db.transaction((tx) => readInvoiceBalance(tx, id)),
  ]);
  const grants = {
    ...context,
    invoicePaid: deriveInvoiceState(row.total, balance.approvedTotal) === 'PAID',
    pendingOnInvoice: balance.pendingCount > 0,
  };
  if (!evaluateInvoiceAccess(grants, 'VIEW').allowed) throw new AppError('RESOURCE_NOT_FOUND');
  return {
    receivesRent: context.kind === 'PRIVATE_RENT' && context.inRentReviewerSnapshot,
    canEdit: evaluateInvoiceAccess(grants, 'EDIT').allowed,
    canApprove: evaluateInvoiceAccess(grants, 'REVIEW_APPROVE').allowed,
    canReject: evaluateInvoiceAccess(grants, 'REVIEW_REJECT').allowed,
    canSubmit: evaluateInvoiceAccess(grants, 'SUBMIT_PAYMENT').allowed,
  };
}
