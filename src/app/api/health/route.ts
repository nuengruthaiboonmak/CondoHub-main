import 'server-only';
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { env } from '@/config/env';
import { db } from '@/shared/db/client';
import { getS3Client } from '@/shared/storage/s3Client';

const execFileAsync = promisify(execFile);

let cachedVersion: string | null = null;
let s3Cache: { at: number; status: 'up' | 'down' } | null = null;

async function resolveVersion(): Promise<string> {
  if (cachedVersion !== null) return cachedVersion;
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD']);
    cachedVersion = stdout.trim();
  } catch {
    cachedVersion = 'unknown';
  }
  return cachedVersion;
}

async function checkDb(): Promise<'up' | 'down'> {
  try {
    await db.execute(sql`SELECT 1`);
    return 'up';
  } catch {
    return 'down';
  }
}

async function checkS3(): Promise<'up' | 'down' | 'unknown'> {
  if (env.S3_BUCKET === undefined) return 'unknown';
  const now = Date.now();
  if (s3Cache !== null && now - s3Cache.at < 30_000) return s3Cache.status;
  try {
    await getS3Client().send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
    s3Cache = { at: now, status: 'up' };
  } catch {
    s3Cache = { at: now, status: 'down' };
  }
  return s3Cache.status;
}

export async function GET(): Promise<NextResponse> {
  const [version, database, s3] = await Promise.all([resolveVersion(), checkDb(), checkS3()]);
  const status = database === 'up' && s3 !== 'down' ? 'ok' : 'degraded';
  const body = {
    data: {
      status,
      version,
      uptime: Math.floor(process.uptime()),
      now: new Date().toISOString(),
      checks: { db: database, s3 },
    },
  };
  return NextResponse.json(body, { status: database === 'up' ? 200 : 503 });
}
