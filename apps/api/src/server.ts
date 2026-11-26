import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRedactedLogger, TelegraphClient } from '@revert/telegraph-client';
import { createApp } from './app.js';
import { Eip712SettlementAttestor } from './attestor.js';
import { VerificationEngine } from './engine.js';
import { ViemEscrowChainGateway } from './escrow-chain.js';
import { ViemIndependentRpcVerifier } from './independent-rpc.js';
import { VerificationStateStore } from './state-store.js';

function loadDotEnvIfPresent(envPath: string): void {
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key && process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

async function start(): Promise<void> {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
  loadDotEnvIfPresent(path.join(repoRoot, '.env'));

  const logger = createRedactedLogger();
  const chainId = Number(process.env.CHAIN_ID || '11155111');
  const rpcUrl = process.env.SEPOLIA_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com';
  const escrowContractAddress = (process.env.REVERT_ESCROW_ADDRESS ||
    '0x0000000000000000000000000000000000000000') as `0x${string}`;

  const attestorKey = process.env.ATTESTOR_PRIVATE_KEY?.trim() as `0x${string}` | undefined;
  const payerKey = process.env.TELEGRAPH_PAYER_PRIVATE_KEY?.trim() as `0x${string}` | undefined;
  const broadcasterKey = process.env.BROADCASTER_PRIVATE_KEY?.trim() as `0x${string}` | undefined;

  if (!attestorKey || !/^0x[a-fA-F0-9]{64}$/.test(attestorKey)) {
    throw new Error('ATTESTOR_PRIVATE_KEY must be configured locally in .env');
  }

  const telegraphClient = new TelegraphClient({
    nodeUrl: process.env.TELEGRAPH_NODE_URL || 'https://devnode.telegraphprotocol.com',
    preferredRail: process.env.TELEGRAPH_PAYMENT_RAIL === 'exact' ? 'exact' : 'escrow',
    maxPerRequestUusdc: BigInt(process.env.MAX_PER_REQUEST_UUSDC || '100000'),
    maxTotalBudgetUusdc: BigInt(process.env.MAX_TOTAL_BUDGET_UUSDC || '2000000'),
    privateKey: payerKey,
    evidenceDir: path.join(repoRoot, 'evidence', 'live-purchases'),
    ledgerPersistPath: path.join(repoRoot, '.revert-spend-ledger.json'),
    logger,
  });

  const chainGateway = new ViemEscrowChainGateway(rpcUrl, escrowContractAddress, broadcasterKey);
  const rpcVerifier = new ViemIndependentRpcVerifier();
  const attestor = new Eip712SettlementAttestor(attestorKey, chainId, escrowContractAddress);
  const stateStore = new VerificationStateStore(
    path.join(repoRoot, '.revert-verification-state.json'),
  );

  const engine = new VerificationEngine({
    chainGateway,
    telegraphClient,
    rpcVerifier,
    attestor,
    stateStore,
    allowLiveSpend: process.env.TELEGRAPH_ALLOW_LIVE_SPEND === 'true',
    enableServerBroadcaster: process.env.ENABLE_SERVER_BROADCASTER === 'true',
    logger,
  });

  const app = await createApp({
    engine,
    telegraphClient,
    chainId,
    escrowContractAddress,
    corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    apiAuthToken: process.env.API_AUTH_TOKEN,
  });

  const host = process.env.API_HOST || '127.0.0.1';
  const port = Number(process.env.API_PORT || '3001');
  await app.listen({ host, port });
  logger.info('REVERT Verification API started', {
    host,
    port,
    chainId,
    escrowContractAddress,
    attestorAddress: attestor.getAddress(),
  });
}

start().catch((err) => {
  console.error('Fatal server error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
