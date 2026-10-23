import { afterEach } from 'vitest';
import { resetFakeUuidCounter } from './fakes';
import { resetS3ClientForTests } from '../shared/storage/s3Client';
import { sharedRateLimiter } from '../shared/utils/rateLimit';

afterEach(() => {
  resetFakeUuidCounter();
  resetS3ClientForTests();
  sharedRateLimiter.resetAll();
});
