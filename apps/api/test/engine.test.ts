import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recoverTypedDataAddress } from 'viem';
import { describe, expect, it } from 'vitest';
import {
  computeConditionHash,
  TELEGRAPH_INTENT_NAME,
  type ConditionalTxCondition,
} from '@revert/shared';
import { deriveSignalHash, TelegraphClient } from '@revert/telegraph-client';
import {
  Eip712SettlementAttestor,
  SETTLEMENT_ATTESTATION_TYPES,
  VerificationEngine,
  VerificationStateStore,
  type EscrowChainGateway,
  type IndependentRpcVerifier,
  type OnchainEscrowRecord,
} from '../src/index.js';

const PAYER_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const ATTESTOR_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const SEPOLIA_DIAMOND = '0x72a70e949362670bf8bcead24efc5b8f950aa08b';
const ESCROW_CONTRACT = '0x0000000000000000000000000000000000001234' as const;

const sampleCondition: ConditionalTxCondition = {
  version: 1,
  intent: TELEGRAPH_INTENT_NAME,
  chain: 'ethereum',
  txHash: '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060',
  expectedFrom: '0x1111111111111111111111111111111111111111',
  expectedTo: '0xa1e4380a3b1f749673e270229993ee55f45663b4',
  minValueEth: 0.5,
};
const sampleCondHash = computeConditionHash(sampleCondition);

