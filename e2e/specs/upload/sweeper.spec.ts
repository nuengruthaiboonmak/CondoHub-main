import { expect, test } from '@playwright/test';
import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { apiJson } from '../../helpers/api';
import { readRunContext } from '../../fixtures/run-context';
import { loginAsPoolAdmin } from '../../helpers/owner';

interface SweepEnvelope {
  data: { created: number; skipped: number; reviewRequired: number; caughtUp: boolean };
}

interface FeedEnvelope {
  data: Array<{ id: string; title: string; images: Array<{ id: string }> }>;
}

interface AccessEnvelope {
  data: { url: string; expiresAt: string };
}

function jobSecret(): string {
  const value = process.env.JOB_TRIGGER_SECRET;
  if (value === undefined || value === '') {
    throw new Error('Sweeper E2E needs the JOB_TRIGGER_SECRET env var.');
  }
  return value;
}

function s3Client(): { client: S3Client; bucket: string } {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (
    endpoint === undefined ||
    region === undefined ||
    bucket === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined
  ) {
    throw new Error('Sweeper E2E needs the S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY env vars.');
  }
  return {
    client: new S3Client({
      endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    }),
    bucket,
  };
}

async function objectExists(key: string): Promise<boolean> {
  const { client, bucket } = s3Client();
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

test.describe('orphan sweeper: job auth, lease, grace transitions, X8 skip, attached-never', () => {
  test.setTimeout(180000);

  test('job auth: missing and wrong secrets get identical 401s, GET is rejected', async ({
    page,
  }) => {
    await loginAsPoolAdmin(page, 'sweeper');

    const missing = await page.request.fetch('/api/internal/jobs/sweep-orphans', {
      method: 'POST',
      data: { triggerSource: 'MANUAL' },
      headers: { 'content-type': 'application/json' },
    });
    expect(missing.status()).toBe(401);
    const missingJson = (await missing.json()) as { error: { code: string } };
    expect(missingJson.error.code).toBe('AUTH_REQUIRED');

    const wrong = await page.request.fetch('/api/internal/jobs/sweep-orphans', {
      method: 'POST',
      data: { triggerSource: 'MANUAL' },
      headers: { 'content-type': 'application/json', 'x-job-secret': 'wrong-secret-value-000000000000' },
    });
    expect(wrong.status()).toBe(401);
    const wrongJson = (await wrong.json()) as { error: { code: string } };
    expect(wrongJson.error.code).toBe(missingJson.error.code);

    const get = await page.request.fetch('/api/internal/jobs/sweep-orphans', { method: 'GET' });
    expect(get.status()).toBe(405);
  });

  test('trigger body is strict: unknown triggerSource is a 400', async ({ page }) => {
    await loginAsPoolAdmin(page, 'sweeper');
    const response = await apiJson<unknown>(page.request, {
      method: 'POST',
      path: '/api/internal/jobs/sweep-orphans',
      headers: { 'x-job-secret': jobSecret() },
      body: { triggerSource: 'WHENEVER' },
    });
    expect(response.status).toBe(400);
  });

  test('sweep transitions aged fixtures, skips young e2e keys, and is idempotent', async ({
    page,
  }) => {
    const { runId } = await readRunContext();
    await loginAsPoolAdmin(page, 'sweeper');

    const agedPendingKey = `e2e/${runId}/chat/sweep-aged-pending.png`;
    const agedReadyKey = `e2e/${runId}/maintenance/sweep-aged-ready.png`;
    const youngSkippedKey = `e2e/${runId}/chat/sweep-stale-pending.png`;
    expect(await objectExists(agedPendingKey)).toBe(true);
    expect(await objectExists(agedReadyKey)).toBe(true);

    const first = await apiJson<SweepEnvelope>(page.request, {
      method: 'POST',
      path: '/api/internal/jobs/sweep-orphans',
      headers: { 'x-job-secret': jobSecret() },
      body: { triggerSource: 'MANUAL' },
    });
    expect(first.status).toBe(200);
    expect(first.json.data.created).toBe(0);
    expect(first.json.data.caughtUp).toBe(true);
    expect(first.json.data.reviewRequired).toBeGreaterThanOrEqual(2);
    expect(first.json.data.skipped).toBeGreaterThanOrEqual(1);

    expect(await objectExists(agedPendingKey)).toBe(false);
    expect(await objectExists(agedReadyKey)).toBe(false);
    expect(await objectExists(youngSkippedKey)).toBe(true);

    const second = await apiJson<SweepEnvelope>(page.request, {
      method: 'POST',
      path: '/api/internal/jobs/sweep-orphans',
      headers: { 'x-job-secret': jobSecret() },
      body: { triggerSource: 'MANUAL' },
    });
    expect(second.status).toBe(200);
    expect(second.json.data.reviewRequired).toBe(0);
    expect(second.json.data.skipped).toBeGreaterThanOrEqual(1);
  });

  test('attached control survives the sweep and still serves its image', async ({ page }) => {
    const { runId } = await readRunContext();
    await loginAsPoolAdmin(page, 'sweeper');

    const sweep = await apiJson<SweepEnvelope>(page.request, {
      method: 'POST',
      path: '/api/internal/jobs/sweep-orphans',
      headers: { 'x-job-secret': jobSecret() },
      body: { triggerSource: 'MANUAL' },
    });
    expect(sweep.status).toBe(200);

    const feed = await apiJson<FeedEnvelope>(page.request, {
      method: 'GET',
      path: '/api/announcements?page=1&pageSize=100',
    });
    expect(feed.status).toBe(200);
    const control = feed.json.data.find((row) => row.title === `E2E-${runId} sweep control notice`);
    expect(control).toBeDefined();
    if (control === undefined) return;
    expect(control.images).toHaveLength(1);
    const imageId = control.images[0]?.id;
    expect(imageId).toBeDefined();
    if (imageId === undefined) return;

    const access = await apiJson<AccessEnvelope>(page.request, {
      method: 'GET',
      path: `/api/images/${imageId}/access`,
    });
    expect(access.status).toBe(200);
    expect(access.json.data.url).toContain('http');
    expect(await objectExists(`e2e/${runId}/announcement/sweep-attached-control.png`)).toBe(true);
  });
});
