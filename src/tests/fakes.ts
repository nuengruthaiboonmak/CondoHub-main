import type { Clock } from '../shared/utils/clock';
import type { SignedUrl } from '../shared/storage/presignedUrls';

export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date | string = new Date()) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(at: Date | string): void {
    this.current = new Date(at);
  }

  advanceByMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export const fakeClock = (start?: Date | string): FakeClock => new FakeClock(start);

export interface FakeUuidOptions {
  prefix?: string;
}

let fakeUuidCounter = 0;

export function fakeUuid(opts?: FakeUuidOptions): string {
  fakeUuidCounter += 1;
  const suffix = fakeUuidCounter.toString(16).padStart(12, '0');
  const group = (opts?.prefix ?? '00000000').slice(0, 8).padStart(8, '0');
  return `${group}-0000-4000-8000-${suffix}`;
}

export function resetFakeUuidCounter(): void {
  fakeUuidCounter = 0;
}

export type LogCall = { level: string; payload: unknown };

export class FakeLogger {
  calls: LogCall[] = [];

  debug(payload: unknown): void {
    this.calls.push({ level: 'debug', payload });
  }

  info(payload: unknown): void {
    this.calls.push({ level: 'info', payload });
  }

  warn(payload: unknown): void {
    this.calls.push({ level: 'warn', payload });
  }

  error(payload: unknown): void {
    this.calls.push({ level: 'error', payload });
  }

  child(): FakeLogger {
    return this;
  }

  reset(): void {
    this.calls = [];
  }
}

export interface FakeStoragePort {
  uploads: Map<string, { contentType: string; sizeBytes: number }>;
  createUploadUrl(objectKey: string, contentType: string): Promise<SignedUrl>;
  createReadUrl(objectKey: string): Promise<SignedUrl>;
  headObject(objectKey: string): Promise<{ sizeBytes: number; contentType: string } | null>;
  deleteObject(objectKey: string): Promise<void>;
}

export function fakeStoragePort(): FakeStoragePort {
  const uploads = new Map<string, { contentType: string; sizeBytes: number }>();
  return {
    uploads,
    createUploadUrl: async (objectKey: string, contentType: string) => {
      uploads.set(objectKey, { contentType, sizeBytes: 0 });
      return { url: `https://s3.invalid/upload/${objectKey}`, expiresAt: new Date() };
    },
    createReadUrl: async (objectKey: string) => ({
      url: `https://s3.invalid/read/${objectKey}`,
      expiresAt: new Date(),
    }),
    headObject: async (objectKey: string) => uploads.get(objectKey) ?? null,
    deleteObject: async (objectKey: string) => {
      uploads.delete(objectKey);
    },
  };
}

export interface FakeSocketPublisher {
  published: Array<{ roomId: string; messageId: string; createdAt: string }>;
  kicked: Array<{ roomId: string; userId: string }>;
}

export function fakeSocketPublisher(): FakeSocketPublisher {
  return { published: [], kicked: [] };
}

export interface FakeActor {
  userId: string;
  isSystemAdmin: boolean;
  accountStatus: 'ACTIVE' | 'SUSPENDED';
  mustChangePassword: boolean;
}

export function fakeActor(overrides?: Partial<FakeActor>): FakeActor {
  return {
    userId: fakeUuid(),
    isSystemAdmin: false,
    accountStatus: 'ACTIVE',
    mustChangePassword: false,
    ...overrides,
  };
}
