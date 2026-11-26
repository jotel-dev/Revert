import { TELEGRAPH_INTENT_NAME } from '@revert/shared';
import { z } from 'zod';
import {
  assertWithinBudget,
  DEFAULT_BUDGET_POLICY,
  parsePaymentRequiredHeader,
  selectPreferredAccept,
  type BudgetPolicy,
  type PaymentAcceptOption,
} from './challenge.js';

const intentSchemaResponse = z.object({
  intent_name: z.string(),
  class: z.string().optional(),
  miner_count: z.number().int().nonnegative(),
  request: z
    .object({
      params: z.array(z.object({ name: z.string(), type: z.string() })),
    })
    .nullable(),
  response: z
    .object({
      fields: z.array(z.object({ name: z.string(), type: z.string() })),
    })
    .nullable(),
  onchain: z
    .object({
      ready: z.boolean(),
    })
    .optional(),
});

const minersResponseSchema = z.object({
  miners: z.array(
    z.object({
      id: z.union([z.string(), z.number()]).transform(String),
      slug: z.string().optional(),
      name: z.string().optional(),
    }),
  ),
});

export interface SpikeOptions {
  nodeUrl?: string;
  txHash: string;
  chain: string;
  maxBudgetUusdc?: number;
  dryRun?: boolean;
  budgetPolicy?: BudgetPolicy;
  fetchImpl?: typeof fetch;
}

export interface DryRunReport {
  mode: 'DRY_RUN';
  timestamp: string;
  nodeUrl: string;
  intent: {
    name: string;
    class?: string | undefined;
    minerCount: number;
    onchainReady: boolean;
    requestParams: string[];
    responseFields: string[];
  };
  discoveredMinersCount: number;
  sampleMiners: Array<{ id: string; slug?: string | undefined; name?: string | undefined }>;
  challengeStatus: number;
  acceptedOptionsCount: number;
  selectedOption: PaymentAcceptOption;
  budgetCheckPassed: boolean;
  quotedAmountUusdc: string;
  paidExecuted: false;
}

export async function runTelegraphDryRunSpike(options: SpikeOptions): Promise<DryRunReport> {
  if (options.dryRun === false) {
    throw new Error('Live execution is disabled in Phase 1 spike; owner approval required.');
  }

  const fetchFn = options.fetchImpl ?? fetch;
  const nodeUrl = (options.nodeUrl ?? 'https://devnode.telegraphprotocol.com').replace(/\/$/, '');
  const maxBudgetUusdc = options.maxBudgetUusdc ?? 50_000;
  const budgetPolicy = options.budgetPolicy ?? DEFAULT_BUDGET_POLICY;

  // 1. Inspect canonical Intent schema
  const intentRes = await fetchFn(`${nodeUrl}/engine/v1/intents/${TELEGRAPH_INTENT_NAME}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!intentRes.ok) {
    throw new Error(`Failed to fetch intent schema: HTTP ${intentRes.status}`);
  }
  const intentData = intentSchemaResponse.parse(await intentRes.json());
  if (intentData.miner_count === 0 || !intentData.request || !intentData.response) {
    throw new Error(`Intent ${TELEGRAPH_INTENT_NAME} has no live miners or schema`);
  }

  // 2. Discover live miners serving the Intent
  const minersRes = await fetchFn(`${nodeUrl}/engine/v1/intents/${TELEGRAPH_INTENT_NAME}/miners`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!minersRes.ok) {
    throw new Error(`Failed to fetch miners for intent: HTTP ${minersRes.status}`);
  }
  const minersData = minersResponseSchema.parse(await minersRes.json());

  // 3. Probe unpaid POST /engine/v1/ask to inspect live 402 payment challenge
  const askRes = await fetchFn(`${nodeUrl}/engine/v1/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: TELEGRAPH_INTENT_NAME,
      params: { tx_hash: options.txHash, chain: options.chain },
      max_budget_usdc: maxBudgetUusdc,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (askRes.status !== 402) {
    throw new Error(`Expected HTTP 402 payment challenge in dry-run, got ${askRes.status}`);
  }

  const prHeader = askRes.headers.get('payment-required');
  if (!prHeader) {
    throw new Error('Missing PAYMENT-REQUIRED header in 402 response');
  }

  const challenge = parsePaymentRequiredHeader(prHeader);
  const selectedOption = selectPreferredAccept(challenge, 'escrow', 'eip155:11155111');
  assertWithinBudget(BigInt(selectedOption.amount), budgetPolicy);

  return {
    mode: 'DRY_RUN',
    timestamp: new Date().toISOString(),
    nodeUrl,
    intent: {
      name: intentData.intent_name,
      class: intentData.class,
      minerCount: intentData.miner_count,
      onchainReady: intentData.onchain?.ready ?? false,
      requestParams: intentData.request.params.map((p) => `${p.name}:${p.type}`),
      responseFields: intentData.response.fields.map((f) => `${f.name}:${f.type}`),
    },
    discoveredMinersCount: minersData.miners.length,
    sampleMiners: minersData.miners.slice(0, 5),
    challengeStatus: askRes.status,
    acceptedOptionsCount: challenge.accepts.length,
    selectedOption,
    budgetCheckPassed: true,
    quotedAmountUusdc: selectedOption.amount,
    paidExecuted: false,
  };
}
