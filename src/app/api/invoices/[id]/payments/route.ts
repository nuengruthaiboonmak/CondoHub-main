import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { isUuid } from '@/shared/utils/idempotency';
import { systemClock } from '@/shared/utils/clock';
import {
  getPaymentInstruction,
  listInvoiceRevisions,
  listPaymentSubmissions,
} from '@/modules/billing-payments/application/index';

function assertInvoiceId(id: string | undefined): string {
  if (id === undefined || !isUuid(id)) {
    throw new AppError('VALIDATION_ERROR', 'The invoice id is invalid.');
  }
  return id;
}

export const GET = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const url = new URL(request.url);
    const id = assertInvoiceId(params?.id);
    const view = url.searchParams.get('view');
    if (view === 'revisions') {
      return { revisions: await listInvoiceRevisions(ctx.actor, id, systemClock.now()) };
    }
    if (view === 'instruction') {
      const instruction = await getPaymentInstruction(ctx.actor, id, systemClock.now());
      if (instruction === null) throw new AppError('RESOURCE_NOT_FOUND');
      return { instruction };
    }
    if (view !== null) {
      throw new AppError('VALIDATION_ERROR', 'The view parameter is invalid.');
    }
    return { submissions: await listPaymentSubmissions(ctx.actor, id, systemClock.now()) };
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
