import 'server-only';
import { PROJECT_TIMEZONE } from '@/config/project';
import { logger } from '@/shared/observability/logger';
import { db } from '@/shared/db/client';
import { currentYearMonth, isBillingCursorBehind } from '../domain/billingWindow';
import { latestDoneGenerateCycle } from './runGenerateInvoices';

export async function checkBillingCursorAtStartup(now: Date = new Date()): Promise<void> {
  try {
    const current = currentYearMonth(now, PROJECT_TIMEZONE);
    const lastDone = await latestDoneGenerateCycle(db);
    if (isBillingCursorBehind(current, lastDone)) {
      logger.warn({ current, lastDone }, 'billing cursor behind schedule');
    }
  } catch (error) {
    logger.warn({ error: String(error) }, 'billing startup cursor check skipped');
  }
}