function createMockTelegraphFetch(opts: {
  txStatus?: 'confirmed' | 'reverted' | 'pending';
  to?: string;
  resultShape?: 'intent' | 'raw';
  failNetwork?: boolean;
  onPaidCall?: () => void;
}): typeof fetch {
  const signalPayload = {
    intent: TELEGRAPH_INTENT_NAME,
    tx_hash: sampleCondition.txHash,
    status: opts.txStatus ?? 'confirmed',
  };
  const signalHash = deriveSignalHash(signalPayload);

  return async (input, init) => {
    if (opts.failNetwork) {
      throw new Error('Simulated Telegraph network outage');
    }
    const url = String(input);
    if (url.endsWith(`/engine/v1/intents/${TELEGRAPH_INTENT_NAME}`)) {
      return new Response(
        JSON.stringify({
          intent_name: TELEGRAPH_INTENT_NAME,
          miner_count: 32,
          request: { params: [{ name: 'tx_hash', type: 'string' }] },
          response: { fields: [{ name: 'status', type: 'enum' }] },
          onchain: { ready: true },
        }),
        { status: 200 },
      );
    }
    if (url.endsWith(`/engine/v1/intents/${TELEGRAPH_INTENT_NAME}/miners`)) {
      return new Response(JSON.stringify({ miners: [{ id: '9002', slug: 'txlens' }] }), {
        status: 200,
      });
    }
    if (url.endsWith('/engine/v1/ask')) {
      const headers = new Headers(init?.headers);
      if (!headers.get('x-payment')) {
        const challenge = {
          x402Version: 2,
          accepts: [
            {
              scheme: 'escrow',
              network: 'eip155:11155111',
              amount: '10000',
              payTo: SEPOLIA_DIAMOND,
              extra: {
                message:
                  'Telegraph Escrow Payment\n\nWallet: {from}\nPay To: 0x72a70e949362670bf8bcead24efc5b8f950aa08b\nNetwork: eip155:11155111\nAmount: 10000 uUSDC\nResource: /v1/ask\nNonce: {nonce}\nValid After: {validAfter}\nValid Before: {validBefore}',
              },
            },
          ],
        };
        return new Response(JSON.stringify({ error: 'payment required' }), {
          status: 402,
          headers: {
            'payment-required': Buffer.from(JSON.stringify(challenge)).toString('base64'),
          },
        });
      }
      opts.onPaidCall?.();
      const receipt = Buffer.from(
        JSON.stringify({
          receipt_hash: '0x2222222222222222222222222222222222222222222222222222222222222222',
          rail: 'escrow',
          payer: '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
          miner: '9002',
          intent: TELEGRAPH_INTENT_NAME,
          amount_uusdc: '10000',
          epoch_id: 58,
          settlement: 'epoch',
          chain: 'telegraph',
          timestamp: 1795674600,
        }),
      ).toString('base64');

      return new Response(
        JSON.stringify({
          miner_id: '9002',
          miner_name: 'TxLens',
          intent: TELEGRAPH_INTENT_NAME,
          result_shape: opts.resultShape ?? 'intent',
          field_status: { status: 'ok' },
          signal_hash: signalHash,
          fulfillment: { status: 'complete' },
          result:
            opts.resultShape === 'raw'
              ? 'transaction confirmed'
              : {
                  tx_hash: sampleCondition.txHash,
                  status: opts.txStatus ?? 'confirmed',
                  from: sampleCondition.expectedFrom,
                  to: opts.to ?? sampleCondition.expectedTo,
                  block_number: 46147,
                  value_eth: 1.25,
                },
        }),
        { status: 200, headers: { 'x-payment-response': receipt } },
      );
    }
    if (url.endsWith(`/engine/v1/signal/${signalHash}`)) {
      return new Response(
        JSON.stringify({ payload: signalPayload, verification: { verified: true } }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

function makeGateway(escrows: OnchainEscrowRecord[], tokenAllowed = true): EscrowChainGateway {
  return {
    listEscrows: async () => escrows,
    getEscrow: async (id) => escrows.find((e) => e.escrowId === id),
    isTokenAllowed: async () => tokenAllowed,
    broadcastSettlement: async () =>
      '0x9999999999999999999999999999999999999999999999999999999999999999',
  };
}

describe('[MOCKED] VerificationEngine workflow, deduplication, and safety', () => {
  it('discovers eligible escrows, deduplicates concurrent runs, verifies RPC, and signs valid EIP-712 attestation', async () => {
    const attestor = new Eip712SettlementAttestor(ATTESTOR_PK, 11155111, ESCROW_CONTRACT);
    const now = 1_800_000_000;
    const escrows: OnchainEscrowRecord[] = [
      {
        escrowId: '1',
        mode: 'Protected',
        state: 'LOCKED',
        sender: '0x1111111111111111111111111111111111111111',
        recipient: '0x2222222222222222222222222222222222222222',
        token: '0xcc194e1a843b658526d0d5c431f670028582ae17',
        amount: '5000000',
        createdAt: now - 100,
        recoveryWindowEnd: now + 3600,
        deadline: now + 3600,
        conditionHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        attestor: '0x0000000000000000000000000000000000000000',
      },
      {
        escrowId: '2',
        mode: 'Conditional',
        state: 'LOCKED',
        sender: '0x1111111111111111111111111111111111111111',
        recipient: '0x2222222222222222222222222222222222222222',
        token: '0xcc194e1a843b658526d0d5c431f670028582ae17',
        amount: '10000000',
        createdAt: now - 100,
        recoveryWindowEnd: 0,
        deadline: now + 3600,
        conditionHash: sampleCondHash,
        attestor: attestor.getAddress(),
      },
    ];

    let paidCount = 0;
    const telegraphClient = new TelegraphClient({
      privateKey: PAYER_PK,
      fetchImpl: createMockTelegraphFetch({ onPaidCall: () => paidCount++ }),
    });
    const rpcVerifier: IndependentRpcVerifier = {
      verifyTransaction: async () => ({
        checked: true,
        status: 'confirmed',
        from: sampleCondition.expectedFrom,
        to: sampleCondition.expectedTo,
        valueEth: 1.25,
      }),
    };

    const engine = new VerificationEngine({
      chainGateway: makeGateway(escrows),
      telegraphClient,
      rpcVerifier,
      attestor,
      stateStore: new VerificationStateStore(),
      allowLiveSpend: true,
      enableServerBroadcaster: false,
      nowUnix: () => now,
    });

    // Reject condition with wrong hash
    await expect(
      engine.registerCondition('2', { ...sampleCondition, minValueEth: 99 }),
    ).rejects.toThrow(/Condition hash mismatch/);

    await engine.registerCondition('2', sampleCondition);
    const eligible = await engine.discoverEligibleConditionalEscrows();
    expect(eligible.map((e) => e.onchain.escrowId)).toEqual(['2']);

    // Concurrent verify calls deduplicate to 1 paid call
    const [r1, r2] = await Promise.all([engine.verifyEscrow('2'), engine.verifyEscrow('2')]);
    expect(paidCount).toBe(1);
    expect(r1.status).toBe('SATISFIED');
    expect(r2.status).toBe('SATISFIED');
    expect(r1.latestEvidence?.observedCostUusdc).toBe('10000');
    expect(r1.attestation).toBeDefined();

    // Verify EIP-712 signature recovers attestor address
    const att = r1.attestation!;
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: 'RevertEscrow',
        version: '1',
        chainId: att.chainId,
        verifyingContract: att.verifyingContract,
      },
      types: SETTLEMENT_ATTESTATION_TYPES,
      primaryType: 'SettlementAttestation',
      message: {
        escrowId: BigInt(att.input.escrowId),
        conditionHash: att.conditionHash,
        outcome: att.input.outcome,
        evidenceHash: att.input.evidenceHash,
        signalHash: att.input.signalHash,
        receiptHash: att.input.receiptHash,
        nonce: att.input.nonce,
        issuedAt: BigInt(att.input.issuedAt),
        expiresAt: BigInt(att.input.expiresAt),
      },
      signature: att.signature,
    });
    expect(recovered.toLowerCase()).toBe(attestor.getAddress());

    // Broadcasting stays separated and disabled by default
    await expect(engine.broadcastVerifiedSettlement('2')).rejects.toThrow(/disabled/);
  });

  it('does not authorize settlement on contradicted or RPC-conflicting or outage evidence', async () => {
    const attestor = new Eip712SettlementAttestor(ATTESTOR_PK, 11155111, ESCROW_CONTRACT);
    const now = 1_800_000_000;
    const escrows: OnchainEscrowRecord[] = [
      {
        escrowId: '1',
        mode: 'Conditional',
        state: 'LOCKED',
        sender: '0x1111111111111111111111111111111111111111',
        recipient: '0x2222222222222222222222222222222222222222',
        token: '0xcc194e1a843b658526d0d5c431f670028582ae17',
        amount: '10000000',
        createdAt: now - 100,
        recoveryWindowEnd: 0,
        deadline: now + 3600,
        conditionHash: sampleCondHash,
        attestor: attestor.getAddress(),
      },
    ];

    // 1. Contradicted (wrong recipient)
    const contradictedEngine = new VerificationEngine({
      chainGateway: makeGateway(escrows),
      telegraphClient: new TelegraphClient({
        privateKey: PAYER_PK,
        fetchImpl: createMockTelegraphFetch({
          to: '0x9999999999999999999999999999999999999999',
        }),
      }),
      rpcVerifier: { verifyTransaction: async () => ({ checked: false }) },
      attestor,
      stateStore: new VerificationStateStore(),
      allowLiveSpend: true,
      nowUnix: () => now,
    });
    await contradictedEngine.registerCondition('1', sampleCondition);
    const contradictedRes = await contradictedEngine.verifyEscrow('1');
    expect(contradictedRes.status).toBe('CONTRADICTED');
    expect(contradictedRes.attestation).toBeUndefined();

    // 2. Conflicting RPC observation -> INCONCLUSIVE
    const conflictEngine = new VerificationEngine({
      chainGateway: makeGateway(escrows),
      telegraphClient: new TelegraphClient({
        privateKey: PAYER_PK,
        fetchImpl: createMockTelegraphFetch({ txStatus: 'confirmed' }),
      }),
      rpcVerifier: {
        verifyTransaction: async () => ({ checked: true, status: 'not_found' }),
      },
      attestor,
      stateStore: new VerificationStateStore(),
      allowLiveSpend: true,
      nowUnix: () => now,
    });
    await conflictEngine.registerCondition('1', sampleCondition);
    const conflictRes = await conflictEngine.verifyEscrow('1');
    expect(conflictRes.status).toBe('INCONCLUSIVE');
    expect(conflictRes.attestation).toBeUndefined();

    // 3. Telegraph outage -> INCONCLUSIVE, preserves recovery path
    const outageEngine = new VerificationEngine({
      chainGateway: makeGateway(escrows),
      telegraphClient: new TelegraphClient({
        privateKey: PAYER_PK,
        maxPrePaymentRetries: 0,
        fetchImpl: createMockTelegraphFetch({ failNetwork: true }),
      }),
      rpcVerifier: { verifyTransaction: async () => ({ checked: false }) },
      attestor,
      stateStore: new VerificationStateStore(),
      allowLiveSpend: true,
      nowUnix: () => now,
    });
    await outageEngine.registerCondition('1', sampleCondition);
    const outageRes = await outageEngine.verifyEscrow('1');
    expect(outageRes.status).toBe('INCONCLUSIVE');
    expect(outageRes.lastError).toContain('outage');
    expect(outageRes.attestation).toBeUndefined();
  });

  it('recovers interrupted VERIFYING job cleanly across service restart and supports dry-run', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revert-state-'));
    const stateFile = path.join(tmpDir, 'state.json');

    const store1 = new VerificationStateStore(stateFile);
    store1.setCondition('1', sampleCondition);
    store1.upsertJob({
      escrowId: '1',
      status: 'VERIFYING',
      attempts: 1,
      conditionHash: sampleCondHash,
    });

    const store2 = new VerificationStateStore(stateFile);
    const recovered = store2.getJob('1');
    expect(recovered?.status).toBe('INCONCLUSIVE');
    expect(recovered?.attempts).toBe(1);
    expect(store2.getCondition('1')?.txHash).toBe(sampleCondition.txHash);

    const attestor = new Eip712SettlementAttestor(ATTESTOR_PK, 11155111, ESCROW_CONTRACT);
    const now = 1_800_000_000;
    const engine = new VerificationEngine({
      chainGateway: makeGateway([
        {
          escrowId: '1',
          mode: 'Conditional',
          state: 'LOCKED',
          sender: '0x1111111111111111111111111111111111111111',
          recipient: '0x2222222222222222222222222222222222222222',
          token: '0xcc194e1a843b658526d0d5c431f670028582ae17',
          amount: '10000000',
          createdAt: now - 100,
          recoveryWindowEnd: 0,
          deadline: now + 3600,
          conditionHash: sampleCondHash,
          attestor: attestor.getAddress(),
        },
      ]),
      telegraphClient: new TelegraphClient({ fetchImpl: createMockTelegraphFetch({}) }),
      rpcVerifier: { verifyTransaction: async () => ({ checked: false }) },
      attestor,
      stateStore: store2,
      allowLiveSpend: false,
      nowUnix: () => now,
    });

    const dry = await engine.verifyEscrow('1', { dryRun: true, force: true });
    expect(dry.status).toBe('INCONCLUSIVE');
    expect(dry.latestEvidence?.idempotencyKey).toBe('dry-run-1');
    expect(dry.latestEvidence?.observedCostUusdc).toBe('0');
    expect(dry.attestation).toBeUndefined();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
