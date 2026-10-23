import 'server-only';
import { withApi } from '@/shared/auth/withApi';
import { requireActiveActor } from '@/shared/auth/guards';
import { AppError } from '@/shared/utils/errors';
import { RATE_LIMIT_PRESETS } from '@/shared/utils/rateLimit';
import { isUuid } from '@/shared/utils/idempotency';
import { systemClock } from '@/shared/utils/clock';
import {
  createBillingCtx,
  editInvoiceTotal,
  getInvoice,
  invoiceEditBody,
  parseWithFieldErrors,
} from '@/modules/billing-payments/application/index';

export const GET = withApi(
  async (_request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || !isUuid(id)) {
      throw new AppError('VALIDATION_ERROR', 'The invoice id is invalid.');
    }
    const detail = await getInvoice(ctx.actor, id, systemClock.now());
    if (detail === null) throw new AppError('RESOURCE_NOT_FOUND');
    return detail;
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);

export const PATCH = withApi(
  async (request, ctx, route) => {
    requireActiveActor(ctx.actor);
    const params = await route?.params;
    const id = params?.id;
    if (id === undefined || !isUuid(id)) {
      throw new AppError('VALIDATION_ERROR', 'The invoice id is invalid.');
    }
    const body = parseWithFieldErrors(invoiceEditBody, await request.json());
    const billingCtx = createBillingCtx({ requestId: ctx.requestId });
    return editInvoiceTotal(
      ctx.actor,
      id,
      {
        total: body.total,
        expectedVersion: body.expectedVersion,
        ...(body.reason !== undefined ? { reason: body.reason } : {}),
      },
      billingCtx,
    );
  },
  { rateLimit: RATE_LIMIT_PRESETS.generalApi ?? { capacity: 300, windowMs: 60_000 } },
);
