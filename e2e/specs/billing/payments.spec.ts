import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { projectToday } from '../../helpers/dates';
import { completeFirstLogin, loginAsAdmin, provisionUser, roomOwnerAt, signInSuspendedActor } from '../../helpers/owner';
import { buildValidImage } from '../../helpers/announcementFiles';
import { completeUpload, mintIntent, putBytes, readAccess } from '../upload/uploadFlow';
import {
  findBillingRoom,
  getInvoice,
  getPayments,
  listInvoices,
  patchInvoice,
  postApprove,
  postReject,
  postSubmission,
  triggerGenerate,
  type ErrorEnvelope,
  type InvoiceEditEnvelope,
  type InvoiceRevisionRow,
  type InvoiceRow,
  type PaymentInstructionEnvelope,
  type PaymentReviewEnvelope,
  type PaymentSubmissionsEnvelope,
  type PaymentSubmitEnvelope,
} from './billingFlow';

interface ProbePaymentsResult {
  invoiceId: string;
  submissions: Array<{ id: string; state: string; approvedAmount: string | null; reviewedBy: string | null }>;
  revisions: Array<{ oldTotal: string; newTotal: string; reason: string | null; actorId: string | null }>;
  balance: { approvedTotal: string; pendingCount: number };
}

interface ProbeAuditResult {
  resourceId: string;
  entries: Array<{ action: string; resourceType: string; after: unknown }>;
}

interface ProbePayeeResult {
  roomCode: string;
  payee: { bankName: string; accountName: string; accountNumber: string; qrImageId: string | null } | null;
}

async function runBillingOps(args: string[]): Promise<string> {
  const root = path.resolve(__dirname, '..', '..', '..');
  return new Promise<string>((resolve, reject) => {
    const child = spawn('pnpm', ['billing:ops', ...args], {
      cwd: root,
      shell: process.platform === 'win32',
      env: process.env,
    });
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      errors += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code: number) => {
      if (code !== 0) {
        reject(new Error(`billing:ops ${args.join(' ')} exited ${code}: ${output} ${errors}`));
        return;
      }
      const line = output
        .split('\n')
        .map((entry) => entry.trim())
        .find((entry) => entry.startsWith('{'));
      if (line === undefined) throw new Error(`billing:ops printed no result: ${output} ${errors}`);
      resolve(line);
    });
  });
}

async function probePayments(invoiceId: string): Promise<ProbePaymentsResult> {
  return JSON.parse(await runBillingOps(['probe-payments', '--', '--invoice', invoiceId])) as ProbePaymentsResult;
}

async function probeAudit(resourceId: string): Promise<ProbeAuditResult> {
  return JSON.parse(await runBillingOps(['probe-audit', '--', '--resource', resourceId])) as ProbeAuditResult;
}

async function probePayee(roomCode: string, payeeType: string): Promise<ProbePayeeResult> {
  return JSON.parse(
    await runBillingOps(['probe-payee', '--', '--room', roomCode, '--type', payeeType]),
  ) as ProbePayeeResult;
}

async function probeRentReviewers(invoiceId: string): Promise<string[]> {
  const line = await runBillingOps(['probe-rent-reviewers', '--', '--invoice', invoiceId]);
  return (JSON.parse(line) as { snapshotReviewers: string[] }).snapshotReviewers;
}

async function driveAddMember(input: {
  roomCode: string;
  username: string;
  tenancyId: string;
  role: string;
  at: string;
  end?: string;
}): Promise<{ membershipId: string }> {
  const args = [
    'add-member',
    '--',
    '--room',
    input.roomCode,
    '--user',
    input.username,
    '--tenancy',
    input.tenancyId,
    '--role',
    input.role,
    '--at',
    input.at,
  ];
  if (input.end !== undefined) args.push('--end', input.end);
  return JSON.parse(await runBillingOps(args)) as { membershipId: string };
}

async function backdatedTransfer(
  page: Page,
  input: { roomId: string; fromUserId: string; toUserId: string; effectiveAt: string },
): Promise<void> {
  const transferred = await apiJson<{ data: { endedOwnershipId: string } }>(page.request, {
    method: 'POST',
    path: `/api/admin/rooms/${input.roomId}/ownerships`,
    body: {
      action: 'TRANSFER',
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      effectiveAt: input.effectiveAt,
    },
  });
  expect(transferred.status).toBe(200);
}

async function mintReadySlip(
  request: APIRequestContext,
  fileName: string,
  size = 16,
): Promise<string> {
  const fixture = await buildValidImage('png', size);
  const intent = await mintIntent(request, {
    scope: 'PAYMENT_SLIP',
    entityRef: { type: 'owner', id: null },
    contentType: fixture.contentType,
    fileName,
  });
  expect(intent.status).toBe(200);
  expect(await putBytes(intent.json.data.uploadUrl, fixture.contentType, fixture.bytes)).toBeLessThan(300);
  const completed = await completeUpload(request, intent.json.data.imageId);
  expect(completed.status).toBe(200);
  expect(completed.json.data.state).toBe('READY');
  return intent.json.data.imageId;
}

function expectedOverdue(outstandingAmount: string, dueDate: string): boolean {
  return outstandingAmount !== '0.00' && projectToday() > dueDate;
}

function pickInvoice(rows: InvoiceRow[], kind: InvoiceRow['kind'], periodStart: string): InvoiceRow {
  const found = rows.find((row) => row.kind === kind && row.periodStart === periodStart);
  if (found === undefined) throw new Error(`No ${kind} invoice for ${periodStart}.`);
  return found;
}

interface ActorSession {
  userId: string;
  username: string;
  password: string;
  page: Page;
  close: () => Promise<void>;
}

interface PaymentsCtx {
  revA: ActorSession;
  revC: ActorSession;
  buyerC: ActorSession;
  tenantA: ActorSession;
  tenantB: ActorSession;
  stranger: ActorSession;
  room210: string;
  room211: string;
  room212: string;
  room213: string;
  tenancy211: string;
}

const ctx: Partial<PaymentsCtx> = {};

function actorUsername(runId: string, workerIndex: number, stem: string): string {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `e2e${suffix}${stem}${workerIndex}`.slice(0, 30);
}

function actorPassword(runId: string): string {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `Pay-${suffix}-pw1`;
}

