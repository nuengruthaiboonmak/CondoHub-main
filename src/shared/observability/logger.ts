import pino, { type LoggerOptions } from 'pino';

export const LOG_REDACT_PATHS = [
  '*.password',
  '*.tempPassword',
  '*.secret',
  '*.token',
  '*.sessionToken',
  '*.signedUrl',
  '*.presignedUrl',
  '*.uploadUrl',
  '*.url',
  '*.accountNumber',
  '*.bankAccountNumber',
  '*authorization*',
  '*cookie*',
  '*signedUrl*',
  '*presigned*',
  'DATABASE_URL',
  'MIGRATION_DATABASE_URL',
  'S3_SECRET_ACCESS_KEY',
  'BETTER_AUTH_SECRET',
  'JOB_TRIGGER_SECRET',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-job-secret"]',
  'res.headers["set-cookie"]',
];

export const LOG_REDACT_CENSOR = '[REDACTED]';

export function buildLoggerOptions(level?: string): LoggerOptions {
  return {
    level: level ?? process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    redact: {
      paths: LOG_REDACT_PATHS,
      censor: LOG_REDACT_CENSOR,
    },
    base: { service: 'condohub' },
  };
}

export type AppLogger = pino.Logger;

export const logger: AppLogger = pino(buildLoggerOptions());

export function childLogger(bindings: Record<string, unknown>): AppLogger {
  return logger.child(bindings);
}
