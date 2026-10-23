import { assertSeedAllowed, loadDotenv, parseRunId } from './seed-common';
import { runScenario } from './seed-scenario';

loadDotenv('.env.local');

async function main(): Promise<void> {
  assertSeedAllowed();
  const runId = parseRunId(process.argv.slice(2));
  await runScenario(runId);
}

void main();
