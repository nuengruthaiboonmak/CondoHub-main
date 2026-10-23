import { assertSeedAllowed, loadDotenv, parseRunId } from './seed-common';

loadDotenv('.env.local');

export async function runScenario(runId: string): Promise<void> {
  const { runPropertyScenario } = await import('./seed-scenario-body');
  await runPropertyScenario(runId);
}

async function main(): Promise<void> {
  assertSeedAllowed();
  const runId = parseRunId(process.argv.slice(2));
  await runScenario(runId);
}

const invokedAsScript = process.argv[1]?.replace(/\\/g, '/').endsWith('/scripts/seed-scenario.ts') === true;

if (invokedAsScript) {
  void main();
}
