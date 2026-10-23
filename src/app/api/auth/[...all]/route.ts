import { toNextJsHandler } from 'better-auth/next-js';
import { auth } from '@/modules/identity-access/infrastructure/betterAuth';

export const { GET, POST } = toNextJsHandler(auth);
