import { expect, test } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { readRunContext, workerNamespace } from '../../fixtures/run-context';
import { loginAsPoolAdmin } from '../../helpers/owner';
import { provisionResidentWithRetry } from '../../helpers/resident';
import { buildFakeImage, buildValidImage } from '../../helpers/announcementFiles';
import { completeUpload, mintIntent, putBytes, readAccess } from './uploadFlow';

interface AnnouncementEnvelope {
  data: { id: string; images: Array<{ id: string }> };
}

test.describe('upload pipeline: intents, verification, attach guards', () => {
  test.setTimeout(180000);

  test('one-time intent: second complete is rejected and PENDING never serves a read url', async ({
    page,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    await loginAsPoolAdmin(page, `pipeline-${testInfo.testId}`);

    const fixture = await buildValidImage('jpeg');
    const intent = await mintIntent(page.request, {
      scope: 'ANNOUNCEMENT',
      entityRef: { type: 'announcement', id: null },
      contentType: fixture.contentType,
      fileName: `e2e-${ns}-onetime.jpg`,
    });
    expect(intent.status).toBe(200);
    expect(intent.json.data.countCheck).toEqual({ action: 'PUBLISH_ANNOUNCEMENT', used: 0, max: 5 });

    const pendingAccess = await readAccess(page.request, intent.json.data.imageId);
    expect(pendingAccess.status).toBe(404);

    const putStatus = await putBytes(intent.json.data.uploadUrl, fixture.contentType, fixture.bytes);
    expect(putStatus).toBeLessThan(300);

    const first = await completeUpload(page.request, intent.json.data.imageId);
    expect(first.status).toBe(200);
    expect(first.json.data.state).toBe('READY');

    const second = await completeUpload(page.request, intent.json.data.imageId);
    expect(second.status).toBe(400);
  });

  test('fake bytes are rejected before READY and the rejected row never serves a read url', async ({
    page,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    await loginAsPoolAdmin(page, `pipeline-${testInfo.testId}`);

    const fixture = buildFakeImage();
    const intent = await mintIntent(page.request, {
      scope: 'ANNOUNCEMENT',
      entityRef: { type: 'announcement', id: null },
      contentType: fixture.contentType,
      fileName: `e2e-${ns}-fake.jpg`,
    });
    expect(intent.status).toBe(200);

    const putStatus = await putBytes(intent.json.data.uploadUrl, fixture.contentType, fixture.bytes);
    expect(putStatus).toBeLessThan(300);

    const completed = await completeUpload(page.request, intent.json.data.imageId);
    expect([400, 413]).toContain(completed.status);

    const access = await readAccess(page.request, intent.json.data.imageId);
    expect(access.status).toBe(404);
  });

  test('non-admin cannot mint ANNOUNCEMENT intents but reads published images', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    await loginAsPoolAdmin(page, `pipeline-${testInfo.testId}`);
    const baseURL = process.env.TEST_BASE_URL ?? 'http://localhost:3000';
    const resident = await provisionResidentWithRetry(page, browser, {
      runId,
      workerIndex: testInfo.workerIndex,
      stem: 'upipe',
      baseURL,
    });
    try {
      const denied = await mintIntent(resident.page.request, {
        scope: 'ANNOUNCEMENT',
        entityRef: { type: 'announcement', id: null },
        contentType: 'image/png',
        fileName: `e2e-${ns}-denied.png`,
      });
      expect(denied.status).toBe(403);

      const fixture = await buildValidImage('png');
      const intent = await mintIntent(page.request, {
        scope: 'ANNOUNCEMENT',
        entityRef: { type: 'announcement', id: null },
        contentType: fixture.contentType,
        fileName: `e2e-${ns}-shared.png`,
      });
      expect(intent.status).toBe(200);
      expect(await putBytes(intent.json.data.uploadUrl, fixture.contentType, fixture.bytes)).toBeLessThan(300);
      expect((await completeUpload(page.request, intent.json.data.imageId)).status).toBe(200);

      const created = await apiJson<AnnouncementEnvelope>(page.request, {
        method: 'POST',
        path: '/api/admin/announcements',
        body: {
          title: `E2E-${ns} pipeline visibility`,
          body: `Pipeline visibility ${ns}.`,
          publishAt: new Date(Date.now() - 1000).toISOString(),
          imageIds: [intent.json.data.imageId],
        },
      });
      expect(created.status).toBe(200);

      const access = await readAccess(resident.page.request, intent.json.data.imageId);
      expect(access.status).toBe(200);
      expect(access.json.data.url).toContain('http');
    } finally {
      await resident.close();
    }
  });

  test('F-02 single-attach: one READY image cannot attach to two announcements', async ({
    page,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    await loginAsPoolAdmin(page, `pipeline-${testInfo.testId}`);

    const fixture = await buildValidImage('webp');
    const intent = await mintIntent(page.request, {
      scope: 'ANNOUNCEMENT',
      entityRef: { type: 'announcement', id: null },
      contentType: fixture.contentType,
      fileName: `e2e-${ns}-shared.webp`,
    });
    expect(intent.status).toBe(200);
    expect(await putBytes(intent.json.data.uploadUrl, fixture.contentType, fixture.bytes)).toBeLessThan(300);
    expect((await completeUpload(page.request, intent.json.data.imageId)).status).toBe(200);

    const first = await apiJson<AnnouncementEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/announcements',
      body: {
        title: `E2E-${ns} first attach`,
        body: `First attach ${ns}.`,
        publishAt: new Date(Date.now() - 1000).toISOString(),
        imageIds: [intent.json.data.imageId],
      },
    });
    expect(first.status).toBe(200);

    const second = await apiJson<AnnouncementEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/announcements',
      body: {
        title: `E2E-${ns} second attach`,
        body: `Second attach ${ns}.`,
        publishAt: new Date(Date.now() - 1000).toISOString(),
        imageIds: [intent.json.data.imageId],
      },
    });
    expect(second.status).toBe(400);
  });

  test('count cap N/N+1: five images attach, the sixth is rejected with no partial record', async ({
    page,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    await loginAsPoolAdmin(page, `pipeline-${testInfo.testId}`);

    const readyIds: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const fixture = await buildValidImage('png', 16);
      const intent = await mintIntent(page.request, {
        scope: 'ANNOUNCEMENT',
        entityRef: { type: 'announcement', id: null },
        contentType: fixture.contentType,
        fileName: `e2e-${ns}-cap-${index}.png`,
      });
      expect(intent.status).toBe(200);
      expect(await putBytes(intent.json.data.uploadUrl, fixture.contentType, fixture.bytes)).toBeLessThan(300);
      const completed = await completeUpload(page.request, intent.json.data.imageId);
      expect(completed.status).toBe(200);
      readyIds.push(intent.json.data.imageId);
    }

    const created = await apiJson<AnnouncementEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/announcements',
      body: {
        title: `E2E-${ns} cap five`,
        body: `Cap five ${ns}.`,
        publishAt: new Date(Date.now() - 1000).toISOString(),
        imageIds: readyIds.slice(0, 5),
      },
    });
    expect(created.status).toBe(200);
    expect(created.json.data.images).toHaveLength(5);

    const over = await apiJson<AnnouncementEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/announcements',
      body: {
        title: `E2E-${ns} cap six`,
        body: `Cap six ${ns}.`,
        publishAt: new Date(Date.now() - 1000).toISOString(),
        imageIds: readyIds,
      },
    });
    expect(over.status).toBe(400);

    const feed = await apiJson<{ data: Array<{ id: string; title: string }> }>(page.request, {
      method: 'GET',
      path: '/api/announcements?page=1&pageSize=100',
    });
    expect(feed.status).toBe(200);
    expect(feed.json.data.some((row) => row.title === `E2E-${ns} cap six`)).toBe(false);
  });

  test('concurrent adds never exceed the cap: one PATCH wins, the other is rejected', async ({
    page,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    await loginAsPoolAdmin(page, `pipeline-${testInfo.testId}`);

    const readyIds: string[] = [];
    for (let index = 0; index < 7; index += 1) {
      const fixture = await buildValidImage('png', 16);
      const intent = await mintIntent(page.request, {
        scope: 'ANNOUNCEMENT',
        entityRef: { type: 'announcement', id: null },
        contentType: fixture.contentType,
        fileName: `e2e-${ns}-race-${index}.png`,
      });
      expect(intent.status).toBe(200);
      expect(await putBytes(intent.json.data.uploadUrl, fixture.contentType, fixture.bytes)).toBeLessThan(300);
      expect((await completeUpload(page.request, intent.json.data.imageId)).status).toBe(200);
      readyIds.push(intent.json.data.imageId);
    }

    const created = await apiJson<AnnouncementEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/announcements',
      body: {
        title: `E2E-${ns} race base`,
        body: `Race base ${ns}.`,
        publishAt: new Date(Date.now() - 1000).toISOString(),
        imageIds: readyIds.slice(0, 3),
      },
    });
    expect(created.status).toBe(200);
    const announcementId = created.json.data.id;

    const patchA = apiJson<AnnouncementEnvelope>(page.request, {
      method: 'PATCH',
      path: `/api/admin/announcements/${announcementId}`,
      body: { imageIds: [...readyIds.slice(0, 3), ...readyIds.slice(3, 5)] },
    });
    const patchB = apiJson<AnnouncementEnvelope>(page.request, {
      method: 'PATCH',
      path: `/api/admin/announcements/${announcementId}`,
      body: { imageIds: [...readyIds.slice(0, 3), ...readyIds.slice(5, 7)] },
    });
    const [resultA, resultB] = await Promise.all([patchA, patchB]);
    for (const status of [resultA.status, resultB.status]) {
      expect([200, 400, 409]).toContain(status);
    }
    expect([resultA.status, resultB.status]).toContain(200);

    const feed = await apiJson<{ data: Array<{ id: string; images: Array<{ id: string }> }> }>(
      page.request,
      {
        method: 'GET',
        path: '/api/announcements?page=1&pageSize=100',
      },
    );
    expect(feed.status).toBe(200);
    const final = feed.json.data.find((row) => row.id === announcementId);
    expect(final).toBeDefined();
    expect(final?.images.length).toBeLessThanOrEqual(5);
  });

  test('concurrent attach of one image to two announcements: one wins, F-02 rejects the other', async ({
    page,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    await loginAsPoolAdmin(page, `pipeline-${testInfo.testId}`);

    const fixture = await buildValidImage('png', 16);
    const intent = await mintIntent(page.request, {
      scope: 'ANNOUNCEMENT',
      entityRef: { type: 'announcement', id: null },
      contentType: fixture.contentType,
      fileName: `e2e-${ns}-race-shared.png`,
    });
    expect(intent.status).toBe(200);
    expect(await putBytes(intent.json.data.uploadUrl, fixture.contentType, fixture.bytes)).toBeLessThan(300);
    expect((await completeUpload(page.request, intent.json.data.imageId)).status).toBe(200);
    const sharedId = intent.json.data.imageId;

    const postA = apiJson<AnnouncementEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/announcements',
      body: {
        title: `E2E-${ns} race owner a`,
        body: `Race owner a ${ns}.`,
        publishAt: new Date(Date.now() - 1000).toISOString(),
        imageIds: [sharedId],
      },
    });
    const postB = apiJson<AnnouncementEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/announcements',
      body: {
        title: `E2E-${ns} race owner b`,
        body: `Race owner b ${ns}.`,
        publishAt: new Date(Date.now() - 1000).toISOString(),
        imageIds: [sharedId],
      },
    });
    const [resultA, resultB] = await Promise.all([postA, postB]);
    const statuses = [resultA.status, resultB.status].sort();
    expect(statuses).toEqual([200, 400]);
  });
});
