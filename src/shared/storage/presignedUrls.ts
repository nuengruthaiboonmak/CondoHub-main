import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppError } from '../utils/errors';
import { getS3Client, readS3Settings } from './s3Client';

export const PRESIGNED_URL_TTL_SECONDS = 300;

export const ALLOWED_IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedImageContentType = (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number];

export interface SignedUrl {
  url: string;
  expiresAt: Date;
}

export interface ObjectHead {
  sizeBytes: number;
  contentType: string;
}

export function isAllowedImageContentType(value: unknown): value is AllowedImageContentType {
  return (
    typeof value === 'string' &&
    (ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(value)
  );
}

export interface PresignedUrlDeps {
  client?: S3Client;
  bucket?: string;
}

function resolveDeps(deps?: PresignedUrlDeps): { client: S3Client; bucket: string } {
  return {
    client: deps?.client ?? getS3Client(),
    bucket: deps?.bucket ?? readS3Settings().bucket,
  };
}

export async function createUploadUrl(
  objectKey: string,
  contentType: AllowedImageContentType,
  maxBytes: number,
  deps?: PresignedUrlDeps,
): Promise<SignedUrl> {
  if (!isAllowedImageContentType(contentType)) {
    throw new AppError('FILE_NOT_ALLOWED', undefined);
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 1) {
    throw new AppError('VALIDATION_ERROR', 'The max upload size is invalid.');
  }
  const { client, bucket } = resolveDeps(deps);
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      ContentType: contentType,
    }),
    { expiresIn: PRESIGNED_URL_TTL_SECONDS },
  );
  return { url, expiresAt: new Date(Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000) };
}

export async function createReadUrl(
  objectKey: string,
  deps?: PresignedUrlDeps,
): Promise<SignedUrl> {
  const { client, bucket } = resolveDeps(deps);
  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
    { expiresIn: PRESIGNED_URL_TTL_SECONDS },
  );
  return { url, expiresAt: new Date(Date.now() + PRESIGNED_URL_TTL_SECONDS * 1000) };
}

export async function headObject(
  objectKey: string,
  deps?: PresignedUrlDeps,
): Promise<ObjectHead | null> {
  const { client, bucket } = resolveDeps(deps);
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
    return {
      sizeBytes: head.ContentLength ?? 0,
      contentType: head.ContentType ?? 'application/octet-stream',
    };
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export async function deleteObject(objectKey: string, deps?: PresignedUrlDeps): Promise<void> {
  const { client, bucket } = resolveDeps(deps);
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
}

export async function getObjectBytes(
  objectKey: string,
  deps?: PresignedUrlDeps,
): Promise<Buffer | null> {
  const { client, bucket } = resolveDeps(deps);
  try {
    const output = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    if (output.Body === undefined) return null;
    const chunks: Buffer[] = [];
    const body = output.Body as AsyncIterable<Uint8Array>;
    for await (const chunk of body) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

export async function putObjectBytes(
  objectKey: string,
  bytes: Buffer,
  contentType: AllowedImageContentType,
  deps?: PresignedUrlDeps,
): Promise<void> {
  const { client, bucket } = resolveDeps(deps);
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: bytes,
      ContentType: contentType,
      ContentLength: bytes.length,
    }),
  );
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as Record<string, unknown>;
  if (record.name === 'NotFound') return true;
  const metadata = record.$metadata as Record<string, unknown> | undefined;
  return metadata?.httpStatusCode === 404;
}
