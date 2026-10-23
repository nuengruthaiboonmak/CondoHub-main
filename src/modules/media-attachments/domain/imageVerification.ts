import type { AllowedImageContentType } from '@/shared/storage/presignedUrls';

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function startsWith(bytes: Buffer, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((value, index) => bytes[index] === value);
}

function isWebp(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

export function detectMimeFromMagic(bytes: Buffer): AllowedImageContentType | null {
  if (startsWith(bytes, JPEG_MAGIC)) return 'image/jpeg';
  if (startsWith(bytes, PNG_MAGIC)) return 'image/png';
  if (isWebp(bytes)) return 'image/webp';
  return null;
}

const MIME_EXTENSIONS: Record<AllowedImageContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function extensionForMime(mime: AllowedImageContentType): string {
  return MIME_EXTENSIONS[mime];
}

export function exceedsByteCap(sizeBytes: number, byteCap: number): boolean {
  return sizeBytes > byteCap;
}

export function canonicalObjectKey(objectKey: string, mime: string): string {
  if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') return objectKey;
  const dot = objectKey.lastIndexOf('.');
  const base = dot < 0 ? objectKey : objectKey.slice(0, dot);
  return `${base}.${MIME_EXTENSIONS[mime]}`;
}

export function precheckCountAllows(used: number, max: number): boolean {
  return used < max;
}
