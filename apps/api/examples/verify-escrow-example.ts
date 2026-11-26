/**
 * Reusable integration example: demonstrates how a client or operator registers
 * a Mode B conditional escrow condition, runs a dry-run Telegraph verification,
 * and inspects the resulting evidence/attestation structure without spending funds.
 */
import console from 'node:console';
import { computeConditionHash, TELEGRAPH_INTENT_NAME, type ConditionalTxCondition } from '@revert/shared';
import { TelegraphClient } from '@revert/telegraph-client';
import { Eip712SettlementAttestor } from '../src/attestor.js';
import { VerificationEngine } from '../src/engine.js';
import type { EscrowChainGateway, OnchainEscrowRecord } from '../src/escrow-chain.js';
import type { IndependentRpcVerifier } from '../src/independent-rpc.js';
import { VerificationStateStore } from '../src/state-store.js';

async function runExample(): Promise<void> {
  const sampleCondition: ConditionalTxCondition = {
    version: 1,
    intent: TELEGRAPH_INTENT_NAME,
    chain: 'ethereum',
    txHash: '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060',
    expectedTo: '0xa1e4380a3b1f749673e270229993ee55f45663b4',
    minValueEth: 0,
  };
  const conditionHash = computeConditionHash(sampleCondition);

  // Example disposable Anvil attestor key (never use funded keys in examples)
  const exampleAttestorKey =
    '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
  const attestor = new Eip712SettlementAttestor(
    exampleAttestorKey,
    11155111,
    '0x0000000000000000000000000000000000001234',
  );

  const mockGateway: EscrowChainGateway = {
    listEscrows: async () => [
      {
        escrowId: '1',
        mode: 'Conditional',
        state: 'LOCKED',
        sender: '0x1111111111111111111111111111111111111111',
        recipient: '0x2222222222222222222222222222222222222222',
        token: '0xcc194e1a843b658526d0d5c431f670028582ae17',
        amount: '5000000',
        createdAt: Math.floor(Date.now() / 1000) - 60,
        recoveryWindowEnd: 0,
        deadline: Math.floor(Date.now() / 1000) + 3600,
        conditionHash,
        attestor: attestor.getAddress(),
      },
    ],
    getEscrow: async (id): Promise<OnchainEscrowRecord | undefined> => {
      const all = await mockGateway.listEscrows();
      return all.find((e) => e.escrowId === id);
    },
    isTokenAllowed: async () => true,
    broadcastSettlement: async () => {
      throw new Error('Broadcasting disabled in dry-run example');
    },
  };

  const rpcVerifier: IndependentRpcVerifier = {
    verifyTransaction: async () => ({ checked: false }),
  };

  const engine = new VerificationEngine({
    chainGateway: mockGateway,
    telegraphClient: new TelegraphClient(),
    rpcVerifier,
    attestor,
    stateStore: new VerificationStateStore(),
    allowLiveSpend: false,
  });

  await engine.registerCondition('1', sampleCondition);
  const dryRunResult = await engine.verifyEscrow('1', { dryRun: true });
  console.log(JSON.stringify(dryRunResult, null, 2));
}

runExample().catch(console.error);
