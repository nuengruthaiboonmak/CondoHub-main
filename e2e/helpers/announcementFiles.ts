import sharp from 'sharp';

export type FixtureImageFormat = 'jpeg' | 'png' | 'webp';

export interface FixtureImage {
  fileName: string;
  contentType: string;
  bytes: Buffer;
}

const CONTENT_TYPES: Record<FixtureImageFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export async function buildValidImage(
  format: FixtureImageFormat,
  size = 64,
): Promise<FixtureImage> {
  let pipeline = sharp({
    create: { width: size, height: size, channels: 3, background: '#3f6fbf' },
  });
  if (format === 'png') pipeline = pipeline.png();
  else if (format === 'webp') pipeline = pipeline.webp();
  else pipeline = pipeline.jpeg({ quality: 90 });
  const bytes = await pipeline.toBuffer();
  const extension = format === 'jpeg' ? 'jpg' : format;
  return { fileName: `valid.${extension}`, contentType: CONTENT_TYPES[format], bytes };
}

export function buildFakeImage(): FixtureImage {
  return {
    fileName: 'fake.jpg',
    contentType: 'image/jpeg',
    bytes: Buffer.from('this is not an image file at all, just text bytes'),
  };
}
