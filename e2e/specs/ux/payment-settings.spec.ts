import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { expect, test } from '../../helpers/projectPaymentTest';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { completeFirstLogin, loginAsUser, provisionUser } from '../../helpers/owner';
import { buildValidImage } from '../../helpers/announcementFiles';

const exec = promisify(execFile);

test('receiving accounts, private permissions, QR uploads and issued snapshots stay connected', async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(240000);
  const { runId } = await readRunContext();
  const bankAdmin =
    `e2e${runId.replace(/[^a-z0-9]/gi, '')}bank${Date.now().toString(36).slice(-4)}`.slice(0, 30);
  const { stdout } = await exec(
    process.execPath,
    ['node_modules/tsx/dist/cli.mjs', '--conditions=react-server', 'scripts/e2e-admin.ts'],
    {
      cwd: path.resolve(__dirname, '../../..'),
      env: {
        ...process.env,
        SEED_ENABLED: 'true',
        NODE_ENV: 'development',
        E2E_ADMIN_USERNAME: bankAdmin,
      },
    },
  );
  const bankPassword = stdout
    .split('\n')
    .find((line) => line.startsWith('E2E_ADMIN_PASSWORD='))
    ?.trim()
    .slice(19);
  if (!bankPassword) throw new Error('Could not provision the isolated payment settings admin.');
  await loginAsUser(page, bankAdmin, bankPassword);
  const name = `E2E-${runId}-Payments-${Date.now().toString(36).slice(-4)}`;
  const building = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/buildings',
    body: { projectId: randomUUID(), name, status: 'ACTIVE' },
  });
  expect(building.status).toBe(200);
  const floor = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/floors',
    body: { buildingId: building.json.data.id, label: 'Ground floor' },
  });
  expect(floor.status).toBe(200);
  const room = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/rooms',
    body: {
      buildingId: building.json.data.id,
      floorId: floor.json.data.id,
      name,
      areaSqm: '40',
      status: 'ACTIVE',
    },
  });
  expect(room.status).toBe(200);
  const roomId = room.json.data.id;
  const username =
    `e2e${runId.replace(/[^a-z0-9]/gi, '')}bn${Date.now().toString(36).slice(-4)}`.slice(0, 30);
  const owner = await provisionUser(page, { username, name });
  const assigned = await apiJson(page.request, {
    method: 'POST',
    path: `/api/admin/rooms/${roomId}/owners`,
    body: { username },
  });
  expect(assigned.status).toBe(200);
  const session = await page.request.get('/api/auth/get-session');
  const adminId = ((await session.json()) as { user: { id: string } }).user.id;
  async function issue(cycle: string, targetRoomId = roomId, kind = 'COMMON_FEE') {
    const output = await exec(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        '--conditions=react-server',
        'e2e/fixtures/payment-settings-invoice.ts',
        targetRoomId,
        adminId,
        cycle,
        runId,
        kind,
      ],
      {
        cwd: path.resolve(__dirname, '../../..'),
        env: { ...process.env, SEED_ENABLED: 'true', NODE_ENV: 'development' },
      },
    );
    return (JSON.parse(output.stdout.trim().split('\n').at(-1) ?? '{}') as { invoiceId: string })
      .invoiceId;
  }
  const oldInvoice = await issue('2027-10');
  const originalAccount = (
    await (await page.request.get(`/api/invoices/${oldInvoice}/payments?view=instruction`)).json()
  ).data.instruction;
  await page.goto('/admin/billing/settings');
  await expect(page.getByText('Project receiving account', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Configure account' })).toHaveCount(0);
  await page.getByTestId('payment-settings-bank').fill('Example Bank');
  await page.getByTestId('payment-settings-name').fill('CondoHub Test Account');
  await page.getByTestId('payment-settings-number').fill('123-456-7890');
  const image = await buildValidImage('png', 32);
  await page
    .getByTestId('payment-settings-upload-input')
    .setInputFiles({ name: 'payment-qr.png', mimeType: 'image/png', buffer: image.bytes });
  await expect(page.getByTestId('payment-settings-slip-ready')).toBeVisible({ timeout: 30000 });

  await page.getByTestId('payment-settings-save').click();
  await expect(page.getByTestId('payment-settings-current-qr')).toBeVisible({ timeout: 15000 });
  const sharedInvoice = await issue('2027-11');
  const current = await page.request.get(
    `/api/invoices/${sharedInvoice}/payments?view=instruction`,
  );
  const instruction = (await current.json()).data.instruction as {
    accountNumber: string;
    qrImageId: string;
  };
  expect(instruction.accountNumber).toBe('123-456-7890');
  expect(instruction.qrImageId).toBeTruthy();
  await page.getByTestId('payment-settings-number').fill('999-888-7777');

  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/payment-settings') && response.request().method() === 'PUT',
  );
  await page.getByTestId('payment-settings-save').click();
  const savedResponse = await saved;
  expect(savedResponse.status()).toBe(200);
  const latestId = (await savedResponse.json()).data.id as string;
  const stale = await page.request.put('/api/admin/billing/payment-settings', {
    data: {
      payeeType: 'PROJECT',
      bankName: 'Stale',
      accountName: 'Stale',
      accountNumber: '0',
      qrImageId: null,
      expectedId: null,
    },
  });
  expect(stale.status()).toBe(409);
  const invalidImage = await page.request.put('/api/admin/billing/payment-settings', {
    data: {
      payeeType: 'PROJECT',
      bankName: 'Invalid image',
      accountName: 'Invalid',
      accountNumber: '0',
      qrImageId: randomUUID(),
      expectedId: latestId,
    },
  });
  expect(invalidImage.status()).toBe(400);
  const preserved = await page.request.get(
    `/api/invoices/${sharedInvoice}/payments?view=instruction`,
  );
  expect((await preserved.json()).data.instruction.accountNumber).toBe('123-456-7890');
  const newInvoice = await issue('2027-12');
  const unchanged = await page.request.get(`/api/invoices/${oldInvoice}/payments?view=instruction`);
  expect((await unchanged.json()).data.instruction).toEqual(originalAccount);
  const updated = await page.request.get(`/api/invoices/${newInvoice}/payments?view=instruction`);
  expect((await updated.json()).data.instruction.accountNumber).toBe('999-888-7777');
  const otherBuilding = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/buildings',
    body: { projectId: randomUUID(), name: `${name}-Shared`, status: 'ACTIVE' },
  });
  expect(otherBuilding.status).toBe(200);
  const otherFloor = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/floors',
    body: { buildingId: otherBuilding.json.data.id, label: 'Ground floor' },
  });
  expect(otherFloor.status).toBe(200);
  const otherRoom = await apiJson<{ data: { id: string } }>(page.request, {
    method: 'POST',
    path: '/api/admin/rooms',
    body: {
      buildingId: otherBuilding.json.data.id,
      floorId: otherFloor.json.data.id,
      name: `${name}-Shared`,
      areaSqm: '40',
      status: 'ACTIVE',
    },
  });
  expect(otherRoom.status).toBe(200);
  const otherId = otherRoom.json.data.id;
  const otherOwnership = await apiJson(page.request, {
    method: 'POST',
    path: `/api/admin/rooms/${otherId}/owners`,
    body: { username },
  });
  expect(otherOwnership.status).toBe(200);
  const anotherFee = await issue('2027-12', otherId);
  const feeAccount = await page.request.get(
    `/api/invoices/${anotherFee}/payments?view=instruction`,
  );
  expect((await feeAccount.json()).data.instruction.accountNumber).toBe('999-888-7777');
  const projectRent = await issue('2028-03', otherId, 'PROJECT_MANAGED_RENT');
  const rentAccount = await page.request.get(
    `/api/invoices/${projectRent}/payments?view=instruction`,
  );
  expect((await rentAccount.json()).data.instruction.accountNumber).toBe('999-888-7777');
  for (const targetInvoice of [oldInvoice, newInvoice]) {
    await exec(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        '--conditions=react-server',
        'e2e/fixtures/project-payment-fill.ts',
        targetInvoice,
        sharedInvoice,
        adminId,
        runId,
      ],
      {
        cwd: path.resolve(__dirname, '../../..'),
        env: { ...process.env, SEED_ENABLED: 'true', NODE_ENV: 'development' },
      },
    );
  }
  for (const width of [360, 768, 1366]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath(`payment-settings-${width}.png`),
      fullPage: true,
    });
  }
  const context = await browser.newContext({
    baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
  });
  const ownerPage = await context.newPage();
  try {
    await completeFirstLogin(ownerPage, {
      username,
      tempPassword: owner.tempPassword,
      newPassword: `Bank-${runId}-pw1`,
    });
    await ownerPage.goto(`/rooms/${roomId}/payment-settings`);
    await expect(ownerPage.getByTestId('room-payment-settings-page')).toBeVisible();
    const payerQr = await ownerPage.request.get(`/api/images/${instruction.qrImageId}/access`);
    expect(payerQr.status()).toBe(200);
    const denied = await ownerPage.request.put('/api/admin/billing/payment-settings', {
      data: {
        payeeType: 'PROJECT',
        bankName: 'Denied',
        accountName: 'Denied',
        accountNumber: '0',
        qrImageId: null,
        expectedId: null,
      },
    });
    expect(denied.status()).toBe(404);
    await ownerPage.getByTestId('payment-settings-bank').fill('Owner Bank');
    await ownerPage.getByTestId('payment-settings-name').fill('Private owner');
    await ownerPage.getByTestId('payment-settings-number').fill('111-222-3333');
    const ownerUpload = ownerPage.waitForResponse((response) =>
      /\/api\/images\/[^/]+\/complete$/.test(response.url()),
    );
    await ownerPage
      .getByTestId('payment-settings-upload-input')
      .setInputFiles({ name: 'owner-qr.png', mimeType: 'image/png', buffer: image.bytes });
    await expect(ownerPage.getByTestId('payment-settings-slip-ready')).toBeVisible({
      timeout: 30000,
    });
    await ownerPage.getByTestId('payment-settings-save').click();
    await expect(ownerPage.getByTestId('payment-settings-current-qr')).toBeVisible();
    const privateImageId = (await (await ownerUpload).json()).data.imageId as string;
    const privateImageDenied = await page.request.get(`/api/images/${privateImageId}/access`);
    expect(privateImageDenied.status()).toBe(403);
    const privateDenied = await page.request.put(`/api/rooms/${roomId}/payment-settings`, {
      data: {
        payeeType: 'OWNER',
        bankName: 'Denied',
        accountName: 'Denied',
        accountNumber: '0',
        qrImageId: null,
        expectedId: null,
      },
    });
    expect(privateDenied.status()).toBe(404);
    await exec(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        '--conditions=react-server',
        'e2e/fixtures/payment-settings-review.ts',
        roomId,
        adminId,
        runId,
      ],
      {
        cwd: path.resolve(__dirname, '../../..'),
        env: { ...process.env, SEED_ENABLED: 'true', NODE_ENV: 'development' },
      },
    );
  } finally {
    await context.close();
  }
});
