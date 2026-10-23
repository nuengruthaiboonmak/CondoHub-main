import { expect, test, type APIRequestContext } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { completeFirstLogin, loginAsAdmin, provisionUser, roomOwnerAt, transferRoomTo } from '../../helpers/owner';
import { provisionResidentWithRetry } from '../../helpers/resident';
import {
  expectRedactedJobPayload,
  findBillingRoom,
  getChargeEvent,
  getInvoice,
  getJobRun,
  invoiceCountKey,
  jobSecret,
  listInvoices,
  listJobRuns,
  listTurnoverReviews,
  postChargeEvent,
  postJobRaw,
  triggerGenerate,
  type ErrorEnvelope,
  type InvoiceRow,
} from './billingFlow';

async function countInvoiceWindow(request: APIRequestContext, roomIds: string[], start: string, end: string): Promise<number> {
  const pages = await Promise.all(roomIds.map((roomId) => listInvoices(request, { roomId })));
  return pages.flat().filter((row) => row.periodStart >= start && row.periodStart <= end).length;
}

test.describe('billing generation: auth, idempotency, backfill, ms-bill-03, pd-04, contention, reads, redaction', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(600000);

  test('job auth: missing and wrong secrets get identical 401s, GET is 405, strict body is 400', async ({
    page,
  }) => {
    await loginAsAdmin(page);

    const missing = await postJobRaw(page.request, { triggerSource: 'MANUAL' });
    expect(missing.status).toBe(401);
    expect((missing.json as ErrorEnvelope).error.code).toBe('AUTH_REQUIRED');

    const wrong = await postJobRaw(
      page.request,
      { triggerSource: 'MANUAL' },
      { 'x-job-secret': 'wrong-secret-value-0000000000000000' },
    );
    expect(wrong.status).toBe(401);
    expect((wrong.json as ErrorEnvelope).error.code).toBe(
      (missing.json as ErrorEnvelope).error.code,
    );

    const get = await page.request.fetch('/api/internal/jobs/generate-invoices', { method: 'GET' });
    expect(get.status()).toBe(405);

    const badSource = await postJobRaw(
      page.request,
      { triggerSource: 'WHENEVER' },
      { 'x-job-secret': jobSecret() },
    );
    expect(badSource.status).toBe(400);
    expect((badSource.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');

    const extraKey = await postJobRaw(
      page.request,
      { triggerSource: 'MANUAL', fromCycle: '2026-07', injected: true },
      { 'x-job-secret': jobSecret() },
    );
    expect(extraKey.status).toBe(400);
    expect((extraKey.json as ErrorEnvelope).error.code).toBe('VALIDATION_ERROR');
  });

  test('bare trigger returns the redacted shape without a cycle window', async ({ page }) => {
    await loginAsAdmin(page);
    const bare = await triggerGenerate(page.request, { triggerSource: 'MANUAL' });
    expectRedactedJobPayload(bare.json.data);
    expect(typeof bare.json.data.caughtUp).toBe('boolean');
    expect(bare.json.data.created).toBeGreaterThanOrEqual(0);
  });

  test('generation is idempotent: created 10 then 0 with skipped 10 and zero dupes', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room201 = await findBillingRoom(page, `E2E-${runId}-201`);
    const room202 = await findBillingRoom(page, `E2E-${runId}-202`);
    const room203 = await findBillingRoom(page, `E2E-${runId}-203`);
    const room204 = await findBillingRoom(page, `E2E-${runId}-204`);
    const room205 = await findBillingRoom(page, `E2E-${runId}-205`);
    const room208 = await findBillingRoom(page, `E2E-${runId}-208`);
    const room209 = await findBillingRoom(page, `E2E-${runId}-209`);

    const first = await triggerGenerate(page.request, {
      triggerSource: 'MANUAL',
      fromCycle: '2026-07',
    });
    expect(first.json.data.created).toBeGreaterThanOrEqual(10);
    expect(await countInvoiceWindow(page.request, [room201, room202, room203, room204, room205, room208, room209], '2026-07-01', '2026-07-31')).toBe(10);
    expect(first.json.data.reviewRequired).toBe(0);
    expect(first.json.data.caughtUp).toBe(true);
    expectRedactedJobPayload(first.json.data);

    const second = await triggerGenerate(page.request, {
      triggerSource: 'MANUAL',
      fromCycle: '2026-07',
    });
    expect(second.json.data.created).toBe(0);
    expect(second.json.data.skipped).toBe(first.json.data.skipped + first.json.data.created);
    expect(second.json.data.reviewRequired).toBe(0);

    const rows201 = (await listInvoices(page.request, { roomId: room201 })).filter(
      (row) => row.periodStart === '2026-07-01',
    );
    expect(rows201).toHaveLength(3);
    const rent201 = rows201.find((row) => row.kind === 'PROJECT_MANAGED_RENT');
    expect(rent201?.total.amount).toBe('8000.00');
    expect(rent201?.dueDate).toBe('2026-07-05');
    expect(typeof rent201?.tenancyId).toBe('string');
    const areaFee = rows201.find(
      (row) => row.kind === 'COMMON_FEE' && row.total.amount === '2485.00',
    );
    expect(areaFee?.dueDate).toBe('2026-07-05');
    const quarterlyFee = rows201.find(
      (row) => row.kind === 'COMMON_FEE' && row.total.amount === '9000.00',
    );
    expect(quarterlyFee?.dueDate).toBe('2026-07-05');

    const rows202 = (await listInvoices(page.request, { roomId: room202 })).filter(
      (row) => row.periodStart === '2026-07-01',
    );
    expect(rows202).toHaveLength(1);
    expect(rows202[0]?.kind).toBe('COMMON_FEE');
    expect(rows202[0]?.total.amount).toBe('3000.00');

    const rows203 = (await listInvoices(page.request, { roomId: room203 })).filter(
      (row) => row.periodStart === '2026-07-01',
    );
    expect(rows203).toHaveLength(1);
    expect(rows203[0]?.kind).toBe('COMMON_FEE');

    const rows204 = (await listInvoices(page.request, { roomId: room204 })).filter(
      (row) => row.periodStart === '2026-07-01',
    );
    expect(rows204).toHaveLength(2);
    const fee204 = rows204.find((row) => row.kind === 'COMMON_FEE');
    expect(fee204?.total.amount).toBe('2500.00');

    const rows205 = (await listInvoices(page.request, { roomId: room205 })).filter(
      (row) => row.periodStart === '2026-07-01',
    );
    expect(rows205).toHaveLength(1);
    expect(rows205[0]?.kind).toBe('COMMON_FEE');
    expect(rows205[0]?.total.amount).toBe('1500.00');

    for (const roomId of [room208, room209]) {
      const rows = (await listInvoices(page.request, { roomId })).filter(
        (row) => row.periodStart === '2026-07-01',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kind).toBe('PROJECT_MANAGED_RENT');
      expect(rows[0]?.total.amount).toBe('8000.00');
      expect(rows[0]?.dueDate).toBe('2026-07-05');
    }
  });

  test('Q-DM-007: ownerless project-managed room gets a room-based invoice with no owner snapshot', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room201 = await findBillingRoom(page, `E2E-${runId}-201`);
    const room205 = await findBillingRoom(page, `E2E-${runId}-205`);
    const fee205 = (await listInvoices(page.request, { roomId: room205 })).find(
      (row) => row.kind === 'COMMON_FEE' && row.periodStart === '2026-07-01',
    );
    expect(fee205?.total.amount).toBe('1500.00');
    const area201 = (await listInvoices(page.request, { roomId: room201 })).find(
      (row) => row.kind === 'COMMON_FEE' && row.total.amount === '2485.00' && row.periodStart === '2026-07-01',
    );
    expect(area201).toBeDefined();
    const root = path.resolve(__dirname, '..', '..', '..');
    async function probeOwners(invoiceId: string): Promise<number> {
      return new Promise<number>((resolve, reject) => {
        const child = spawn('pnpm', ['billing:ops', 'probe-fee-owners', '--', '--invoice', invoiceId], {
          cwd: root,
          shell: process.platform === 'win32',
          env: process.env,
        });
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        child.on('error', reject);
        child.on('close', (code: number) => {
          if (code !== 0) {
            reject(new Error(`probe-fee-owners exited ${code}: ${output}`));
            return;
          }
          try {
            const line = output
              .split('\n')
              .map((entry) => entry.trim())
              .find((entry) => entry.startsWith('{'));
            if (line === undefined) throw new Error('probe-fee-owners printed no result.');
            resolve((JSON.parse(line) as { snapshotOwners: number }).snapshotOwners);
          } catch (error) {
            reject(error);
          }
        });
      });
    }
    expect(await probeOwners(fee205?.id ?? '')).toBe(0);
    expect(await probeOwners(area201?.id ?? '')).toBeGreaterThanOrEqual(1);
  });

  test('backfill over seven months catches up in three runs with turnover isolated to February', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room201 = await findBillingRoom(page, `E2E-${runId}-201`);
    const room204 = await findBillingRoom(page, `E2E-${runId}-204`);

    const roomIds = await Promise.all(Array.from({ length: 9 }, (_, index) => findBillingRoom(page, `E2E-${runId}-${201 + index}`)));
    const run1 = await triggerGenerate(page.request, {
      triggerSource: 'MANUAL',
      fromCycle: '2025-10',
      toCycle: '2026-04',
    });
    expect(run1.json.data.created).toBeGreaterThanOrEqual(22);
    expect(await countInvoiceWindow(page.request, roomIds, '2025-10-01', '2025-12-31')).toBe(22);
    expect(run1.json.data.caughtUp).toBe(false);
    const nextFromRun1 = run1.json.data.nextFromCycle;
    expect(nextFromRun1).toBe('2026-01');
    const run2 = await triggerGenerate(page.request, {
      triggerSource: 'MANUAL',
      fromCycle: nextFromRun1 ?? '',
      toCycle: '2026-04',
    });
    expect(run2.json.data.created).toBeGreaterThanOrEqual(21);
    expect(await countInvoiceWindow(page.request, roomIds, '2026-01-01', '2026-03-31')).toBe(21);
    expect(run2.json.data.reviewRequired).toBeGreaterThanOrEqual(1);
    const reviews = await listTurnoverReviews(page.request);
    expect(reviews.rows.filter((row) => roomIds.includes(row.roomId) && row.calendarMonth >= '2026-01-01' && row.calendarMonth <= '2026-03-31')).toHaveLength(1);
    expect(run2.json.data.caughtUp).toBe(false);
    const nextFromRun2 = run2.json.data.nextFromCycle;
    expect(nextFromRun2).toBe('2026-04');
    const run3 = await triggerGenerate(page.request, {
      triggerSource: 'MANUAL',
      fromCycle: nextFromRun2 ?? '',
      toCycle: '2026-04',
    });
    expect(run3.json.data.created).toBeGreaterThanOrEqual(8);
    expect(await countInvoiceWindow(page.request, roomIds, '2026-04-01', '2026-04-30')).toBe(8);
    expect(run3.json.data.reviewRequired).toBe(0);
    expect(run3.json.data.caughtUp).toBe(true);
    expect(run3.json.data.nextFromCycle).toBeUndefined();

    const rows204 = await listInvoices(page.request, { roomId: room204 });
    const jan204 = rows204.filter((row) => row.periodStart === '2026-01-01');
    expect(jan204.some((row) => row.kind === 'PROJECT_MANAGED_RENT')).toBe(true);
    const feb204 = rows204.filter((row) => row.periodStart === '2026-02-01');
    expect(feb204).toHaveLength(1);
    expect(feb204[0]?.kind).toBe('COMMON_FEE');
    expect(feb204[0]?.dueDate).toBe('2026-02-05');
    const mar204 = rows204.filter((row) => row.periodStart === '2026-03-01');
    expect(mar204.some((row) => row.kind === 'PROJECT_MANAGED_RENT')).toBe(true);

    const rows201 = await listInvoices(page.request, { roomId: room201 });
    const feb201 = rows201.filter((row) => row.periodStart === '2026-02-01');
    expect(feb201.length).toBeGreaterThanOrEqual(2);
    for (const row of feb201) expect(row.dueDate).toBe('2026-02-05');
    const janQuarterly = rows201.find(
      (row) => row.periodStart === '2026-01-01' && row.total.amount === '9000.00',
    );
    expect(janQuarterly?.kind).toBe('COMMON_FEE');
  });

  test('MS-BILL-03: three trigger rounds keep invoice count fixed and keep the job log', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const rooms = [
      await findBillingRoom(page, `E2E-${runId}-201`),
      await findBillingRoom(page, `E2E-${runId}-202`),
      await findBillingRoom(page, `E2E-${runId}-203`),
      await findBillingRoom(page, `E2E-${runId}-204`),
      await findBillingRoom(page, `E2E-${runId}-205`),
      await findBillingRoom(page, `E2E-${runId}-208`),
      await findBillingRoom(page, `E2E-${runId}-209`),
    ];

    const previousAttempts = (await listJobRuns(page.request, { jobName: 'generate-invoices' })).find((run) => run.businessKey === '2026-09')?.attempt ?? 0;

    const round1 = await triggerGenerate(page.request, {
      triggerSource: 'MANUAL',
      fromCycle: '2026-09',
    });
    expect(round1.json.data.created).toBeGreaterThanOrEqual(9);
    const snapshotAfterRound1: string[] = [];
    for (const roomId of rooms) {
      const rows = (await listInvoices(page.request, { roomId })).filter(
        (row) => row.periodStart === '2026-09-01',
      );
      for (const row of rows) snapshotAfterRound1.push(invoiceCountKey(row));
    }
    snapshotAfterRound1.sort();
    expect(snapshotAfterRound1).toHaveLength(9);

    const round2 = await triggerGenerate(page.request, {
      triggerSource: 'MANUAL',
      fromCycle: '2026-09',
    });
    expect(round2.json.data.created).toBe(0);
    expect(round2.json.data.skipped).toBe(round1.json.data.skipped + round1.json.data.created);

    const round3 = await triggerGenerate(page.request, {
      triggerSource: 'MANUAL',
      fromCycle: '2026-09',
    });
    expect(round3.json.data.created).toBe(0);
    expect(round3.json.data.skipped).toBe(round2.json.data.skipped);

    const snapshotAfterRound3: string[] = [];
    for (const roomId of rooms) {
      const rows = (await listInvoices(page.request, { roomId })).filter(
        (row) => row.periodStart === '2026-09-01',
      );
      for (const row of rows) snapshotAfterRound3.push(invoiceCountKey(row));
    }
    snapshotAfterRound3.sort();
    expect(snapshotAfterRound3).toEqual(snapshotAfterRound1);

    const runs = await listJobRuns(page.request, { jobName: 'generate-invoices' });
    const logged = runs.find((run) => run.businessKey === '2026-09');
    expect(logged?.state).toBe('DONE');
    expect(logged?.attempt).toBe(previousAttempts + 3);
    expect(logged?.triggerSource).toBe('MANUAL');
    expectRedactedJobPayload(logged?.result);
    expect((logged?.result as { created: number }).created).toBe(0);
    const detail = await getJobRun(page.request, logged?.id ?? '');
    expect(detail.businessKey).toBe('2026-09');
    expect(detail.attempt).toBe(previousAttempts + 3);
  });

  test('PD-04 live: leap and common February invoices carry valid February due dates', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room201 = await findBillingRoom(page, `E2E-${runId}-201`);
    const room202 = await findBillingRoom(page, `E2E-${runId}-202`);
    const room203 = await findBillingRoom(page, `E2E-${runId}-203`);
    const room204 = await findBillingRoom(page, `E2E-${runId}-204`);

    const leap = await triggerGenerate(page.request, {
      triggerSource: 'MANUAL',
      fromCycle: '2024-02',
    });
    expect(leap.json.data.created).toBeGreaterThanOrEqual(7);
    expect(leap.json.data.reviewRequired).toBe(0);

    const room205 = await findBillingRoom(page, `E2E-${runId}-205`);
    for (const roomId of [room201, room202, room203, room204, room205]) {
      const rows = (await listInvoices(page.request, { roomId })).filter(
        (row) => row.periodStart === '2024-02-01',
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const row of rows) expect(row.dueDate).toBe('2024-02-05');
    }
    const leap204 = (await listInvoices(page.request, { roomId: room204 })).filter(
      (row) => row.periodStart === '2024-02-01',
    );
    expect(leap204.some((row) => row.kind === 'PROJECT_MANAGED_RENT')).toBe(true);

    for (const roomId of [room201, room202, room203, room204, room205]) {
      const rows = (await listInvoices(page.request, { roomId })).filter(
        (row) => row.periodStart === '2026-02-01',
      );
      expect(rows.length).toBeGreaterThanOrEqual(1);
      for (const row of rows) expect(row.dueDate).toBe('2026-02-05');
    }
  });

  test('lease contention: a held lease returns the already-running shape', async ({ page }) => {
    await loginAsAdmin(page);
    const root = path.resolve(__dirname, '..', '..', '..');
    const holder = spawn('pnpm', ['billing:ops', 'hold-lease', '--', '--key', '2026-08', '--ms', '20000'], {
      cwd: root,
      shell: process.platform === 'win32',
      env: process.env,
    });
    let output = '';
    holder.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    try {
      const deadline = Date.now() + 60000;
      while (!output.includes('"held":true')) {
        if (Date.now() > deadline) throw new Error('Lease holder never reported held.');
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      const contended = await postJobRaw(
        page.request,
        { triggerSource: 'MANUAL', fromCycle: '2026-08' },
        { 'x-job-secret': jobSecret() },
      );
      expect(contended.status).toBe(200);
      expect(contended.json).toEqual({ data: { skipped: 'already-running' } });
    } finally {
      await new Promise<void>((resolve) => {
        holder.on('close', () => resolve());
      });
    }
    const runs = await listJobRuns(page.request, { jobName: 'generate-invoices' });
    expect(runs.some((run) => run.businessKey === '2026-08' && run.state === 'ERROR')).toBe(true);
  });

  test('invoice reads: admin detail works, bad ids fail closed, outsiders see nothing', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const room201 = await findBillingRoom(page, `E2E-${runId}-201`);
    const fee = (await listInvoices(page.request, { roomId: room201 })).find(
      (row) => row.kind === 'COMMON_FEE' && row.periodStart === '2026-07-01',
    );
    expect(fee).toBeDefined();
    const detail = await getInvoice(page.request, fee?.id ?? '');
    expect(detail.roomId).toBe(room201);
    expect(detail.total).toEqual({ amount: fee?.total.amount, currency: 'THB' });
    expect(detail.total.amount).toMatch(/^(0|[1-9]\d*)\.\d{2}$/);

    const badId = await apiJson<ErrorEnvelope>(page.request, {
      method: 'GET',
      path: '/api/invoices/not-a-uuid',
    });
    expect(badId.status).toBe(400);
    expect(badId.json.error.code).toBe('VALIDATION_ERROR');

    const missing = await apiJson<ErrorEnvelope>(page.request, {
      method: 'GET',
      path: `/api/invoices/${randomUUID()}`,
    });
    expect(missing.status).toBe(404);
    expect(missing.json.error.code).toBe('RESOURCE_NOT_FOUND');

    const badKind = await apiJson<ErrorEnvelope>(page.request, {
      method: 'GET',
      path: '/api/invoices?kind=BOGUS',
    });
    expect(badKind.status).toBe(400);
    expect(badKind.json.error.code).toBe('VALIDATION_ERROR');

    const outsider = await provisionResidentWithRetry(page, browser, {
      runId,
      workerIndex: testInfo.workerIndex,
      stem: 'billoutsider',
      baseURL,
    });
    try {
      const empty = await apiJson<{ data: InvoiceRow[] }>(outsider.page.request, {
        method: 'GET',
        path: '/api/invoices?pageSize=100',
      });
      expect(empty.status).toBe(200);
      expect(empty.json.data).toHaveLength(0);
      const concealed = await apiJson<ErrorEnvelope>(outsider.page.request, {
        method: 'GET',
        path: `/api/invoices/${fee?.id ?? ''}`,
      });
      expect(concealed.status).toBe(404);
      expect(concealed.json.error.code).toBe('RESOURCE_NOT_FOUND');
    } finally {
      await outsider.close();
    }
  });

  test('job-run reads: filters work, bad ids fail closed, non-admin is denied', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const done = await listJobRuns(page.request, { jobName: 'generate-invoices', state: 'DONE' });
    expect(done.length).toBeGreaterThanOrEqual(1);
    for (const run of done.slice(0, 5)) expectRedactedJobPayload(run.result);
    const detail = await getJobRun(page.request, done[0]?.id ?? '');
    expect(detail.jobName).toBe('generate-invoices');

    const badId = await apiJson<ErrorEnvelope>(page.request, {
      method: 'GET',
      path: '/api/admin/billing/job-runs/not-a-uuid',
    });
    expect(badId.status).toBe(400);
    expect(badId.json.error.code).toBe('VALIDATION_ERROR');

    const missing = await apiJson<ErrorEnvelope>(page.request, {
      method: 'GET',
      path: `/api/admin/billing/job-runs/${randomUUID()}`,
    });
    expect(missing.status).toBe(404);
    expect(missing.json.error.code).toBe('RESOURCE_NOT_FOUND');

    const outsider = await provisionResidentWithRetry(page, browser, {
      runId,
      workerIndex: testInfo.workerIndex,
      stem: 'billreader',
      baseURL,
    });
    try {
      const deniedList = await apiJson<ErrorEnvelope>(outsider.page.request, {
        method: 'GET',
        path: '/api/admin/billing/job-runs?pageSize=10',
      });
      expect(deniedList.status).toBe(403);
      expect(deniedList.json.error.code).toBe('ACCESS_DENIED');
      const deniedDetail = await apiJson<ErrorEnvelope>(outsider.page.request, {
        method: 'GET',
        path: `/api/admin/billing/job-runs/${done[0]?.id ?? ''}`,
      });
      expect(deniedDetail.status).toBe(403);
      expect(deniedDetail.json.error.code).toBe('ACCESS_DENIED');
    } finally {
      await outsider.close();
    }
  });

  test('redaction: new owner sees only post-transfer private rent, admin sees none of it', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsAdmin(page);
    const room202 = await findBillingRoom(page, `E2E-${runId}-202`);
    const suffix = runId.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const username = `e2e${suffix}billowner${testInfo.workerIndex}`.slice(0, 30);

    const provisioned = await provisionUser(page, {
      username,
      name: `Billing Owner ${runId}`,
    });
    await transferRoomTo(page, {
      roomId: room202,
      fromUserId: await roomOwnerAt(page, room202),
      toUserId: provisioned.userId,
    });
    const context = await browser.newContext({ baseURL });
    const ownerPage = await context.newPage();
    try {
      await completeFirstLogin(ownerPage, {
        username,
        tempPassword: provisioned.tempPassword,
        newPassword: `Owner-${suffix}-pw1`,
      });

      const may = await triggerGenerate(page.request, {
        triggerSource: 'MANUAL',
        fromCycle: '2026-05',
      });
      expect(may.json.data.created).toBeGreaterThanOrEqual(7);
      expectRedactedJobPayload(may.json.data);

      const privateRows = await listInvoices(ownerPage.request, { kind: 'PRIVATE_RENT' });
      expect(privateRows).toHaveLength(1);
      expect(privateRows[0]?.roomId).toBe(room202);
      expect(privateRows[0]?.periodStart).toBe('2026-05-01');
      expect(privateRows[0]?.total).toEqual({ amount: '12000.00', currency: 'THB' });
      const ownerDetail = await getInvoice(ownerPage.request, privateRows[0]?.id ?? '');
      expect(ownerDetail.roomId).toBe(room202);

      const adminRead = await apiJson<ErrorEnvelope>(page.request, {
        method: 'GET',
        path: `/api/invoices/${privateRows[0]?.id ?? ''}`,
      });
      expect(adminRead.status).toBe(404);
      expect(adminRead.json.error.code).toBe('RESOURCE_NOT_FOUND');

      const adminKind = await apiJson<ErrorEnvelope>(page.request, {
        method: 'GET',
        path: '/api/invoices?kind=PRIVATE_RENT',
      });
      expect(adminKind.status).toBe(404);
      expect(adminKind.json.error.code).toBe('RESOURCE_NOT_FOUND');
    } finally {
      await context.close();
    }
  });

  test('charge event routes stay reachable from the generation file', async ({ page }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const created = await postChargeEvent(page.request, {
      eventEffectiveDate: '2026-06-20',
      configuredAmount: { amount: '500.00', currency: 'THB' },
      chargeContext: { runId, note: `E2E-${runId} route reachability probe.` },
      status: 'OPEN',
    });
    expect(created.json.data.status).toBe('OPEN');
    const fetched = await getChargeEvent(page.request, created.json.data.id);
    expect(fetched.eventEffectiveDate).toBe('2026-06-20');
    expect(fetched.configuredAmount).toEqual({ amount: '500.00', currency: 'THB' });
  });

  test('ui: job-run list and detail render the redacted aggregate shape', async ({ page }) => {
    await loginAsAdmin(page);
    const sweep = await page.request.fetch('/api/internal/jobs/sweep-orphans', {
      method: 'POST',
      data: { triggerSource: 'MANUAL' },
      headers: { 'content-type': 'application/json', 'x-job-secret': jobSecret() },
    });
    expect(sweep.status()).toBe(200);
    const sweeps = await listJobRuns(page.request, { jobName: 'sweep-orphans', state: 'DONE' });
    expect(sweeps.length).toBeGreaterThanOrEqual(1);
    await page.goto('/admin/billing/job-runs');
    await expect(page.getByTestId('job-run-list-page')).toBeVisible();
    const sweepRow = sweeps[0];
    if (sweepRow === undefined) throw new Error('No sweeper run to render.');
    await expect(page.getByTestId(`job-run-row-${sweepRow.id}`)).toBeVisible();
    await expect(page.getByTestId(`job-run-summary-${sweepRow.id}`)).toContainText('transitioned');
    const done = await listJobRuns(page.request, { jobName: 'generate-invoices', state: 'DONE' });
    expect(done.length).toBeGreaterThanOrEqual(1);
    const first = done[0];
    if (first === undefined) throw new Error('No finished job run to render.');
    expectRedactedJobPayload(first.result);
    await expect(page.getByTestId(`job-run-row-${first.id}`)).toBeVisible();
    await expect(page.getByTestId(`job-run-summary-${first.id}`)).not.toContainText('private', {
      ignoreCase: true,
    });
    await page.getByTestId(`job-run-row-${first.id}`).click();
    await expect(page.getByTestId('job-run-detail-page')).toBeVisible();
    await expect(page.getByTestId('job-run-detail-state')).toHaveText('DONE');
    const detail = await getJobRun(page.request, first.id);
    expect(detail.result).not.toBeNull();
    await expect(page.getByTestId('job-run-detail-created')).toHaveText(
      String((detail.result as { created: number }).created),
    );
    await expect(page.getByTestId('job-run-detail-skipped')).toHaveText(
      String((detail.result as { skipped: number }).skipped),
    );
    await expect(page.getByTestId('job-run-detail-page')).not.toContainText('privateRent', {
      ignoreCase: true,
    });
    await page.getByTestId('job-run-detail-back').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('job-run-list-page')).toBeVisible();
  });

  test('ui: invoice list and detail render generation results', async ({ page }) => {
    const { runId } = await readRunContext();
    await loginAsAdmin(page);
    const room201 = await findBillingRoom(page, `E2E-${runId}-201`);
    const fee = (await listInvoices(page.request, { roomId: room201 })).find(
      (row) => row.kind === 'COMMON_FEE' && row.periodStart === '2026-07-01',
    );
    expect(fee).toBeDefined();
    await page.goto('/admin/billing/invoices');
    await expect(page.getByTestId('admin-invoice-list-page')).toBeVisible();
    await expect(page.getByTestId('invoice-payment-state').first()).toHaveCount(0);
    const first = (await listInvoices(page.request, { pageSize: 20 }))[0];
    if (first === undefined) throw new Error('No invoice to render.');
    await page.goto(`/admin/billing/invoices/${first.id}`);
    await expect(page.getByTestId('invoice-detail-page')).toBeVisible();
    await expect(page.getByTestId('invoice-detail-total')).toContainText(
      `${first.total.amount} ${first.total.currency}`,
    );
    await expect(page.getByTestId('invoice-payment-state')).toBeVisible();
    await page.getByTestId('invoice-detail-back').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('admin-invoice-list-page')).toBeVisible();
  });
});
