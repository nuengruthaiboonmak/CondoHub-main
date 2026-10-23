import 'server-only';
import { z } from 'zod';

function emptyStringToUndefined(value: unknown): unknown {
  return value === '' ? undefined : value;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_BASE_URL: z.string().url(),
  BETTER_AUTH_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  MIGRATION_DATABASE_URL: z.preprocess(emptyStringToUndefined, z.string().startsWith('postgresql://').optional()),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.preprocess(emptyStringToUndefined, z.string().min(1).optional()),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  JOB_TRIGGER_SECRET: z.string().min(32),
  PROJECT_TIMEZONE: z.string().min(1).default('Asia/Bangkok'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('debug'),
  SEED_ENABLED: z
    .string()
    .optional()
    .transform((value) => value === 'true'),
});

export type AppEnv = z.infer<typeof envSchema>;

function loadEnv(): AppEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${missing}`);
  }
  return parsed.data;
}

export const env: AppEnv = loadEnv();

export function migrationConnectionString(): string {
  return env.MIGRATION_DATABASE_URL ?? env.DATABASE_URL;
}
