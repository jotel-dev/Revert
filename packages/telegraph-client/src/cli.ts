import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { TELEGRAPH_INTENT_NAME, type ConditionalTxCondition } from '@revert/shared';
import { TelegraphClient } from './client.js';
import { sanitizeForLog } from './logger.js';

function loadDotEnvIfPresent(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line
      .slice(eqIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

async function main() {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  loadDotEnvIfPresent(path.join(repoRoot, '.env'));

  const args = process.argv.slice(2);
  const executeLive = args.includes('--execute');
  const railEnv = process.env.TELEGRAPH_PAYMENT_RAIL === 'exact' ? 'exact' : 'escrow';
  const networkEnv = railEnv === 'exact' ? 'eip155:84532' : 'eip155:11155111';

  const maxPerReq = BigInt(process.env.MAX_PER_REQUEST_UUSDC || '100000');
  const maxTotal = BigInt(process.env.MAX_TOTAL_BUDGET_UUSDC || '2000000');

  const rawKey = process.env.TELEGRAPH_PAYER_PRIVATE_KEY?.trim();
  const privateKey =
    rawKey && /^0x[a-fA-F0-9]{64}$/.test(rawKey) ? (rawKey as `0x${string}`) : undefined;

  // Public Ethereum mainnet transaction (Uniswap/ENS/standard reference tx, zero PII)
  const sampleCondition: ConditionalTxCondition = {
    version: 1,
    intent: TELEGRAPH_INTENT_NAME,
    chain: 'ethereum',
    txHash: '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060',
    expectedTo: '0xa1e4380a3b1f749673e270229993ee55f45663b4',
    minValueEth: 0,
  };

  const client = new TelegraphClient({
    nodeUrl: process.env.TELEGRAPH_NODE_URL || 'https://devnode.telegraphprotocol.com',
    preferredRail: railEnv,
    preferredNetwork: networkEnv,
    maxPerRequestUusdc: maxPerReq,
    maxTotalBudgetUusdc: maxTotal,
    privateKey,
    evidenceDir: path.join(repoRoot, 'evidence', 'live-purchases'),
    ledgerPersistPath: path.join(repoRoot, '.revert-spend-ledger.json'),
  });

  if (!executeLive) {
    const dryRun = await client.dryRunAsk({
      intent: TELEGRAPH_INTENT_NAME,
      params: { tx_hash: sampleCondition.txHash, chain: sampleCondition.chain },
      max_budget_usdc: 50_000,
    });
    console.log(
      JSON.stringify(
        sanitizeForLog({
          ...dryRun,
          budgetSummary: {
            maxPerRequestUusdc: dryRun.budgetSummary.maxPerRequestUusdc.toString(),
            maxTotalBudgetUusdc: dryRun.budgetSummary.maxTotalBudgetUusdc.toString(),
            reservedUusdc: dryRun.budgetSummary.reservedUusdc.toString(),
            committedUusdc: dryRun.budgetSummary.committedUusdc.toString(),
            remainingUusdc: dryRun.budgetSummary.remainingUusdc.toString(),
          },
          maxAuthorizedUusdc: dryRun.inspection.maxAuthorizedUusdc.toString(),
        }),
        null,
        2,
      ),
    );
    return;
  }

  if (process.env.TELEGRAPH_ALLOW_LIVE_SPEND !== 'true') {
    console.error(
      'Refusing live execution: set TELEGRAPH_ALLOW_LIVE_SPEND=true in local environment after explicit owner approval.',
    );
    process.exit(1);
  }
  if (!privateKey) {
    console.error(
      'Refusing live execution: configure disposable TELEGRAPH_PAYER_PRIVATE_KEY locally in .env.',
    );
    process.exit(1);
  }

  const walletAddress = client.getWalletAddress()!;
  const escrowAccount = await client.getEscrowAccount(walletAddress);
  console.log(
    JSON.stringify({
      walletAddress,
      telegraphEscrowAvailableUusdc: escrowAccount.available,
      rail: railEnv,
    }),
  );

  const idempotencyKey = `revert-phase2-${Date.now()}`;
  const purchase = await client.purchaseIntelligence(
    {
      intent: TELEGRAPH_INTENT_NAME,
      params: { tx_hash: sampleCondition.txHash, chain: sampleCondition.chain },
      max_budget_usdc: 10_000, // Smallest meaningful request: $0.01
    },
    {
      idempotencyKey,
      condition: sampleCondition,
      verifySignal: true,
    },
  );

  console.log(
    JSON.stringify(
      sanitizeForLog({
        ...purchase,
        maxAuthorizedUusdc: purchase.maxAuthorizedUusdc.toString(),
        observedCostUusdc: purchase.observedCostUusdc.toString(),
      }),
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('Telegraph CLI error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
