import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createUsernamePlugin } from './usernamePlugin';
import { nextCookies } from 'better-auth/next-js';
import { env } from '@/config/env';
import { db } from '@/shared/db/client';
import * as schema from './betterAuthSchema';

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.APP_BASE_URL],
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
    requireEmailVerificationOnSignUp: false,
  },
  plugins: [
    createUsernamePlugin(),
    nextCookies(),
  ],
  user: {
    additionalFields: {
      phone: { type: 'string', required: false },
      accountStatus: { type: 'string', required: true, defaultValue: 'ACTIVE', input: false },
      mustChangePassword: { type: 'boolean', required: true, defaultValue: true, input: false },
      isSystemAdmin: { type: 'boolean', required: true, defaultValue: false, input: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    customRules: {
      '/sign-in/*': { window: 60, max: 120 },
    },
  },
});

export type Auth = typeof auth;
