import { expect, test } from '@playwright/test';
import { apiJson } from '../../helpers/api';
import { readRunContext, workerNamespace } from '../../fixtures/run-context';
import { loginAsAdmin } from '../../helpers/owner';
import { provisionResidentWithRetry } from '../../helpers/resident';

interface AnnouncementDto {
  id: string;
  title: string;
  body: string;
  publishAt: string | null;
  hiddenAt: string | null;
  editedAt: string | null;
  revision: number;
  status: string;
  images: Array<{ id: string }>;
}

interface AnnouncementEnvelope {
  data: AnnouncementDto;
}

interface FeedEnvelope {
  data: AnnouncementDto[];
  meta: { page: number; pageSize: number; total: number };
}

test.describe('announcements: full lifecycle', () => {
  test.setTimeout(180000);

  test('admin drafts, schedules, publishes, edits, hides, and restores', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    await loginAsAdmin(page);

    const resident = await provisionResidentWithRetry(page, browser, {
      runId,
      workerIndex: testInfo.workerIndex,
      stem: 'reader',
      baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
    });
    const readerPage = resident.page;

    const title = `E2E-${ns} lifecycle notice`;
    const draft = await apiJson<AnnouncementEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/announcements',
      body: { title, body: `Lifecycle body ${ns}.`, publishAt: null, imageIds: [] },
    });
    expect(draft.status).toBe(200);
    expect(draft.json.data.status).toBe('DRAFT');
    const id = draft.json.data.id;

    const beforePublish = await apiJson<FeedEnvelope>(readerPage.request, {
      method: 'GET',
      path: '/api/announcements?pageSize=100',
    });
    expect(beforePublish.status).toBe(200);
    expect(beforePublish.json.data.some((row) => row.id === id)).toBe(false);

    const future = new Date(Date.now() + 60_000).toISOString();
    const scheduled = await apiJson<AnnouncementEnvelope>(page.request, {
      method: 'PATCH',
      path: `/api/admin/announcements/${id}`,
      body: { publishAt: future },
    });
    expect(scheduled.status).toBe(200);
    expect(scheduled.json.data.status).toBe('SCHEDULED');

    const stillHidden = await apiJson<FeedEnvelope>(readerPage.request, {
      method: 'GET',
      path: '/api/announcements?pageSize=100',
    });
    expect(stillHidden.json.data.some((row) => row.id === id)).toBe(false);

    const publishNow = await apiJson<AnnouncementEnvelope>(page.request, {
      method: 'PATCH',
      path: `/api/admin/announcements/${id}`,
      body: { publishAt: new Date(Date.now() - 1000).toISOString() },
    });
    expect(publishNow.status).toBe(200);
    expect(publishNow.json.data.status).toBe('PUBLISHED');

    const visible = await apiJson<FeedEnvelope>(readerPage.request, {
      method: 'GET',
      path: '/api/announcements?pageSize=100',
    });
    expect(visible.json.data.some((row) => row.id === id)).toBe(true);

    await readerPage.goto('/announcements');
    await expect(readerPage.getByTestId('announcements-page')).toBeVisible();
    await expect(readerPage.getByTestId(`announcements-row-${id}`)).toContainText(title);

    await readerPage.goto(`/announcements/${id}`);
    await expect(readerPage.getByTestId('announcement-detail-title')).toContainText(title);

    const edited = await apiJson<AnnouncementEnvelope>(page.request, {
      method: 'PATCH',
      path: `/api/admin/announcements/${id}`,
      body: { body: `Edited body ${ns}.` },
    });
    expect(edited.status).toBe(200);
    expect(edited.json.data.revision).toBe(2);
    expect(edited.json.data.editedAt).not.toBeNull();

    await readerPage.goto(`/announcements/${id}`);
    await expect(readerPage.getByTestId('announcement-detail-edited')).toBeVisible();

    const hidden = await apiJson<AnnouncementEnvelope>(page.request, {
      method: 'PATCH',
      path: `/api/admin/announcements/${id}`,
      body: { hiddenAt: new Date().toISOString() },
    });
    expect(hidden.status).toBe(200);
    expect(hidden.json.data.status).toBe('HIDDEN');

    const concealed = await apiJson<FeedEnvelope>(readerPage.request, {
      method: 'GET',
      path: '/api/announcements?pageSize=100',
    });
    expect(concealed.json.data.some((row) => row.id === id)).toBe(false);

    const restored = await apiJson<AnnouncementEnvelope>(page.request, {
      method: 'PATCH',
      path: `/api/admin/announcements/${id}`,
      body: { hiddenAt: null },
    });
    expect(restored.status).toBe(200);
    expect(restored.json.data.status).toBe('PUBLISHED');

    const visibleAgain = await apiJson<FeedEnvelope>(readerPage.request, {
      method: 'GET',
      path: '/api/announcements?pageSize=100',
    });
    expect(visibleAgain.json.data.some((row) => row.id === id)).toBe(true);
    await resident.close();
  });

  test('scheduled announcement appears after publishAt without any cron', async ({
    page,
    browser,
  }, testInfo) => {
    const { runId } = await readRunContext();
    const ns = workerNamespace(runId, testInfo.workerIndex);
    await loginAsAdmin(page);

    const resident = await provisionResidentWithRetry(page, browser, {
      runId,
      workerIndex: testInfo.workerIndex,
      stem: 'watcher',
      baseURL: process.env.TEST_BASE_URL ?? 'http://localhost:3000',
    });
    const watcherPage = resident.page;

    const title = `E2E-${ns} auto-visible notice`;
    const created = await apiJson<AnnouncementEnvelope>(page.request, {
      method: 'POST',
      path: '/api/admin/announcements',
      body: {
        title,
        body: `Auto-visible body ${ns}.`,
        publishAt: new Date(Date.now() + 3000).toISOString(),
        imageIds: [],
      },
    });
    expect(created.status).toBe(200);
    const id = created.json.data.id;

    const before = await apiJson<FeedEnvelope>(watcherPage.request, {
      method: 'GET',
      path: '/api/announcements?pageSize=100',
    });
    expect(before.json.data.some((row) => row.id === id)).toBe(false);

    await page.waitForTimeout(4000);

    const after = await apiJson<FeedEnvelope>(watcherPage.request, {
      method: 'GET',
      path: '/api/announcements?pageSize=100',
    });
    expect(after.status).toBe(200);
    expect(after.json.data.some((row) => row.id === id)).toBe(true);
    await resident.close();
  });
});
