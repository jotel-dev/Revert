/**
 * Minimal reusable external integration example for REVERT + Telegraph.
 *
 * Defaults to zero-spend `--dry-run` mode:
 *   1. Builds & hashes a canonical Mode B conditional payment condition (`@revert/shared`).
 *   2. Inspects the live Telegraph `ONCHAIN_TX_LOOKUP_GENERAL` intent, miners, and HTTP 402
 *      challenge (`@revert/telegraph-client`), confirming spend caps without signing payment.
 *
 * To execute an actual bounded testnet purchase (explicit opt-in only):
 *   TELEGRAPH_ALLOW_LIVE_SPEND=true TELEGRAPH_PAYER_PRIVATE_KEY=0x... \
 *     node examples/telegraph-conditional-check.mjs --execute-live
 */
import console from 'node:console';
import process from 'node:process';
import {
  computeConditionHash,
  evaluateTxLookupPolicy,
  TELEGRAPH_INTENT_NAME,
} from '../packages/shared/dist/index.js';
import { TelegraphClient } from '../packages/telegraph-client/dist/index.js';

async function main() {
  const executeLive = process.argv.includes('--execute-live');

  // 1) Define an immutable conditional settlement policy matching RevertEscrow Mode B.
  const condition = {
    version: 1,
    intent: TELEGRAPH_INTENT_NAME,
    chain: 'ethereum',
    txHash: '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060',
    expectedTo: '0xa1e4380a3b1f749673e270229993ee55f45663b4',
    minValueEth: 0,
  };
  const conditionHash = computeConditionHash(condition);

  // 2) Instantiate TelegraphClient with strict per-request and aggregate USDC caps (6 decimals).
  const payerKey = process.env.TELEGRAPH_PAYER_PRIVATE_KEY?.trim();
  const client = new TelegraphClient({
    nodeUrl: process.env.TELEGRAPH_NODE_URL || 'https://devnode.telegraphprotocol.com',
    preferredRail: 'escrow',
    maxPerRequestUusdc: BigInt(process.env.MAX_PER_REQUEST_UUSDC || '100000'), // $0.10 USDC
    maxTotalBudgetUusdc: BigInt(process.env.MAX_TOTAL_BUDGET_UUSDC || '500000'), // $0.50 USDC
    privateKey: executeLive && payerKey ? payerKey : undefined,
  });

  const request = {
    intent: TELEGRAPH_INTENT_NAME,
    params: {
      tx_hash: condition.txHash,
      chain: condition.chain,
    },
    max_budget_usdc: 50_000,
  };

  if (!executeLive) {
    const dryRun = await client.dryRunAsk(request);
    console.log(
      JSON.stringify(
        {
          mode: dryRun.mode,
          conditionHash,
          minersCount: dryRun.minersCount,
          selectedRail: dryRun.inspection.selectedOption.scheme,
          selectedNetwork: dryRun.inspection.selectedOption.network,
          expectedMaxExpenditureUusdc: dryRun.expectedMaxExpenditureUusdc,
          paidExecuted: dryRun.paidExecuted,
        },
        null,
        2,
      ),
    );
    return;
  }

  if (process.env.TELEGRAPH_ALLOW_LIVE_SPEND !== 'true') {
    throw new Error('Set TELEGRAPH_ALLOW_LIVE_SPEND=true alongside --execute-live to spend funds.');
  }

  const purchase = await client.purchaseIntelligence(request, {
    idempotencyKey: `example-${conditionHash.slice(2, 14)}`,
    condition,
    verifySignal: true,
  });

  const verdict = evaluateTxLookupPolicy(
    condition,
    purchase.response,
    Boolean(purchase.signalVerification?.verified),
  );

  console.log(
    JSON.stringify(
      {
        conditionHash,
        observedCostUusdc: purchase.observedCostUusdc.toString(),
        receiptHash: purchase.receipt.receipt_hash,
        signalHash: purchase.response.signal_hash,
        decision: verdict.decision,
        reasons: verdict.reasons,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
