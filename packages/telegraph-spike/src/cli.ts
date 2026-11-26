import console from 'node:console';
import process from 'node:process';
import { runTelegraphDryRunSpike } from './spike.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--execute')) {
    console.error('Refusing --execute: Phase 1 only permits --dry-run (zero spend).');
    process.exit(1);
  }

  const report = await runTelegraphDryRunSpike({
    txHash: '0x0000000000000000000000000000000000000000000000000000000000000001',
    chain: 'ethereum',
    maxBudgetUusdc: 50_000,
    dryRun: true,
  });

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('Spike failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
