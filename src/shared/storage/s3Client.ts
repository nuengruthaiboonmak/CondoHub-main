import { S3Client } from '@aws-sdk/client-s3';

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export function readS3Settings(env: NodeJS.ProcessEnv = process.env): S3Settings {
  return {
    endpoint: env.S3_ENDPOINT ?? '',
    region: env.S3_REGION ?? '',
    bucket: env.S3_BUCKET ?? '',
    accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
  };
}

export function createS3Client(settings: S3Settings): S3Client {
  return new S3Client({
    endpoint: settings.endpoint,
    region: settings.region,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
    forcePathStyle: true,
  });
}

let cached: S3Client | null = null;

export function getS3Client(): S3Client {
  if (cached !== null) return cached;
  cached = createS3Client(readS3Settings());
  return cached;
}

export function resetS3ClientForTests(): void {
  cached = null;
}