test.describe('billing payments: submit, review, edit, transfer, tenants, admin scope', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240000);

  test('setup: provision snapshot owners, d04-a memberships, december and march invoices', async ({
    page,
    browser,
  }, testInfo) => {
    test.setTimeout(600000);
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const room210 = await findBillingRoom(page, `E2E-${runId}-210`);
    const room211 = await findBillingRoom(page, `E2E-${runId}-211`);
    const room212 = await findBillingRoom(page, `E2E-${runId}-212`);
    const room213 = await findBillingRoom(page, `E2E-${runId}-213`);
    ctx.room210 = room210;
    ctx.room211 = room211;
    ctx.room212 = room212;
    ctx.room213 = room213;
    const password = actorPassword(runId);

    async function provisionActor(stem: string): Promise<ActorSession> {
      const username = actorUsername(runId, testInfo.workerIndex, stem);
      const provisioned = await provisionUser(page, { username, name: `Payments ${stem} ${runId}` });
      const context = await browser.newContext({ baseURL });
      const userPage = await context.newPage();
      await completeFirstLogin(userPage, {
        username,
        tempPassword: provisioned.tempPassword,
        newPassword: password,
      });
      return { userId: provisioned.userId, username, password, page: userPage, close: () => context.close() };
    }

    const revA = await provisionActor('payreva');
    const revC = await provisionActor('payrevc');
    const buyerC = await provisionActor('paybuyc');
    const tenantA = await provisionActor('paytena');
    const tenantB = await provisionActor('paytenb');
    const stranger = await provisionActor('paystr');
    ctx.revA = revA;
    ctx.revC = revC;
    ctx.buyerC = buyerC;
    ctx.tenantA = tenantA;
    ctx.tenantB = tenantB;
    ctx.stranger = stranger;

    for (const roomId of [room211, room212]) {
      await backdatedTransfer(page, {
        roomId,
        fromUserId: await roomOwnerAt(page, roomId),
        toUserId: revA.userId,
        effectiveAt: '2023-01-02T00:00:00.000Z',
      });
    }
    const ownersBefore = await apiJson<{ data: { owners: Array<{ userId: string }> } }>(page.request, {
      method: 'GET',
      path: `/api/rooms/${room210}`,
    });
    expect(ownersBefore.status).toBe(200);
    expect(ownersBefore.json.data.owners).toHaveLength(2);
    await backdatedTransfer(page, {
      roomId: room210,
      fromUserId: ownersBefore.json.data.owners[0]?.userId ?? '',
      toUserId: revA.userId,
      effectiveAt: '2023-01-02T00:00:00.000Z',
    });
    await backdatedTransfer(page, {
      roomId: room210,
      fromUserId: ownersBefore.json.data.owners[1]?.userId ?? '',
      toUserId: revC.userId,
      effectiveAt: '2023-01-02T00:00:00.000Z',
    });
    const owners210 = await apiJson<{ data: { owners: Array<{ userId: string }> } }>(page.request, {
      method: 'GET',
      path: `/api/rooms/${room210}`,
    });
    expect(owners210.json.data.owners.map((owner) => owner.userId).sort()).toEqual(
      [revA.userId, revC.userId].sort(),
    );

    const detail211 = await apiJson<{
      data: { tenancies: Array<{ id: string; state: string; managementMode: string }> };
    }>(page.request, { method: 'GET', path: `/api/rooms/${room211}` });
    expect(detail211.status).toBe(200);
    const tenancy211 = detail211.json.data.tenancies.find(
      (entry) => entry.state === 'ACTIVE' && entry.managementMode === 'PRIVATE_OWNER_MANAGED',
    );
    if (tenancy211 === undefined) throw new Error('Room 211 has no active private tenancy.');
    ctx.tenancy211 = tenancy211.id;
    await driveAddMember({
      roomCode: `E2E-${runId}-211`,
      username: tenantA.username,
      tenancyId: tenancy211.id,
      role: 'SUB',
      at: '2027-01-10T00:00:00.000Z',
    });
    await driveAddMember({
      roomCode: `E2E-${runId}-211`,
      username: tenantB.username,
      tenancyId: tenancy211.id,
      role: 'SUB',
      at: '2027-04-15T00:00:00.000Z',
      end: '2027-06-30T00:00:00.000Z',
    });

    const december = await triggerGenerate(page.request, { triggerSource: 'MANUAL', fromCycle: '2026-12' });
    expect(december.json.data.caughtUp).toBe(true);
    const march = await triggerGenerate(page.request, { triggerSource: 'MANUAL', fromCycle: '2027-03' });
    expect(march.json.data.caughtUp).toBe(true);
    for (const cycle of ['2027-01', '2027-02', '2027-06']) {
      const run = await triggerGenerate(page.request, { triggerSource: 'MANUAL', fromCycle: cycle });
      expect(run.json.data.caughtUp).toBe(true);
    }

    const rows210 = await listInvoices(revA.page.request, { roomId: room210 });
    const marRent = pickInvoice(rows210, 'PRIVATE_RENT', '2027-03-01');
    expect((await probeRentReviewers(marRent.id)).sort()).toEqual([revA.userId, revC.userId].sort());
    const payee210 = await probePayee(`E2E-${runId}-210`, 'OWNER');
    expect(payee210.payee?.accountNumber).toBe('210-0-00001-9');
    expect(typeof payee210.payee?.qrImageId).toBe('string');
  });

  test('golden-4: common-fee config to job to slip to approve to paid locks the invoice', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const room212 = ctx.room212 ?? '';
    const revA = ctx.revA?.page ?? page;

    const strangerRows = await listInvoices(ctx.stranger?.page.request ?? page.request, { roomId: room212 });
    expect(strangerRows.filter((row) => row.periodStart === '2026-12-01')).toHaveLength(0);

    const payerRows = await listInvoices(revA.request, { roomId: room212 });
    const fee = pickInvoice(payerRows, 'COMMON_FEE', '2026-12-01');
    expect(fee.state).toBe('UNPAID');
    expect(fee.version).toBe(1);
    expect(fee.outstanding.amount).toBe(fee.total.amount);
    expect(fee.overdue).toBe(expectedOverdue(fee.outstanding.amount, fee.dueDate));
    expect(fee.pendingOnPaid).toBe(false);

    const adminRows = await listInvoices(page.request, { roomId: room212 });
    const adminFee = pickInvoice(adminRows, 'COMMON_FEE', '2026-12-01');
    expect(adminFee.id).toBe(fee.id);

    const firstSlip = await mintReadySlip(revA.request, 'golden-first.png');
    const first = await postSubmission(revA.request, fee.id, { imageId: firstSlip });
    expect(first.status).toBe(200);
    const firstId = (first.json as PaymentSubmitEnvelope).data.id;

    const partial = await postApprove(page.request, firstId, { amount: { amount: '1000.00', currency: 'THB' } });
    expect(partial.status).toBe(200);
    const partialBody = partial.json as PaymentReviewEnvelope;
    expect(partialBody.data.invoiceState).toBe('PARTIALLY_PAID');
    expect(partialBody.data.outstanding.amount).toBe('2000.00');
    expect(partialBody.data.overdue).toBe(expectedOverdue('2000.00', fee.dueDate));

    const secondSlip = await mintReadySlip(revA.request, 'golden-second.png');
    const second = await postSubmission(revA.request, fee.id, { imageId: secondSlip });
    expect(second.status).toBe(200);
    const secondId = (second.json as PaymentSubmitEnvelope).data.id;
    const final = await postApprove(page.request, secondId, { amount: { amount: '2000.00', currency: 'THB' } });
    expect(final.status).toBe(200);
    expect((final.json as PaymentReviewEnvelope).data.invoiceState).toBe('PAID');
    expect((final.json as PaymentReviewEnvelope).data.outstanding.amount).toBe('0.00');

    const locked = await patchInvoice(page.request, fee.id, {
      total: { amount: '3100.00', currency: 'THB' },
      expectedVersion: 1,
    });
    expect(locked.status).toBe(403);
    expect((locked.json as ErrorEnvelope).error.code).toBe('ACCESS_DENIED');

    const thirdSlip = await mintReadySlip(revA.request, 'golden-third.png');
    const denied = await postSubmission(revA.request, fee.id, { imageId: thirdSlip });
    expect(denied.status).toBe(403);
    expect((denied.json as ErrorEnvelope).error.code).toBe('ACCESS_DENIED');

    const detail = await getInvoice(revA.request, fee.id);
    expect(detail.state).toBe('PAID');
    expect(detail.approvedTotal.amount).toBe('3000.00');
    expect(detail.pendingOnPaid).toBe(false);

    const probed = await probePayments(fee.id);
    expect(probed.submissions.filter((entry) => entry.state === 'APPROVED')).toHaveLength(2);
    expect(probed.balance).toEqual({ approvedTotal: '300000', pendingCount: 0 });
  });

  test('ms-bill-01: a and c approve the same pending slip exactly once', async ({ page }) => {
    await loginAsAdmin(page);
    const room210 = ctx.room210 ?? '';
    const revA = ctx.revA?.page ?? page;
    const revC = ctx.revC?.page ?? page;

    const rows = await listInvoices(revA.request, { roomId: room210 });
    const rent = pickInvoice(rows, 'PRIVATE_RENT', '2027-03-01');
    expect(rent.total.amount).toBe('10000.00');

    const slip = await mintReadySlip(revC.request, 'race-slip.png');
    const submitted = await postSubmission(revC.request, rent.id, { imageId: slip });
    expect(submitted.status).toBe(200);
    const submissionId = (submitted.json as PaymentSubmitEnvelope).data.id;

    const before = await probePayments(rent.id);
    expect(before.balance).toEqual({ approvedTotal: '0', pendingCount: 1 });

    const raceA = postApprove(revA.request, submissionId, { amount: { amount: '4000.00', currency: 'THB' } });
    const raceC = postApprove(revC.request, submissionId, { amount: { amount: '4000.00', currency: 'THB' } });
    const [resultA, resultC] = await Promise.all([raceA, raceC]);
    const statuses = [resultA.status, resultC.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = resultA.status === 409 ? resultA : resultC;
    expect((loser.json as ErrorEnvelope).error.code).toBe('PAYMENT_ALREADY_REVIEWED');

    const after = await probePayments(rent.id);
    expect(after.balance).toEqual({ approvedTotal: '400000', pendingCount: 0 });
    expect(after.submissions.filter((entry) => entry.state === 'APPROVED')).toHaveLength(1);

    const detail = await getInvoice(revA.request, rent.id);
    expect(detail.state).toBe('PARTIALLY_PAID');
    expect(detail.outstanding.amount).toBe('6000.00');
  });

  test('ms-bill-02: reviewer edits the total with a pending slip preserved', async ({ page }) => {
    await loginAsAdmin(page);
    const room210 = ctx.room210 ?? '';
    const revA = ctx.revA?.page ?? page;
    const revC = ctx.revC?.page ?? page;

    const rows = await listInvoices(revA.request, { roomId: room210 });
    const rent = pickInvoice(rows, 'PRIVATE_RENT', '2027-03-01');
    expect(rent.total.amount).toBe('10000.00');

    const slip = await mintReadySlip(revA.request, 'edit-slip.png');
    const submitted = await postSubmission(revA.request, rent.id, { imageId: slip });
    expect(submitted.status).toBe(200);
    const submissionId = (submitted.json as PaymentSubmitEnvelope).data.id;

    const edited = await patchInvoice(revC.request, rent.id, {
      total: { amount: '12000.00', currency: 'THB' },
      expectedVersion: rent.version,
      reason: 'Correct March rent to the agreed amount.',
    });
    expect(edited.status).toBe(200);
    const editedBody = edited.json as InvoiceEditEnvelope;
    expect(editedBody.data.total.amount).toBe('12000.00');
    expect(editedBody.data.version).toBe(rent.version + 1);
    expect(editedBody.data.approvedTotal.amount).toBe('4000.00');
    expect(editedBody.data.outstanding.amount).toBe('8000.00');
    expect(editedBody.data.state).toBe('PARTIALLY_PAID');

    const pending = await probePayments(rent.id);
    expect(pending.balance).toEqual({ approvedTotal: '400000', pendingCount: 1 });
    expect(pending.revisions).toHaveLength(1);
    expect(pending.revisions[0]).toMatchObject({ oldTotal: '1000000', newTotal: '1200000' });

    const approved = await postApprove(revA.request, submissionId, { amount: { amount: '8000.00', currency: 'THB' } });
    expect(approved.status).toBe(200);
    expect((approved.json as PaymentReviewEnvelope).data.invoiceState).toBe('PAID');

    const detail = await getInvoice(revA.request, rent.id);
    expect(detail.state).toBe('PAID');
    expect(detail.total.amount).toBe('12000.00');
  });

  test('ms-bill-04: transfer mid-debt conceals old invoices from the buyer only', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const room210 = ctx.room210 ?? '';
    const revA = ctx.revA?.page ?? page;
    const revC = ctx.revC?.page ?? page;
    const buyerC = ctx.buyerC?.page ?? page;

    await backdatedTransfer(page, {
      roomId: room210,
      fromUserId: ctx.revA?.userId ?? '',
      toUserId: ctx.buyerC?.userId ?? '',
      effectiveAt: '2026-10-10T00:00:00.000Z',
    });

    const rowsA = await listInvoices(revA.request, { roomId: room210 });
    const marRent = pickInvoice(rowsA, 'PRIVATE_RENT', '2027-03-01');
    const decRent = pickInvoice(rowsA, 'PRIVATE_RENT', '2026-12-01');
    expect(decRent.state).toBe('UNPAID');
    const rowsBuyer = await listInvoices(buyerC.request, { roomId: room210 });
    expect(rowsBuyer.filter((row) => row.periodStart === '2027-03-01')).toHaveLength(0);

    const concealedDetail = await apiJson<ErrorEnvelope>(buyerC.request, {
      method: 'GET',
      path: `/api/invoices/${marRent.id}`,
    });
    expect(concealedDetail.status).toBe(404);
    expect(concealedDetail.json.error.code).toBe('RESOURCE_NOT_FOUND');

    const concealedSubmit = await postSubmission(buyerC.request, marRent.id, { imageId: randomUUID() });
    expect(concealedSubmit.status).toBe(404);
    expect((concealedSubmit.json as ErrorEnvelope).error.code).toBe('RESOURCE_NOT_FOUND');

    const concealedEdit = await patchInvoice(buyerC.request, marRent.id, {
      total: { amount: '9000.00', currency: 'THB' },
      expectedVersion: 1,
    });
    expect(concealedEdit.status).toBe(404);

    const concealedPayments = await getPayments(buyerC.request, marRent.id);
    expect(concealedPayments.status).toBe(404);

    const submissions = await getPayments(revA.request, marRent.id);
    expect(submissions.status).toBe(200);
    const approved = (submissions.json as PaymentSubmissionsEnvelope).data.submissions.find(
      (entry) => entry.state === 'APPROVED',
    );
    if (approved === undefined) throw new Error('March rent has no approved submission.');
    const slipConcealed = await readAccess(buyerC.request, approved.imageId);
    expect(slipConcealed.status).toBe(403);

    const decSlip = await mintReadySlip(revA.request, 'former-dec-slip.png');
    const decSubmitted = await postSubmission(revA.request, decRent.id, { imageId: decSlip });
    expect(decSubmitted.status).toBe(200);
    const decEdited = await patchInvoice(revA.request, decRent.id, {
      total: { amount: '10000.00', currency: 'THB' },
      expectedVersion: decRent.version,
      reason: 'Former reviewer confirms the amount.',
    });
    expect(decEdited.status).toBe(200);
    const decApproved = await postApprove(revC.request, (decSubmitted.json as PaymentSubmitEnvelope).data.id, {
      amount: { amount: '10000.00', currency: 'THB' } },
    );
    expect(decApproved.status).toBe(200);
    expect((decApproved.json as PaymentReviewEnvelope).data.invoiceState).toBe('PAID');
    const decLocked = await patchInvoice(revA.request, decRent.id, {
      total: { amount: '10000.00', currency: 'THB' },
      expectedVersion: (decEdited.json as InvoiceEditEnvelope).data.version,
    });
    expect(decLocked.status).toBe(404);

    const april = await triggerGenerate(page.request, { triggerSource: 'MANUAL', fromCycle: '2027-04' });
    expect(april.json.data.caughtUp).toBe(true);

    const aprBuyer = (await listInvoices(buyerC.request, { roomId: room210 })).filter(
      (row) => row.periodStart === '2027-04-01' && row.kind === 'PRIVATE_RENT',
    );
    expect(aprBuyer).toHaveLength(1);
    expect(aprBuyer[0]?.total.amount).toBe('10000.00');
    const aprA = (await listInvoices(revA.request, { roomId: room210 })).filter(
      (row) => row.periodStart === '2027-04-01' && row.kind === 'PRIVATE_RENT',
    );
    expect(aprA).toHaveLength(0);
    const aprC = (await listInvoices(revC.request, { roomId: room210 })).filter(
      (row) => row.periodStart === '2027-04-01' && row.kind === 'PRIVATE_RENT',
    );
    expect(aprC).toHaveLength(1);
    expect((await probeRentReviewers(aprBuyer[0]?.id ?? '')).sort()).toEqual(
      [ctx.revC?.userId ?? '', ctx.buyerC?.userId ?? ''].sort(),
    );

    const buyerSlip = await mintReadySlip(buyerC.request, 'buyer-apr-slip.png');
    const buyerSubmitted = await postSubmission(buyerC.request, aprBuyer[0]?.id ?? '', { imageId: buyerSlip });
    expect(buyerSubmitted.status).toBe(200);
    const buyerSubmissionId = (buyerSubmitted.json as PaymentSubmitEnvelope).data.id;
    const buyerApproved = await postApprove(revC.request, buyerSubmissionId, {
      amount: { amount: '10000.00', currency: 'THB' },
    });
    expect(buyerApproved.status).toBe(200);
    expect((buyerApproved.json as PaymentReviewEnvelope).data.invoiceState).toBe('PAID');

    const marNow = await getInvoice(revA.request, marRent.id);
    expect(marNow.state).toBe('PAID');
    const marBuyerFinal = await apiJson<ErrorEnvelope>(buyerC.request, {
      method: 'GET',
      path: `/api/invoices/${marRent.id}`,
    });
    expect(marBuyerFinal.status).toBe(404);

    const buyerMay = await triggerGenerate(page.request, { triggerSource: 'MANUAL', fromCycle: '2027-05' });
    expect(buyerMay.json.data.caughtUp).toBe(true);
  });

  test('ms-bill-07: common-fee turnover keeps old slips payable and new bills separate', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const room210 = ctx.room210 ?? '';
    const revA = ctx.revA?.page ?? page;
    const revC = ctx.revC?.page ?? page;
    const buyerC = ctx.buyerC?.page ?? page;

    const rowsA = await listInvoices(revA.request, { roomId: room210 });
    const marFee = pickInvoice(rowsA, 'COMMON_FEE', '2027-03-01');
    expect(marFee.state).toBe('UNPAID');

    const buyerRows = await listInvoices(buyerC.request, { roomId: room210 });
    expect(buyerRows.filter((row) => row.periodStart === '2027-03-01' && row.kind === 'COMMON_FEE')).toHaveLength(0);
    const concealed = await apiJson<ErrorEnvelope>(buyerC.request, {
      method: 'GET',
      path: `/api/invoices/${marFee.id}`,
    });
    expect(concealed.status).toBe(404);

    const slip = await mintReadySlip(revA.request, 'old-fee-slip.png');
    const submitted = await postSubmission(revA.request, marFee.id, { imageId: slip });
    expect(submitted.status).toBe(200);
    const approved = await postApprove(page.request, (submitted.json as PaymentSubmitEnvelope).data.id, {
      amount: { amount: '3000.00', currency: 'THB' },
    });
    expect(approved.status).toBe(200);
    expect((approved.json as PaymentReviewEnvelope).data.invoiceState).toBe('PAID');

    const history = await getInvoice(revA.request, marFee.id);
    expect(history.state).toBe('PAID');

    const buyerNew = (await listInvoices(buyerC.request, { roomId: room210 })).filter(
      (row) => row.periodStart === '2027-04-01' && row.kind === 'COMMON_FEE',
    );
    expect(buyerNew).toHaveLength(1);
    const buyerSlip = await mintReadySlip(buyerC.request, 'new-fee-slip.png');
    const buyerSubmitted = await postSubmission(buyerC.request, buyerNew[0]?.id ?? '', { imageId: buyerSlip });
    expect(buyerSubmitted.status).toBe(200);
    const buyerApproved = await postApprove(page.request, (buyerSubmitted.json as PaymentSubmitEnvelope).data.id, {
      amount: { amount: '3000.00', currency: 'THB' } },
    );
    expect(buyerApproved.status).toBe(200);
    expect((buyerApproved.json as PaymentReviewEnvelope).data.invoiceState).toBe('PAID');

    const oldVisibleToC = (await listInvoices(revC.request, { roomId: room210 })).some(
      (row) => row.id === marFee.id,
    );
    expect(oldVisibleToC).toBe(true);
  });

  test('ms-bill-05: d04-a tenant overlap windows gate list detail submit and history', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const room211 = ctx.room211 ?? '';
    const room213 = ctx.room213 ?? '';
    const tenantA = ctx.tenantA?.page ?? page;
    const tenantB = ctx.tenantB?.page ?? page;
    const revA = ctx.revA?.page ?? page;

    const rowsA = await listInvoices(tenantA.request, { roomId: room211 });
    const janRent = pickInvoice(rowsA, 'PRIVATE_RENT', '2027-01-01');
    const febRent = pickInvoice(rowsA, 'PRIVATE_RENT', '2027-02-01');
    const marRent = pickInvoice(rowsA, 'PRIVATE_RENT', '2027-03-01');
    const aprRent = pickInvoice(rowsA, 'PRIVATE_RENT', '2027-04-01');
    expect(aprRent.total.amount).toBe('12000.00');

    const rowsB = await listInvoices(tenantB.request, { roomId: room211 });
    expect(rowsB.some((row) => row.id === aprRent.id)).toBe(true);
    expect(rowsB.some((row) => row.id === janRent.id)).toBe(false);
    expect(rowsB.some((row) => row.id === febRent.id)).toBe(false);
    expect(rowsB.some((row) => row.id === marRent.id)).toBe(false);
    for (const deniedId of [janRent.id, febRent.id, marRent.id]) {
      const direct = await apiJson<ErrorEnvelope>(tenantB.request, {
        method: 'GET',
        path: `/api/invoices/${deniedId}`,
      });
      expect(direct.status).toBe(404);
      expect(direct.json.error.code).toBe('RESOURCE_NOT_FOUND');
    }
    const aprDetail = await getInvoice(tenantB.request, aprRent.id);
    expect(aprDetail.roomId).toBe(room211);

    const bSlip = await mintReadySlip(tenantB.request, 'tenant-apr-slip.png');
    const bSubmitted = await postSubmission(tenantB.request, aprRent.id, { imageId: bSlip });
    expect(bSubmitted.status).toBe(200);
    const bApproved = await postApprove(revA.request, (bSubmitted.json as PaymentSubmitEnvelope).data.id, {
      amount: { amount: '12000.00', currency: 'THB' } },
    );
    expect(bApproved.status).toBe(200);
    expect((bApproved.json as PaymentReviewEnvelope).data.invoiceState).toBe('PAID');

    const tenantEdit = await patchInvoice(tenantB.request, aprRent.id, {
      total: { amount: '12000.00', currency: 'THB' },
      expectedVersion: 1,
    });
    expect(tenantEdit.status).toBe(404);
    const submitOld = await postSubmission(tenantB.request, marRent.id, { imageId: randomUUID() });
    expect(submitOld.status).toBe(404);

    const july = await triggerGenerate(page.request, { triggerSource: 'MANUAL', fromCycle: '2027-07' });
    expect(july.json.data.caughtUp).toBe(true);
    const rowsBAfter = await listInvoices(tenantB.request, { roomId: room211 });
    expect(rowsBAfter.filter((row) => row.periodStart === '2027-07-01')).toHaveLength(0);
    const rowsAAfter = await listInvoices(tenantA.request, { roomId: room211 });
    const julRent = pickInvoice(rowsAAfter, 'PRIVATE_RENT', '2027-07-01');
    const julDirect = await apiJson<ErrorEnvelope>(tenantB.request, {
      method: 'GET',
      path: `/api/invoices/${julRent.id}`,
    });
    expect(julDirect.status).toBe(404);

    const junRows = await listInvoices(tenantA.request, { roomId: room211 });
    const junRent = pickInvoice(junRows, 'PRIVATE_RENT', '2027-06-01');
    const junVisible = await getInvoice(tenantB.request, junRent.id);
    expect(junVisible.periodStart).toBe('2027-06-01');
    const junSlip = await mintReadySlip(tenantB.request, 'tenant-jun-slip.png');
    const junSubmitted = await postSubmission(tenantB.request, junRent.id, { imageId: junSlip });
    expect(junSubmitted.status).toBe(200);

    const rows213B = await listInvoices(tenantB.request, { roomId: room213 });
    expect(rows213B).toHaveLength(0);
    const admin213 = await listInvoices(page.request, { roomId: room213 });
    const pmRent = pickInvoice(admin213, 'PROJECT_MANAGED_RENT', '2027-04-01');
    const crossTenancy = await apiJson<ErrorEnvelope>(tenantB.request, {
      method: 'GET',
      path: `/api/invoices/${pmRent.id}`,
    });
    expect(crossTenancy.status).toBe(404);
    const crossSubmit = await postSubmission(tenantB.request, pmRent.id, { imageId: randomUUID() });
    expect(crossSubmit.status).toBe(404);
  });

  test('ms-bill-06: admin mixed-kind lists deny private rent before any aggregate', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const room210 = ctx.room210 ?? '';
    const room213 = ctx.room213 ?? '';

    const mixed = await listInvoices(page.request, { pageSize: 100 });
    expect(mixed.some((row) => row.kind === 'PRIVATE_RENT')).toBe(false);
    expect(mixed.some((row) => row.kind === 'PROJECT_MANAGED_RENT')).toBe(true);
    expect(mixed.some((row) => row.kind === 'COMMON_FEE')).toBe(true);

    const revA = ctx.revA?.page ?? page;
    const privateRow = pickInvoice(
      await listInvoices(revA.request, { roomId: room210 }),
      'PRIVATE_RENT',
      '2026-12-01',
    );
    const adminDirect = await apiJson<ErrorEnvelope>(page.request, {
      method: 'GET',
      path: `/api/invoices/${privateRow.id}`,
    });
    expect(adminDirect.status).toBe(404);
    expect(adminDirect.json.error.code).toBe('RESOURCE_NOT_FOUND');

    const adminKind = await apiJson<ErrorEnvelope>(page.request, {
      method: 'GET',
      path: '/api/invoices?kind=PRIVATE_RENT',
    });
    expect(adminKind.status).toBe(404);
    expect(adminKind.json.error.code).toBe('RESOURCE_NOT_FOUND');

    const adminEdit = await patchInvoice(page.request, privateRow.id, {
      total: { amount: '10000.00', currency: 'THB' },
      expectedVersion: 1,
    });
    expect(adminEdit.status).toBe(404);
    const adminSubmit = await postSubmission(page.request, privateRow.id, { imageId: randomUUID() });
    expect(adminSubmit.status).toBe(403);
    expect((adminSubmit.json as ErrorEnvelope).error.code).toBe('ACCESS_DENIED');
    const adminPayments = await getPayments(page.request, privateRow.id);
    expect(adminPayments.status).toBe(404);

    const unpaidRow = pickInvoice(
      await listInvoices(revA.request, { roomId: ctx.room211 ?? '' }),
      'PRIVATE_RENT',
      '2026-12-01',
    );
    expect(unpaidRow.state).toBe('UNPAID');
    const slip = await mintReadySlip(revA.request, 'admin-deny-slip.png');
    const submitted = await postSubmission(revA.request, unpaidRow.id, { imageId: slip });
    expect(submitted.status).toBe(200);
    const submissionId = (submitted.json as PaymentSubmitEnvelope).data.id;
    const adminApprove = await postApprove(page.request, submissionId, {
      amount: { amount: '1000.00', currency: 'THB' } },
    );
    expect(adminApprove.status).toBe(404);
    const adminReject = await postReject(page.request, submissionId, { reason: 'Admin must not review.' });
    expect(adminReject.status).toBe(404);
    const adminSlip = await readAccess(page.request, slip);
    expect(adminSlip.status).toBe(403);

    const pmRows = await listInvoices(page.request, { roomId: room213 });
    const pmRent = pickInvoice(pmRows, 'PROJECT_MANAGED_RENT', '2026-12-01');
    expect(pmRent.total.amount).toBe('8000.00');
    const pmFee = pickInvoice(pmRows, 'COMMON_FEE', '2026-12-01');
    expect(pmFee.total.amount).toBe('2500.00');
  });

  test('state-walk: 300-200-500 partials walk unpaid to paid with each guard firing', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const room211 = ctx.room211 ?? '';
    const revA = ctx.revA?.page ?? page;
    const tenantA = ctx.tenantA?.page ?? page;

    const rows = await listInvoices(revA.request, { roomId: room211 });
    const rent = pickInvoice(rows, 'PRIVATE_RENT', '2027-05-01');
    expect(rent.state).toBe('UNPAID');

    const slipA = await mintReadySlip(tenantA.request, 'walk-first.png');
    const first = await postSubmission(tenantA.request, rent.id, { imageId: slipA });
    expect(first.status).toBe(200);
    const firstId = (first.json as PaymentSubmitEnvelope).data.id;

    const zero = await postApprove(revA.request, firstId, { amount: { amount: '0.00', currency: 'THB' } });
    expect(zero.status).toBe(400);
    expect((zero.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

    const over = await postApprove(revA.request, firstId, {
      amount: { amount: '12000.01', currency: 'THB' } },
    );
    expect(over.status).toBe(409);
    expect((over.json as ErrorEnvelope).error.code).toBe('PAYMENT_APPROVED_AMOUNT_EXCEEDS_OUTSTANDING');

    const part1 = await postApprove(revA.request, firstId, { amount: { amount: '300.00', currency: 'THB' } });
    expect(part1.status).toBe(200);
    expect((part1.json as PaymentReviewEnvelope).data.invoiceState).toBe('PARTIALLY_PAID');
    expect((part1.json as PaymentReviewEnvelope).data.outstanding.amount).toBe('11700.00');

    const reapprove = await postApprove(revA.request, firstId, { amount: { amount: '1.00', currency: 'THB' } });
    expect(reapprove.status).toBe(409);
    expect((reapprove.json as ErrorEnvelope).error.code).toBe('PAYMENT_ALREADY_REVIEWED');

    const slipB = await mintReadySlip(tenantA.request, 'walk-second.png');
    const second = await postSubmission(tenantA.request, rent.id, { imageId: slipB });
    expect(second.status).toBe(200);
    const secondId = (second.json as PaymentSubmitEnvelope).data.id;
    const blankReject = await postReject(revA.request, secondId, { reason: '   ' });
    expect(blankReject.status).toBe(400);
    expect((blankReject.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');
    const part2 = await postApprove(revA.request, secondId, { amount: { amount: '200.00', currency: 'THB' } });
    expect(part2.status).toBe(200);
    expect((part2.json as PaymentReviewEnvelope).data.outstanding.amount).toBe('11500.00');

    const slipC = await mintReadySlip(tenantA.request, 'walk-third.png');
    const third = await postSubmission(tenantA.request, rent.id, { imageId: slipC });
    expect(third.status).toBe(200);
    const rejected = await postReject(revA.request, (third.json as PaymentSubmitEnvelope).data.id, {
      reason: 'The slip is unreadable.',
    });
    expect(rejected.status).toBe(200);
    expect((rejected.json as PaymentReviewEnvelope).data.state).toBe('REJECTED');
    expect((rejected.json as PaymentReviewEnvelope).data.invoiceState).toBe('PARTIALLY_PAID');

    const doubleReject = await postReject(revA.request, (third.json as PaymentSubmitEnvelope).data.id, {
      reason: 'Second attempt.',
    });
    expect(doubleReject.status).toBe(409);
    expect((doubleReject.json as ErrorEnvelope).error.code).toBe('PAYMENT_ALREADY_REVIEWED');

    const slipD = await mintReadySlip(tenantA.request, 'walk-final.png');
    const fourth = await postSubmission(tenantA.request, rent.id, { imageId: slipD });
    expect(fourth.status).toBe(200);
    const paid = await postApprove(revA.request, (fourth.json as PaymentSubmitEnvelope).data.id, {
      amount: { amount: '11500.00', currency: 'THB' } },
    );
    expect(paid.status).toBe(200);
    expect((paid.json as PaymentReviewEnvelope).data.invoiceState).toBe('PAID');

    const probed = await probePayments(rent.id);
    expect(probed.balance).toEqual({ approvedTotal: '1200000', pendingCount: 0 });
    expect(probed.submissions).toHaveLength(4);
    expect(probed.submissions.filter((entry) => entry.state === 'APPROVED')).toHaveLength(3);
    expect(probed.submissions.filter((entry) => entry.state === 'REJECTED')).toHaveLength(1);
    for (const entry of probed.submissions) {
      expect(entry.reviewedBy).toBe(ctx.revA?.userId ?? '');
    }
  });

  test('edit-matrix: floors, paid lock, stale version, and per-kind permissions', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const room211 = ctx.room211 ?? '';
    const room213 = ctx.room213 ?? '';
    const revA = ctx.revA?.page ?? page;
    const tenantA = ctx.tenantA?.page ?? page;

    const rows = await listInvoices(revA.request, { roomId: room211 });
    const rent = pickInvoice(rows, 'PRIVATE_RENT', '2027-03-01');
    expect(rent.state).toBe('UNPAID');

    const slip = await mintReadySlip(tenantA.request, 'matrix-slip.png');
    const submitted = await postSubmission(tenantA.request, rent.id, { imageId: slip });
    expect(submitted.status).toBe(200);
    const approved = await postApprove(revA.request, (submitted.json as PaymentSubmitEnvelope).data.id, {
      amount: { amount: '700.00', currency: 'THB' } },
    );
    expect(approved.status).toBe(200);

    const belowFloor = await patchInvoice(revA.request, rent.id, {
      total: { amount: '600.00', currency: 'THB' },
      expectedVersion: rent.version,
    });
    expect(belowFloor.status).toBe(400);
    expect((belowFloor.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

    const toExact = await patchInvoice(revA.request, rent.id, {
      total: { amount: '700.00', currency: 'THB' },
      expectedVersion: rent.version,
      reason: 'Settle at the approved amount.',
    });
    expect(toExact.status).toBe(200);
    expect((toExact.json as InvoiceEditEnvelope).data.state).toBe('PAID');

    const paidEdit = await patchInvoice(revA.request, rent.id, {
      total: { amount: '800.00', currency: 'THB' },
      expectedVersion: (toExact.json as InvoiceEditEnvelope).data.version,
    });
    expect(paidEdit.status).toBe(404);
    expect((paidEdit.json as ErrorEnvelope).error.code).toBe('RESOURCE_NOT_FOUND');

    const stale = await patchInvoice(revA.request, rent.id, {
      total: { amount: '750.00', currency: 'THB' },
      expectedVersion: rent.version,
    });
    expect(stale.status).toBe(409);
    expect((stale.json as ErrorEnvelope).error.code).toBe('VERSION_CONFLICT');

    const fresh = pickInvoice(
      await listInvoices(revA.request, { roomId: room211 }),
      'PRIVATE_RENT',
      '2027-07-01',
    );
    const tenantEdit = await patchInvoice(tenantA.request, fresh.id, {
      total: { amount: '12000.00', currency: 'THB' },
      expectedVersion: fresh.version,
    });
    expect(tenantEdit.status).toBe(404);

    const feeRow = pickInvoice(
      await listInvoices(revA.request, { roomId: room211 }),
      'COMMON_FEE',
      '2027-07-01',
    );
    const ownerFeeEdit = await patchInvoice(revA.request, feeRow.id, {
      total: { amount: '3000.00', currency: 'THB' },
      expectedVersion: feeRow.version,
    });
    expect(ownerFeeEdit.status).toBe(403);
    expect((ownerFeeEdit.json as ErrorEnvelope).error.code).toBe('ACCESS_DENIED');

    const admin213 = await listInvoices(page.request, { roomId: room213 });
    const pmRent = pickInvoice(admin213, 'PROJECT_MANAGED_RENT', '2027-07-01');
    const adminEdit = await patchInvoice(page.request, pmRent.id, {
      total: { amount: '8200.00', currency: 'THB' },
      expectedVersion: pmRent.version,
      reason: 'July adjustment.',
    });
    expect(adminEdit.status).toBe(200);
    expect((adminEdit.json as InvoiceEditEnvelope).data.total.amount).toBe('8200.00');

    const probed = await probePayments(rent.id);
    expect(probed.revisions).toHaveLength(1);
    expect(probed.revisions[0]).toMatchObject({ oldTotal: '1200000', newTotal: '70000' });
    const audit = await probeAudit(rent.id);
    expect(audit.entries.some((entry) => entry.action === 'invoice.total.edited')).toBe(true);
  });

  test('pending-on-paid: edit to the approved sum flags the queue reject-only', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const room211 = ctx.room211 ?? '';
    const revA = ctx.revA?.page ?? page;
    const tenantA = ctx.tenantA?.page ?? page;

    const rows = await listInvoices(revA.request, { roomId: room211 });
    const rent = pickInvoice(rows, 'PRIVATE_RENT', '2027-02-01');
    expect(rent.state).toBe('UNPAID');

    const slipA = await mintReadySlip(tenantA.request, 'pop-first.png');
    const first = await postSubmission(tenantA.request, rent.id, { imageId: slipA });
    expect(first.status).toBe(200);
    const approvedA = await postApprove(revA.request, (first.json as PaymentSubmitEnvelope).data.id, {
      amount: { amount: '11990.00', currency: 'THB' } },
    );
    expect(approvedA.status).toBe(200);

    const slipB = await mintReadySlip(tenantA.request, 'pop-second.png');
    const second = await postSubmission(tenantA.request, rent.id, { imageId: slipB });
    expect(second.status).toBe(200);
    const pendingId = (second.json as PaymentSubmitEnvelope).data.id;

    const edited = await patchInvoice(revA.request, rent.id, {
      total: { amount: '11990.00', currency: 'THB' },
      expectedVersion: rent.version,
      reason: 'Discount the last ten baht.',
    });
    expect(edited.status).toBe(200);
    expect((edited.json as InvoiceEditEnvelope).data.state).toBe('PAID');
    expect((edited.json as InvoiceEditEnvelope).data.pendingOnPaid).toBe(true);

    const detail = await getInvoice(revA.request, rent.id);
    expect(detail.pendingOnPaid).toBe(true);

    const queue = await getPayments(revA.request, rent.id);
    expect(queue.status).toBe(200);
    const queued = (queue.json as PaymentSubmissionsEnvelope).data.submissions;
    expect(queued.some((entry) => entry.id === pendingId && entry.state === 'PENDING')).toBe(true);

    const refused = await postApprove(revA.request, pendingId, { amount: { amount: '1.00', currency: 'THB' } });
    expect(refused.status).toBe(404);

    const resolved = await postReject(revA.request, pendingId, { reason: 'Invoice already paid.' });
    expect(resolved.status).toBe(200);
    expect((resolved.json as PaymentReviewEnvelope).data.pendingOnPaid).toBe(false);

    const audit = await probeAudit(pendingId);
    expect(audit.entries.some((entry) => entry.action === 'payment_submission.rejected')).toBe(true);

    const lateSlip = await mintReadySlip(tenantA.request, 'pop-late.png');
    const late = await postSubmission(tenantA.request, rent.id, { imageId: lateSlip });
    expect(late.status).toBe(404);

    const probed = await probePayments(rent.id);
    expect(probed.balance).toEqual({ approvedTotal: '1199000', pendingCount: 0 });
    expect(probed.submissions).toHaveLength(2);
  });

  test('submit-negatives: double pending, bad attachments, suspended, and concealed actors', async ({
    page,
    browser,
  }) => {
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const room212 = ctx.room212 ?? '';
    const revA = ctx.revA?.page ?? page;
    const buyerC = ctx.buyerC?.page ?? page;
    const stranger = ctx.stranger?.page ?? page;

    const rows = await listInvoices(revA.request, { roomId: room212 });
    const rent = pickInvoice(rows, 'PRIVATE_RENT', '2026-12-01');
    expect(rent.state).toBe('UNPAID');

    const slipA = await mintReadySlip(revA.request, 'neg-first.png');
    const first = await postSubmission(revA.request, rent.id, { imageId: slipA });
    expect(first.status).toBe(200);

    const slipB = await mintReadySlip(revA.request, 'neg-second.png');
    const double = await postSubmission(revA.request, rent.id, { imageId: slipB });
    expect(double.status).toBe(409);
    expect((double.json as ErrorEnvelope).error.code).toBe('PENDING_PAYMENT_EXISTS');

    const owned = await postApprove(revA.request, (first.json as PaymentSubmitEnvelope).data.id, {
      amount: { amount: '12000.00', currency: 'THB' } },
    );
    expect(owned.status).toBe(200);

    const fresh = pickInvoice(
      await listInvoices(revA.request, { roomId: room212 }),
      'PRIVATE_RENT',
      '2027-03-01',
    );
    const foreignSlip = await mintReadySlip(stranger.request, 'neg-foreign.png');
    const unowned = await postSubmission(revA.request, fresh.id, { imageId: foreignSlip });
    expect(unowned.status).toBe(400);

    const pendingFixture = await buildValidImage('png', 16);
    const pendingIntent = await mintIntent(revA.request, {
      scope: 'PAYMENT_SLIP',
      entityRef: { type: 'owner', id: null },
      contentType: pendingFixture.contentType,
      fileName: 'neg-pending.png',
    });
    expect(pendingIntent.status).toBe(200);
    expect(await putBytes(pendingIntent.json.data.uploadUrl, pendingFixture.contentType, pendingFixture.bytes)).toBeLessThan(300);
    const nonReady = await postSubmission(revA.request, fresh.id, { imageId: pendingIntent.json.data.imageId });
    expect(nonReady.status).toBe(400);
    const pendingCompleted = await completeUpload(revA.request, pendingIntent.json.data.imageId);
    expect(pendingCompleted.status).toBe(200);

    const reused = await postSubmission(revA.request, fresh.id, { imageId: slipA });
    expect(reused.status).toBe(400);

    const probed = await probePayments(fresh.id);
    expect(probed.submissions).toHaveLength(0);

    const concealedBuyer = await postSubmission(buyerC.request, fresh.id, { imageId: randomUUID() });
    expect(concealedBuyer.status).toBe(404);
    const concealedStranger = await postSubmission(stranger.request, fresh.id, { imageId: randomUUID() });
    expect(concealedStranger.status).toBe(404);
    const concealedAdmin = await postSubmission(page.request, fresh.id, { imageId: randomUUID() });
    expect(concealedAdmin.status).toBe(403);
    expect((concealedAdmin.json as ErrorEnvelope).error.code).toBe('ACCESS_DENIED');

    const suspended = await apiJson<ErrorEnvelope>(page.request, {
      method: 'PATCH',
      path: `/api/admin/users/${ctx.stranger?.userId ?? ''}/status`,
      body: { accountStatus: 'SUSPENDED' },
    });
    expect(suspended.status).toBe(200);
    const suspendedContext = await browser.newContext({ baseURL });
    const suspendedPage = await suspendedContext.newPage();
    try {
      const signin = await signInSuspendedActor(suspendedPage.request, {
        username: ctx.stranger?.username ?? '',
        password: ctx.stranger?.password ?? '',
      });
      expect(signin.status).toBe(200);
      const denied = await postSubmission(suspendedPage.request, fresh.id, { imageId: randomUUID() });
      expect(denied.status).toBe(403);
      expect((denied.json as ErrorEnvelope).error.code).toBe('ACCESS_DENIED');
    } finally {
      await suspendedContext.close();
    }
  });

  test('idempotency: replay returns the identical review and mixed bodies are rejected', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const room212 = ctx.room212 ?? '';
    const revA = ctx.revA?.page ?? page;

    const rows = await listInvoices(revA.request, { roomId: room212 });
    const rent = pickInvoice(rows, 'PRIVATE_RENT', '2027-04-01');

    const slipA = await mintReadySlip(revA.request, 'idem-first.png');
    const first = await postSubmission(revA.request, rent.id, { imageId: slipA });
    expect(first.status).toBe(200);
    const firstId = (first.json as PaymentSubmitEnvelope).data.id;

    const key = randomUUID();
    const approved = await postApprove(revA.request, firstId, { amount: { amount: '5000.00', currency: 'THB' } }, key);
    expect(approved.status).toBe(200);
    const replayed = await postApprove(revA.request, firstId, { amount: { amount: '5000.00', currency: 'THB' } }, key);
    expect(replayed.status).toBe(200);
    expect(replayed.json).toEqual(approved.json);

    const conflicted = await postApprove(revA.request, firstId, { amount: { amount: '5001.00', currency: 'THB' } }, key);
    expect(conflicted.status).toBe(400);
    expect((conflicted.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

    const slipB = await mintReadySlip(revA.request, 'idem-second.png');
    const second = await postSubmission(revA.request, rent.id, { imageId: slipB });
    expect(second.status).toBe(200);
    const secondId = (second.json as PaymentSubmitEnvelope).data.id;
    const rejectKey = randomUUID();
    const rejected = await postReject(revA.request, secondId, { reason: 'Blurry capture.' }, rejectKey);
    expect(rejected.status).toBe(200);
    const rejectReplay = await postReject(revA.request, secondId, { reason: 'Blurry capture.' }, rejectKey);
    expect(rejectReplay.status).toBe(200);
    expect(rejectReplay.json).toEqual(rejected.json);
  });

  test('reads: submissions, revisions, and instruction snapshots stay payer-visible', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room210 = ctx.room210 ?? '';
    const revA = ctx.revA?.page ?? page;
    const buyerC = ctx.buyerC?.page ?? page;

    const rows = await listInvoices(revA.request, { roomId: room210 });
    const rent = pickInvoice(rows, 'PRIVATE_RENT', '2027-03-01');

    const submissions = await getPayments(revA.request, rent.id);
    expect(submissions.status).toBe(200);
    const listed = (submissions.json as PaymentSubmissionsEnvelope).data.submissions;
    expect(listed.length).toBeGreaterThanOrEqual(2);
    expect(listed.every((entry) => entry.invoiceId === rent.id)).toBe(true);

    const revisions = await getPayments(revA.request, rent.id, 'revisions');
    expect(revisions.status).toBe(200);
    const revisionRows = (revisions.json as { data: { revisions: InvoiceRevisionRow[] } }).data.revisions;
    expect(revisionRows).toHaveLength(1);
    expect(revisionRows[0]?.reason).toBe('Correct March rent to the agreed amount.');

    const instruction = await getPayments(revA.request, rent.id, 'instruction');
    expect(instruction.status).toBe(200);
    const snapshot = (instruction.json as PaymentInstructionEnvelope).data.instruction;
    expect(snapshot.accountNumber).toBe('210-0-00001-9');
    expect(typeof snapshot.qrImageId).toBe('string');

    const buyerSubmissions = await getPayments(buyerC.request, rent.id);
    expect(buyerSubmissions.status).toBe(404);
    const buyerRevisions = await getPayments(buyerC.request, rent.id, 'revisions');
    expect(buyerRevisions.status).toBe(404);
    const buyerInstruction = await getPayments(buyerC.request, rent.id, 'instruction');
    expect(buyerInstruction.status).toBe(404);

    const suspendedReads = await getPayments(ctx.stranger?.page.request ?? page.request, rent.id);
    expect(suspendedReads.status).toBe(401);
    expect((suspendedReads.json as ErrorEnvelope).error.code).toBe('AUTH_REQUIRED');

    const payee210 = await probePayee(`E2E-${runId}-210`, 'OWNER');
    expect(payee210.payee?.accountNumber).toBe('210-0-00001-9');
    expect(typeof payee210.payee?.qrImageId).toBe('string');
  });

  test('scope-regression: slip and qr image acl matches the invoice policy', async ({ page }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room212 = ctx.room212 ?? '';
    const revA = ctx.revA?.page ?? page;
    const buyerC = ctx.buyerC?.page ?? page;

    const rows = await listInvoices(revA.request, { roomId: room212 });
    const rent = pickInvoice(rows, 'PRIVATE_RENT', '2027-04-01');
    const submissions = await getPayments(revA.request, rent.id);
    expect(submissions.status).toBe(200);
    const slipId = (submissions.json as PaymentSubmissionsEnvelope).data.submissions[0]?.imageId ?? '';

    const reviewerRead = await readAccess(revA.request, slipId);
    expect(reviewerRead.status).toBe(200);
    expect(reviewerRead.json.data.url).toContain('http');

    const buyerRead = await readAccess(buyerC.request, slipId);
    expect(buyerRead.status).toBe(403);
    const outsiderRead = await readAccess(ctx.tenantA?.page.request ?? page.request, slipId);
    expect(outsiderRead.status).toBe(403);
    const adminRead = await readAccess(page.request, slipId);
    expect(adminRead.status).toBe(403);

    const payee210 = await probePayee(`E2E-${runId}-210`, 'OWNER');
    const qrImageId = payee210.payee?.qrImageId ?? '';
    const qrAdmin = await readAccess(page.request, qrImageId);
    expect(qrAdmin.status).toBe(403);
    const qrReviewer = await readAccess(revA.request, qrImageId);
    expect(qrReviewer.status).toBe(200);
    const qrBuyer = await readAccess(buyerC.request, qrImageId);
    expect(qrBuyer.status).toBe(200);
  });

  test('dto-shape: derived fields ride the list and detail envelopes', async ({ page }) => {
    await loginAsAdmin(page);
    const room212 = ctx.room212 ?? '';
    const revA = ctx.revA?.page ?? page;

    const rows = await listInvoices(revA.request, { roomId: room212 });
    const rent = pickInvoice(rows, 'PRIVATE_RENT', '2027-04-01');
    expect(typeof rent.version).toBe('number');
    expect(['UNPAID', 'PARTIALLY_PAID', 'PAID']).toContain(rent.state);
    expect(rent.approvedTotal).toEqual({ amount: '5000.00', currency: 'THB' });
    expect(rent.outstanding).toEqual({ amount: '7000.00', currency: 'THB' });
    expect(typeof rent.overdue).toBe('boolean');
    expect(typeof rent.pendingOnPaid).toBe('boolean');
    expect(rent.overdue).toBe(expectedOverdue(rent.outstanding.amount, rent.dueDate));

    const detail = await getInvoice(revA.request, rent.id);
    expect(detail.version).toBe(rent.version);
    expect(detail.state).toBe(rent.state);
    expect(detail.approvedTotal).toEqual(rent.approvedTotal);
    expect(detail.outstanding).toEqual(rent.outstanding);
    expect(detail.overdue).toBe(rent.overdue);
    expect(detail.pendingOnPaid).toBe(rent.pendingOnPaid);

    const adminKind = await apiJson<ErrorEnvelope>(page.request, {
      method: 'GET',
      path: '/api/invoices?kind=PRIVATE_RENT',
    });
    expect(adminKind.status).toBe(404);
    expect(adminKind.json.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  test.afterAll(async () => {
    for (const session of [ctx.revA, ctx.revC, ctx.buyerC, ctx.tenantA, ctx.tenantB, ctx.stranger]) {
      await session?.close();
    }
  });
});
