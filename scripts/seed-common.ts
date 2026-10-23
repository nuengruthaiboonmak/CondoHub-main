export { loadDotenv } from '@/config/dotenv';

export function assertSeedAllowed(): void {
  if (process.env.SEED_ENABLED !== 'true') throw new Error('Refusing to seed: SEED_ENABLED is not true.');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production.');
}

export function parseRunId(argv: string[]): string {
  const flag = argv.indexOf('--run');
  const runId = flag >= 0 ? argv[flag + 1] : undefined;
  if (runId === undefined || runId === '') throw new Error('Missing required --run <RUN_ID>.');
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(runId)) throw new Error('Invalid RUN_ID format.');
  return runId;
}
