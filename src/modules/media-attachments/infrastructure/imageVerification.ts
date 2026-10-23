import sharp from 'sharp';
import type { AllowedImageContentType } from '@/shared/storage/presignedUrls';

export interface VerifiedImage {
  bytes: Buffer;
  mime: AllowedImageContentType;
  width: number | null;
  height: number | null;
}

export const IMAGE_DECODE_PIXEL_LIMIT = 268_435_456;

export const IMAGE_DECODE_TIMEOUT_SECONDS = 10;

export type ImageDecodeFailure = 'UNREADABLE' | 'UNSUPPORTED';

export async function verifyAndStripImage(
  bytes: Buffer,
  byteCap: number,
): Promise<VerifiedImage | ImageDecodeFailure> {
  if (bytes.length > byteCap) return 'UNREADABLE';
  try {
    const pipeline = sharp(bytes, { limitInputPixels: IMAGE_DECODE_PIXEL_LIMIT }).timeout({
      seconds: IMAGE_DECODE_TIMEOUT_SECONDS,
    });
    const metadata = await pipeline.metadata();
    const format = metadata.format;
    if (format !== 'jpeg' && format !== 'png' && format !== 'webp') return 'UNSUPPORTED';
    const mime: AllowedImageContentType =
      format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
    const output = await pipeline.rotate().toBuffer();
    return {
      bytes: output,
      mime,
      width: metadata.width ?? null,
      height: metadata.height ?? null,
    };
  } catch {
    return 'UNREADABLE';
  }
}
