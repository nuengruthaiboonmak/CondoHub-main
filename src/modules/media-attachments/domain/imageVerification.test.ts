import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  IMAGE_BYTE_CAP_DEFAULT,
  IMAGE_BYTE_CAP_SLIP,
  IMAGE_BYTE_CAPS,
  IMAGE_COUNT_CAPS,
} from '@/config/imageLimits';
import {
  detectMimeFromMagic,
  exceedsByteCap,
  extensionForMime,
  precheckCountAllows,
} from './imageVerification';
import {
  IMAGE_DECODE_PIXEL_LIMIT,
  verifyAndStripImage,
} from '../infrastructure/imageVerification';

describe('UT-UP-01 byte caps D09 decimal megabytes', () => {
  it('slip cap is exactly 10,000,000 and every other scope is exactly 5,000,000', () => {
    expect(IMAGE_BYTE_CAP_SLIP).toBe(10_000_000);
    expect(IMAGE_BYTE_CAP_DEFAULT).toBe(5_000_000);
    expect(IMAGE_BYTE_CAPS).toEqual({
      PAYMENT_SLIP: 10_000_000,
      PAYMENT_QR: 5_000_000,
      MAINTENANCE: 5_000_000,
      ANNOUNCEMENT: 5_000_000,
      CHAT: 5_000_000,
    });
  });

  it('slip accepts exactly 10,000,000 bytes and rejects 10,000,001', () => {
    expect(exceedsByteCap(10_000_000, IMAGE_BYTE_CAPS.PAYMENT_SLIP)).toBe(false);
    expect(exceedsByteCap(10_000_001, IMAGE_BYTE_CAPS.PAYMENT_SLIP)).toBe(true);
  });

  it('every 5MB scope accepts exactly 5,000,000 bytes and rejects 5,000,001', () => {
    for (const scope of ['PAYMENT_QR', 'MAINTENANCE', 'ANNOUNCEMENT', 'CHAT'] as const) {
      expect(exceedsByteCap(5_000_000, IMAGE_BYTE_CAPS[scope])).toBe(false);
      expect(exceedsByteCap(5_000_001, IMAGE_BYTE_CAPS[scope])).toBe(true);
    }
  });
});

describe('UT-UP-01 magic byte detection for the jpeg/png/webp allowlist', () => {
  it('detects jpeg, png, and webp from magic bytes', () => {
    expect(detectMimeFromMagic(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))).toBe('image/jpeg');
    expect(
      detectMimeFromMagic(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])),
    ).toBe('image/png');
    expect(
      detectMimeFromMagic(
        Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe('image/webp');
  });

  it('rejects gif, svg text, fake bytes, truncated headers, and empty buffers', () => {
    expect(detectMimeFromMagic(Buffer.from('GIF89a', 'ascii'))).toBeNull();
    expect(detectMimeFromMagic(Buffer.from('<svg xmlns="x">', 'utf8'))).toBeNull();
    expect(detectMimeFromMagic(Buffer.from('this is not an image file at all'))).toBeNull();
    expect(detectMimeFromMagic(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectMimeFromMagic(Buffer.from([0x52, 0x49, 0x46, 0x46]))).toBeNull();
    expect(detectMimeFromMagic(Buffer.alloc(0))).toBeNull();
  });

  it('maps verified mime to canonical extensions', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg');
    expect(extensionForMime('image/png')).toBe('png');
    expect(extensionForMime('image/webp')).toBe('webp');
  });
});

describe('UT-UP-01 decode, safety, and the no-pixel-cap rule', () => {
  it('verifies real jpeg/png/webp bytes and strips metadata with dimensions', async () => {
    for (const format of ['jpeg', 'png', 'webp'] as const) {
      let pipeline = sharp({
        create: { width: 16, height: 12, channels: 3, background: '#3f6fbf' },
      });
      pipeline = format === 'png' ? pipeline.png() : format === 'webp' ? pipeline.webp() : pipeline.jpeg();
      const bytes = await pipeline.toBuffer();
      const verified = await verifyAndStripImage(bytes, IMAGE_BYTE_CAP_DEFAULT);
      expect(verified).not.toBe('UNREADABLE');
      expect(verified).not.toBe('UNSUPPORTED');
      if (verified === 'UNREADABLE' || verified === 'UNSUPPORTED') continue;
      expect(verified.width).toBe(16);
      expect(verified.height).toBe(12);
    }
  });

  it('fails safe on fake bytes, gif bytes, and over-cap buffers', async () => {
    expect(await verifyAndStripImage(Buffer.from('not an image'), IMAGE_BYTE_CAP_DEFAULT)).toBe(
      'UNREADABLE',
    );
    const gif = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#ff0000' },
    })
      .gif()
      .toBuffer();
    expect(await verifyAndStripImage(gif, IMAGE_BYTE_CAP_DEFAULT)).toBe('UNSUPPORTED');
    expect(await verifyAndStripImage(Buffer.alloc(IMAGE_BYTE_CAP_DEFAULT + 1), IMAGE_BYTE_CAP_DEFAULT)).toBe(
      'UNREADABLE',
    );
  });

  it('has no 24MP product ceiling: the pixel guard is a decompression-bomb backstop far above it', () => {
    expect(IMAGE_DECODE_PIXEL_LIMIT).toBeGreaterThan(24_000_000);
  });

  it('decodes a multi-megapixel image under the byte cap without a resolution rejection', async () => {
    const bytes = await sharp({
      create: { width: 2000, height: 1500, channels: 3, background: '#3f6fbf' },
    })
      .jpeg({ quality: 60 })
      .toBuffer();
    expect(bytes.length).toBeLessThanOrEqual(IMAGE_BYTE_CAP_DEFAULT);
    const verified = await verifyAndStripImage(bytes, IMAGE_BYTE_CAP_DEFAULT);
    expect(verified).not.toBe('UNREADABLE');
    expect(verified).not.toBe('UNSUPPORTED');
  });
});

describe('UT-UP-01 count pre-check and D09-1 cap table', () => {
  it('pre-check allows below max and denies at max', () => {
    expect(precheckCountAllows(0, 1)).toBe(true);
    expect(precheckCountAllows(4, 5)).toBe(true);
    expect(precheckCountAllows(1, 1)).toBe(false);
    expect(precheckCountAllows(5, 5)).toBe(false);
  });

  it('freezes every scope action cap: slip 1-required, QR/chat 0..1, ticket 0..5, comment 0..3, announcement 0..5', () => {
    expect(IMAGE_COUNT_CAPS).toEqual({
      SUBMIT_PAYMENT: { scope: 'PAYMENT_SLIP', min: 1, max: 1 },
      SAVE_PAYMENT_INSTRUCTION: { scope: 'PAYMENT_QR', min: 0, max: 1 },
      SEND_CHAT_MESSAGE: { scope: 'CHAT', min: 0, max: 1 },
      CREATE_TICKET: { scope: 'MAINTENANCE', min: 0, max: 5 },
      ADD_TICKET_COMMENT: { scope: 'MAINTENANCE', min: 0, max: 3 },
      PUBLISH_ANNOUNCEMENT: { scope: 'ANNOUNCEMENT', min: 0, max: 5 },
    });
  });
});
