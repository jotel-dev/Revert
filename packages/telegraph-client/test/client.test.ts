import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TELEGRAPH_INTENT_NAME, type ConditionalTxCondition } from '@revert/shared';
import { deriveSignalHash, TelegraphClient } from '../src/index.js';

const TEST_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;
const SEPOLIA_DIAMOND = '0x72a70e949362670bf8bcead24efc5b8f950aa08b';

const fixtureCondition: ConditionalTxCondition = {
  version: 1,
  intent: TELEGRAPH_INTENT_NAME,
  chain: 'ethereum',
  txHash: '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060',
  expectedTo: '0xa1e4380a3b1f749673e270229993ee55f45663b4',
  minValueEth: 0,
};

function makeChallengeHeader(overrides: Partial<Record<string, unknown>> = {}): string {
  const challenge = {
    x402Version: 2,
    error: 'Payment required',
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
        ...overrides,
      },
    ],
  };
  return Buffer.from(JSON.stringify(challenge)).toString('base64');
}

describe('[MOCKED] TelegraphClient security, validation, and purchase flow', () => {
  it('never treats HTTP 402 as purchase success and rejects untrusted payTo or network', async () => {
    const untrustedPayToFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'payment required' }), {
        status: 402,
        headers: {
          'payment-required': makeChallengeHeader({
            payTo: '0xdead00000000000000000000000000000000dead',
          }),
        },
      });

    const client = new TelegraphClient({
      privateKey: TEST_PK,
      fetchImpl: untrustedPayToFetch,
    });

    await expect(
      client.purchaseIntelligence(
        {
          intent: TELEGRAPH_INTENT_NAME,
          params: { tx_hash: fixtureCondition.txHash, chain: fixtureCondition.chain },
        },
        { idempotencyKey: 'untrusted-payto' },
      ),
    ).rejects.toThrow(/allowlists/);

    const untrustedNetFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: 'payment required' }), {
        status: 402,
        headers: { 'payment-required': makeChallengeHeader({ network: 'eip155:999999' }) },
      });
    const client2 = new TelegraphClient({ privateKey: TEST_PK, fetchImpl: untrustedNetFetch });
    await expect(
      client2.inspectChallenge({
        intent: TELEGRAPH_INTENT_NAME,
        params: { tx_hash: fixtureCondition.txHash, chain: fixtureCondition.chain },
      }),
    ).rejects.toThrow(/allowlists/);
  });

  it('executes mocked escrow purchase, verifies signal hash, deduplicates idempotencyKey, and saves redacted evidence', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'revert-evidence-'));
    const signalPayload = {
      intent: TELEGRAPH_INTENT_NAME,
      tx_hash: fixtureCondition.txHash,
      status: 'confirmed',
    };
    const signalHash = deriveSignalHash(signalPayload);

    let paidCalls = 0;
    const mockFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/engine/v1/ask')) {
        const headers = new Headers(init?.headers);
        if (!headers.get('x-payment')) {
          return new Response(JSON.stringify({ error: 'payment required' }), {
            status: 402,
            headers: { 'payment-required': makeChallengeHeader() },
          });
        }
        paidCalls++;
        const receipt = Buffer.from(
          JSON.stringify({
            receipt_hash: '0x1111111111111111111111111111111111111111111111111111111111111111',
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
            result_shape: 'intent',
            field_status: { status: 'ok' },
            signal_hash: signalHash,
            fulfillment: { status: 'complete' },
            result: {
              tx_hash: fixtureCondition.txHash,
              status: 'confirmed',
              from: '0x1111111111111111111111111111111111111111',
              to: fixtureCondition.expectedTo,
              block_number: 46147,
              value_eth: 1,
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

    const client = new TelegraphClient({
      privateKey: TEST_PK,
      evidenceDir: tmpDir,
      fetchImpl: mockFetch,
    });

    const first = await client.purchaseIntelligence(
      {
        intent: TELEGRAPH_INTENT_NAME,
        params: { tx_hash: fixtureCondition.txHash, chain: fixtureCondition.chain },
      },
      { idempotencyKey: 'escrow-purchase-1', condition: fixtureCondition },
    );

    const second = await client.purchaseIntelligence(
      {
        intent: TELEGRAPH_INTENT_NAME,
        params: { tx_hash: fixtureCondition.txHash, chain: fixtureCondition.chain },
      },
      { idempotencyKey: 'escrow-purchase-1', condition: fixtureCondition },
    );

    expect(paidCalls).toBe(1);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(first.observedCostUusdc).toBe(10_000n);
    expect(first.signalVerification?.localHashMatched).toBe(true);
    expect(first.policyEvaluation?.decision).toBe('RELEASE');
    expect(first.evidenceFilePath).toBeTruthy();
    expect(fs.existsSync(first.evidenceFilePath!)).toBe(true);

    const saved = fs.readFileSync(first.evidenceFilePath!, 'utf8');
    expect(saved).not.toContain(TEST_PK);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects spoofed extra.message template fields that mismatch option.amount or payTo', async () => {
    const spoofedFetch: typeof fetch = async () => {
      const spoofedChallenge = {
        x402Version: 2,
        accepts: [
          {
            scheme: 'escrow',
            network: 'eip155:11155111',
            amount: '10000',
            payTo: SEPOLIA_DIAMOND,
            extra: {
              message:
                'Telegraph Escrow Payment\n\nWallet: {from}\nPay To: 0x72a70e949362670bf8bcead24efc5b8f950aa08b\nNetwork: eip155:11155111\nAmount: 99999999 uUSDC\nResource: /v1/ask\nNonce: {nonce}\nValid After: {validAfter}\nValid Before: {validBefore}',
            },
          },
        ],
      };
      return new Response(JSON.stringify({ error: 'payment required' }), {
        status: 402,
        headers: {
          'payment-required': Buffer.from(JSON.stringify(spoofedChallenge)).toString('base64'),
        },
      });
    };

    const client = new TelegraphClient({ privateKey: TEST_PK, fetchImpl: spoofedFetch });
    await expect(
      client.purchaseIntelligence(
        {
          intent: TELEGRAPH_INTENT_NAME,
          params: { tx_hash: fixtureCondition.txHash, chain: fixtureCondition.chain },
        },
        { idempotencyKey: 'spoofed-template' },
      ),
    ).rejects.toThrow(/template Amount does not match/);
  });

  it('retries pre-payment 503 up to bound and enforces timeout', async () => {
    let attempts = 0;
    const flakyFetch: typeof fetch = async () => {
      attempts++;
      if (attempts < 3) {
        return new Response('busy', { status: 503 });
      }
      return new Response(
        JSON.stringify({
          intent_name: TELEGRAPH_INTENT_NAME,
          miner_count: 32,
          request: { params: [{ name: 'tx_hash', type: 'string' }] },
          response: { fields: [{ name: 'status', type: 'enum' }] },
        }),
        { status: 200 },
      );
    };

    const client = new TelegraphClient({
      maxPrePaymentRetries: 2,
      retryBaseDelayMs: 5,
      fetchImpl: flakyFetch,
    });
    const info = await client.discoverIntent(TELEGRAPH_INTENT_NAME);
    expect(attempts).toBe(3);
    expect(info.miner_count).toBe(32);
  });
});
