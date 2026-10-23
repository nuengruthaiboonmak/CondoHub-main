import { randomBytes } from 'node:crypto';

export type TestImageKind = 'jpeg' | 'png' | 'webp' | 'corrupt' | 'oversized';

export interface TestImage {
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

const MAGIC: Record<Exclude<TestImageKind, 'corrupt' | 'oversized'>, Buffer> = {
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  webp: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
};

export function buildTestImage(kind: TestImageKind, sizeBytes: number): TestImage {
  if (!Number.isInteger(sizeBytes) || sizeBytes < 8) {
    throw new Error('Test image size must be an integer of at least 8 bytes.');
  }
  if (kind === 'corrupt') {
    return { fileName: 'corrupt.jpg', contentType: 'image/jpeg', bytes: randomBytes(sizeBytes) };
  }
  if (kind === 'oversized') {
    return {
      fileName: 'oversized.jpg',
      contentType: 'image/jpeg',
      bytes: Buffer.concat([MAGIC.jpeg, randomBytes(sizeBytes - MAGIC.jpeg.length)]),
    };
  }
  const magic = MAGIC[kind];
  const contentType = kind === 'jpeg' ? 'image/jpeg' : kind === 'png' ? 'image/png' : 'image/webp';
  return {
    fileName: `valid.${kind === 'jpeg' ? 'jpg' : kind}`,
    contentType,
    bytes: Buffer.concat([magic, randomBytes(sizeBytes - magic.length)]),
  };
}
