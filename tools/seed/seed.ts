import 'dotenv/config';
import { loadSeedConfig } from './seed-config';
import { seedDown } from './seed-down';
import { seedUp } from './seed-up';

const USAGE = 'Usage: tsx tools/seed/seed.ts up|down';

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command !== 'up' && command !== 'down') {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const config = loadSeedConfig();
  if (command === 'up') {
    await seedUp(config);
  } else {
    await seedDown(config);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
