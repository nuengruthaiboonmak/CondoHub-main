import { expect, test } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { readRunContext, workerNamespace } from '../../fixtures/run-context';
import { loginAsPoolAdmin } from '../../helpers/owner';
import { provisionResidentWithRetry } from '../../helpers/resident';
import { mintIntent } from './uploadFlow';

const FAKE_SCOPES = [] as const;

test.describe('upload scope gates: fake callbacks deny until owner slices land', () => {
  test.setTimeout(180000);

  for (const scope of FAKE_SCOPES) {
    test(`${scope} intent minting is denied with SCOPE_ACL_NOT_IMPLEMENTED closed`, async ({
      page,
    }, testInfo) => {
      const { runId } = await readRunContext();
      const ns = workerNamespace(runId, testInfo.workerIndex);
      await loginAsPoolAdmin(page, 'scopeGates');

      const intent = await mintIntent(page.request, {
        scope,
        entityRef: { type: 'owner', id: null },
        contentType: 'image/png',
        fileName: `e2e-${ns}-fake.png`,
      });
      expect(intent.status).toBe(403);
    });
  }

  test('maintenance scope uses the real callback: unattached intent mints for active actors', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsPoolAdmin(page, 'scopeGates');
    const resident = await provisionResidentWithRetry(page, browser, {
      runId,
      workerIndex: testInfo.workerIndex,
      stem: 'scopemnt',
      baseURL,
    });
    try {
      const adminIntent = await mintIntent(page.request, {
        scope: 'MAINTENANCE',
        entityRef: { type: 'owner', id: null },
        contentType: 'image/png',
        fileName: `e2e-${ns}-mnt-admin.png`,
      });
      expect(adminIntent.status).toBe(200);

      const residentIntent = await mintIntent(resident.page.request, {
        scope: 'MAINTENANCE',
        entityRef: { type: 'owner', id: null },
        contentType: 'image/png',
        fileName: `e2e-${ns}-mnt-resident.png`,
      });
      expect(residentIntent.status).toBe(200);
    } finally {
      await resident.close();
    }
  });

  test('payment scopes use real callbacks: slip mints for residents, QR mints for admins only', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsPoolAdmin(page, 'scopeGates');
    const resident = await provisionResidentWithRetry(page, browser, {
      runId,
      workerIndex: testInfo.workerIndex,
      stem: 'scopepay',
      baseURL,
    });
    try {
      const slip = await mintIntent(resident.page.request, {
        scope: 'PAYMENT_SLIP',
        entityRef: { type: 'owner', id: null },
        contentType: 'image/png',
        fileName: `e2e-${ns}-slip.png`,
      });
      expect(slip.status).toBe(200);

      const qrDenied = await mintIntent(resident.page.request, {
        scope: 'PAYMENT_QR',
        entityRef: { type: 'owner', id: null },
        contentType: 'image/png',
        fileName: `e2e-${ns}-qr.png`,
      });
      expect(qrDenied.status).toBe(403);

      const qrAllowed = await mintIntent(page.request, {
        scope: 'PAYMENT_QR',
        entityRef: { type: 'owner', id: null },
        contentType: 'image/png',
        fileName: `e2e-${ns}-qr-admin.png`,
      });
      expect(qrAllowed.status).toBe(200);
    } finally {
      await resident.close();
    }
  });

  test('chat scope uses the real callback: unattached intent mints for active actors', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    await loginAsPoolAdmin(page, 'scopeGates');
    const resident = await provisionResidentWithRetry(page, browser, {
      runId,
      workerIndex: testInfo.workerIndex,
      stem: 'scopecht',
      baseURL,
    });
    try {
      const adminIntent = await mintIntent(page.request, {
        scope: 'CHAT',
        entityRef: { type: 'chat_message', id: null },
        contentType: 'image/png',
        fileName: `e2e-${ns}-cht-admin.png`,
      });
      expect(adminIntent.status).toBe(200);

      const residentIntent = await mintIntent(resident.page.request, {
        scope: 'CHAT',
        entityRef: { type: 'chat_message', id: null },
        contentType: 'image/png',
        fileName: `e2e-${ns}-cht-resident.png`,
      });
      expect(residentIntent.status).toBe(200);
    } finally {
      await resident.close();
    }
  });

  test('unknown scope is rejected by the route schema', async ({ page }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    await loginAsPoolAdmin(page, 'scopeGates');

    const response = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: '/api/images/intents',
      body: {
        scope: 'ROOM_AVATAR',
        entityRef: { type: 'owner', id: null },
        contentType: 'image/png',
        fileName: `e2e-${ns}-spoof.png`,
      },
    });
    expect(response.status).toBe(400);
  });
});
