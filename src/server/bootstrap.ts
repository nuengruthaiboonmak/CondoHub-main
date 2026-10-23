import { createServer } from 'node:http';
import next from 'next';
import { env } from '@/config/env';
import { logger } from '@/shared/observability/logger';
import { attachSocket } from './socket';
import {
  createSocketRevokeFanOut,
  setRevokeFanOut,
} from '@/modules/identity-access/infrastructure/revokeFanOut';
import { wireRoomProvisioningPorts } from '@/modules/property-membership/application/index';
import { wireAnnouncementScopeAcl } from '@/modules/announcements/application/index';
import { wireMaintenanceScopeAcl } from '@/modules/maintenance/application/index';
import { authorizeRoomJoin, wireChatScopeAcl } from '@/modules/room-chat/application/index';
import {
  createSocketChatFanOut,
  setChatSignalFanOut,
} from '@/modules/room-chat/infrastructure/chatFanOut';
import { checkBillingCursorAtStartup } from '@/modules/billing-payments/application/index';

const app = next({ dev: env.NODE_ENV !== 'production' });
const handler = app.getRequestHandler();

async function main(): Promise<void> {
  await app.prepare();
  const httpServer = createServer((req, res) => {
    void handler(req, res);
  });
  const io = attachSocket(httpServer, authorizeRoomJoin);
  setRevokeFanOut(createSocketRevokeFanOut(io));
  setChatSignalFanOut(createSocketChatFanOut(io));
  wireRoomProvisioningPorts();
  wireAnnouncementScopeAcl();
  wireMaintenanceScopeAcl();
  wireChatScopeAcl();
  void checkBillingCursorAtStartup();
  httpServer.listen(env.PORT, '0.0.0.0', () => {
    logger.info({ port: env.PORT }, 'server listening');
  });
  const shutdown = (): void => {
    logger.info('shutdown signal received');
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

void main();
