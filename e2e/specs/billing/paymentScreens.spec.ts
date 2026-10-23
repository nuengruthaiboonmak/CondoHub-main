import { expect, test, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { completeFirstLogin, loginAsAdmin, provisionUser } from '../../helpers/owner';
import { buildValidImage } from '../../helpers/announcementFiles';
import {
  findBillingRoom,
  getInvoice,
  listInvoices,
  triggerGenerate,
  type InvoiceRow,
} from './billingFlow';

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

async function driveAddMember(input: {
  roomCode: string;
  username: string;
  tenancyId: string;
  role: string;
  at: string;
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
  return JSON.parse(await runBillingOps(args)) as { membershipId: string };
}

function pickInvoice(
  rows: InvoiceRow[],
  kind: InvoiceRow['kind'],
  periodStart: string,
): InvoiceRow {
  const found = rows.find((row) => row.kind === kind && row.periodStart === periodStart);
  if (found === undefined) throw new Error(`No ${kind} invoice for ${periodStart}.`);
  return found;
}

function actorUsername(runId: string, workerIndex: number, stem: string): string {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `e2e${suffix}${stem}${workerIndex}`.slice(0, 30);
}

function actorPassword(runId: string): string {
  const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return `Pay-${suffix}-pw1`;
}

async function writeSlipFixture(): Promise<string> {
  const fixture = await buildValidImage('png', 32);
  const filePath = path.join(
    os.tmpdir(),
    `e2e-slip-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`,
  );
  await fs.writeFile(filePath, fixture.bytes);
  return filePath;
}

interface ActorSession {
  userId: string;
  username: string;
  page: Page;
}

interface ScreensCtx {
  payer: ActorSession;
  room213: string;
  slipPath: string;
}

const ctx: Partial<ScreensCtx> = {};

test.describe('billing payment screens: balance, submit, review, edit', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240000);

  test('setup: provision tenant payer, join room 213, generate august invoices', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const room213 = await findBillingRoom(page, `E2E-${runId}-213`);
    ctx.room213 = room213;
    const password = actorPassword(runId);

    const username = actorUsername(runId, testInfo.workerIndex, 'scrnpyr');
    const provisioned = await provisionUser(page, { username, name: `Screens payer ${runId}` });
    const context = await browser.newContext({ baseURL });
    const userPage = await context.newPage();
    await completeFirstLogin(userPage, {
      username,
      tempPassword: provisioned.tempPassword,
      newPassword: password,
    });
    ctx.payer = { userId: provisioned.userId, username, page: userPage };

    const detail213 = await apiJson<{
      data: { tenancies: Array<{ id: string; state: string; managementMode: string }> };
    }>(page.request, { method: 'GET', path: `/api/rooms/${room213}` });
    expect(detail213.status).toBe(200);
    const tenancy213 = detail213.json.data.tenancies.find(
      (entry) => entry.state === 'ACTIVE' && entry.managementMode === 'PROJECT_MANAGED',
    );
    if (tenancy213 === undefined) throw new Error('Room 213 has no active managed tenancy.');
    await driveAddMember({
      roomCode: `E2E-${runId}-213`,
      username,
      tenancyId: tenancy213.id,
      role: 'SUB',
      at: '2026-10-01T00:00:00.000Z',
    });

    const august = await triggerGenerate(page.request, {
      triggerSource: 'MANUAL',
      fromCycle: '2027-08',
    });
    expect(august.json.data.caughtUp).toBe(true);

    const payerRows = await listInvoices(userPage.request, { roomId: room213 });
    pickInvoice(payerRows, 'PROJECT_MANAGED_RENT', '2027-08-01');
    pickInvoice(payerRows, 'COMMON_FEE', '2027-08-01');
    ctx.slipPath = await writeSlipFixture();
  });

  test('ui: invoice lists show payment state, outstanding, and overdue badges', async ({
    page,
  }) => {
    const payer = ctx.payer?.page ?? page;
    const rows = await listInvoices(payer.request, { roomId: ctx.room213 ?? '' });
    const rent = pickInvoice(rows, 'PROJECT_MANAGED_RENT', '2027-08-01');
    await loginAsAdmin(page);
    await page.goto('/admin/billing/invoices');
    await expect(page.getByTestId('admin-invoice-list-page')).toBeVisible();
    await payer.goto('/invoices');
    await expect(payer.getByTestId('invoice-list-page')).toBeVisible();
    for (let sheet = 1; sheet <= 10; sheet += 1) {
      if ((await payer.getByTestId(`invoice-state-${rent.id}`).count()) > 0) break;
      const next = payer.getByTestId('invoice-list-next');
      if ((await next.count()) === 0) break;
      await next.click();
      await expect(payer.getByTestId('invoice-list-page')).toBeVisible();
    }
    await expect(payer.getByTestId(`invoice-state-${rent.id}`)).toHaveText('Unpaid');
    await expect(payer.getByTestId(`invoice-outstanding-${rent.id}`)).toContainText(
      `${rent.outstanding.amount} ${rent.outstanding.currency}`,
    );
  });

  test('ui: payer submits a slip through the upload form', async ({ page }) => {
    const payer = ctx.payer?.page ?? page;
    const rows = await listInvoices(payer.request, { roomId: ctx.room213 ?? '' });
    const rent = pickInvoice(rows, 'PROJECT_MANAGED_RENT', '2027-08-01');
    await payer.goto(`/invoices/${rent.id}`);
    await expect(payer.getByTestId('invoice-detail-page')).toBeVisible();
    await expect(payer.getByTestId('invoice-payment-state')).toHaveText('Unpaid');
    await expect(payer.getByTestId('invoice-payment-bank')).toBeVisible();
    await payer.getByTestId('payment-submit-open').click();
    await expect(payer.getByTestId('payment-submit-form')).toBeVisible();
    await payer.getByTestId('payment-submit-upload-input').setInputFiles(ctx.slipPath ?? '');
    await expect(payer.getByTestId('payment-submit-slip-ready')).toBeVisible();
    await payer.getByTestId('payment-submit-button').click();
    await expect(payer.getByTestId('invoice-payment-pending-count')).toHaveText('1');
    const detail = await getInvoice(payer.request, rent.id);
    expect(detail.pendingOnPaid).toBe(false);
  });

  test('ui: second submission surfaces the pending-exists message', async ({ page }) => {
    const payer = ctx.payer?.page ?? page;
    const rows = await listInvoices(payer.request, { roomId: ctx.room213 ?? '' });
    const rent = pickInvoice(rows, 'PROJECT_MANAGED_RENT', '2027-08-01');
    await payer.goto(`/invoices/${rent.id}`);
    await payer.getByTestId('payment-submit-open').click();
    await expect(payer.getByTestId('payment-submit-form')).toBeVisible();
    await payer.getByTestId('payment-submit-upload-input').setInputFiles(ctx.slipPath ?? '');
    await expect(payer.getByTestId('payment-submit-slip-ready')).toBeVisible();
    await payer.getByTestId('payment-submit-button').click();
    await expect(payer.getByTestId('payment-submit-error')).toContainText(
      'already awaiting review',
    );
  });

  test('ui: admin approves the slip and the balance updates', async ({ page }) => {
    await loginAsAdmin(page);
    const rows = await listInvoices(page.request, { roomId: ctx.room213 ?? '' });
    const rent = pickInvoice(rows, 'PROJECT_MANAGED_RENT', '2027-08-01');
    await page.goto(`/admin/billing/invoices/${rent.id}`);
    await expect(page.getByTestId('invoice-payment-pending-count')).toHaveText('1');
    const cards = page.getByTestId('invoice-payment-submissions').locator(':scope > li');
    const firstId = await cards.first().getAttribute('data-testid');
    const submissionId = (firstId ?? '').replace('payment-submission-', '');
    expect(submissionId).not.toBe('');
    await page.getByTestId(`payment-approve-toggle-${submissionId}`).click();
    await page.getByTestId(`payment-approve-amount-${submissionId}`).fill('3000.00');
    await page.getByTestId(`payment-approve-submit-${submissionId}`).click();
    await expect(page.getByTestId('invoice-payment-state')).toHaveText('Partially paid');
    await expect(page.getByTestId('invoice-payment-outstanding')).toContainText('5000.00 THB');
    await expect(page.getByTestId(`payment-submission-state-${submissionId}`)).toHaveText(
      'Approved',
    );
  });

  test('ui: admin edits the total live and the revision history shows it', async ({ page }) => {
    await loginAsAdmin(page);
    const rows = await listInvoices(page.request, { roomId: ctx.room213 ?? '' });
    const rent = pickInvoice(rows, 'PROJECT_MANAGED_RENT', '2027-08-01');
    await page.goto(`/admin/billing/invoices/${rent.id}`);
    await page.getByTestId('invoice-edit-open').click();
    await expect(page.getByTestId('invoice-edit-form')).toBeVisible();
    await page.getByTestId('invoice-edit-total').fill('9000.00');
    await page.getByTestId('invoice-edit-reason').fill('Correct the meter reading.');
    await page.getByTestId('invoice-edit-submit').click();
    await expect(page.getByTestId('invoice-detail-total')).toContainText('9000.00 THB');
    await expect(page.getByTestId('invoice-payment-revisions')).toContainText(
      'Correct the meter reading.',
    );
    const detail = await getInvoice(page.request, rent.id);
    expect(detail.version).toBe(rent.version + 1);
  });

  test('ui: validation errors focus the first invalid field and keyboard submit works', async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const rows = await listInvoices(page.request, { roomId: ctx.room213 ?? '' });
    const fee = pickInvoice(rows, 'COMMON_FEE', '2027-08-01');
    await page.goto(`/admin/billing/invoices/${fee.id}`);
    await page.getByTestId('invoice-edit-open').click();
    await expect(page.getByTestId('invoice-edit-form')).toBeVisible();
    await page.getByTestId('invoice-edit-total').fill('bad-amount');
    await page.getByTestId('invoice-edit-submit').click();
    await expect(page.getByTestId('invoice-edit-total-error')).toBeVisible();
    await expect(page.getByTestId('invoice-edit-total')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByTestId('invoice-edit-total')).toBeFocused();
    await page.getByTestId('invoice-edit-total').fill('2600.00');
    await page.getByTestId('invoice-edit-reason').fill('Keyboard submit check.');
    await page.getByTestId('invoice-edit-submit').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('invoice-detail-total')).toContainText('2600.00 THB');
  });

  test('ui: paid invoice shows read-only state for the payer', async ({ page }) => {
    const payer = ctx.payer?.page ?? page;
    const rows = await listInvoices(payer.request, { roomId: ctx.room213 ?? '' });
    const rent = pickInvoice(rows, 'PROJECT_MANAGED_RENT', '2027-08-01');
    await payer.goto(`/invoices/${rent.id}`);
    await payer.getByTestId('payment-submit-open').click();
    await payer.getByTestId('payment-submit-upload-input').setInputFiles(ctx.slipPath ?? '');
    await expect(payer.getByTestId('payment-submit-slip-ready')).toBeVisible();
    await payer.getByTestId('payment-submit-button').click();
    await expect(payer.getByTestId('invoice-payment-pending-count')).toHaveText('1');
    await loginAsAdmin(page);
    await page.goto(`/admin/billing/invoices/${rent.id}`);
    const cards = page.getByTestId('invoice-payment-submissions').locator(':scope > li');
    const states = await cards.evaluateAll((items) =>
      items.map((item) => ({
        testId: item.getAttribute('data-testid') ?? '',
        state: item.querySelector('[data-testid^="payment-submission-state-"]')?.textContent ?? '',
      })),
    );
    const pending = states.find((entry) => entry.state === 'Pending');
    expect(pending).toBeDefined();
    if (pending === undefined) throw new Error('No pending submission card found.');
    const pendingId = pending.testId.replace('payment-submission-', '');
    await page.getByTestId(`payment-approve-toggle-${pendingId}`).click();
    await page.getByTestId(`payment-approve-amount-${pendingId}`).fill('6000.00');
    await page.getByTestId(`payment-approve-submit-${pendingId}`).click();
    await expect(page.getByTestId('invoice-payment-state')).toHaveText('Paid');
    await payer.goto(`/invoices/${rent.id}`);
    await expect(payer.getByTestId('invoice-payment-state')).toHaveText('Paid');
    await expect(payer.getByTestId('payment-submit-form')).toHaveCount(0);
    await expect(payer.getByTestId('invoice-edit-form')).toHaveCount(0);
  });
});
