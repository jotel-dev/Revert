import { describe, expect, it } from 'vitest';
import {
  assertWithinBudget,
  DEFAULT_BUDGET_POLICY,
  parsePaymentRequiredHeader,
  renderEscrowSignMessage,
  runTelegraphDryRunSpike,
  selectPreferredAccept,
} from '../src/index.js';

const sampleChallenge = {
  x402Version: 2,
  error: 'Payment required',
  accepts: [
    {
      scheme: 'exact',
      network: 'eip155:84532',
      asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      amount: '50000',
      payTo: '0xC0A3FB6d3F1f4B54617d29ffbdA4663Af5F96e2e',
    },
    {
      scheme: 'escrow',
      network: 'eip155:11155111',
      amount: '50000',
      payTo: '0x72a70e949362670bf8bcead24efc5b8f950aa08b',
      extra: {
        message:
          'Telegraph Escrow Payment\n\nWallet: {from}\nPay To: 0x72a70e949362670bf8bcead24efc5b8f950aa08b\nNetwork: eip155:11155111\nAmount: 50000 uUSDC\nResource: /v1/ask\nNonce: {nonce}\nValid After: {validAfter}\nValid Before: {validBefore}',
      },
    },
  ],
};

describe('Telegraph spike challenge & budget controls', () => {
  it('parses base64 PAYMENT-REQUIRED header and selects Sepolia escrow', () => {
    const encoded = Buffer.from(JSON.stringify(sampleChallenge)).toString('base64');
    const parsed = parsePaymentRequiredHeader(encoded);
    const selected = selectPreferredAccept(parsed, 'escrow', 'eip155:11155111');
    expect(selected.scheme).toBe('escrow');
    expect(selected.network).toBe('eip155:11155111');
    expect(selected.amount).toBe('50000');
  });

  it('enforces per-request and cumulative spending caps', () => {
    expect(() => assertWithinBudget(100_000n, DEFAULT_BUDGET_POLICY)).not.toThrow();
    expect(() => assertWithinBudget(100_001n, DEFAULT_BUDGET_POLICY)).toThrow(/per-request cap/);
    expect(() =>
      assertWithinBudget(50_000n, {
        ...DEFAULT_BUDGET_POLICY,
        spentSoFarUusdc: 1_960_000n,
      }),
    ).toThrow(/total budget cap/);
  });

  it('renders EIP-191 escrow template with lowercase address and bounded window', () => {
    const tpl = sampleChallenge.accepts[1]!.extra!.message;
    const msg = renderEscrowSignMessage(tpl, {
      fromAddress: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
      nonce: 'nonce-1',
      validAfter: 1000,
      validBefore: 1100,
    });
    expect(msg).toContain('Wallet: 0xabcdef1234567890abcdef1234567890abcdef12');
    expect(msg).toContain('Network: eip155:11155111');
    expect(() =>
      renderEscrowSignMessage(tpl, {
        fromAddress: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
        nonce: 'nonce-2',
        validAfter: 1000,
        validBefore: 1200,
      }),
    ).toThrow(/<= 120s/);
  });

  it('executes dry-run spike without spending and refuses live execution', async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith('/engine/v1/intents/ONCHAIN_TX_LOOKUP_GENERAL')) {
        return new Response(
          JSON.stringify({
            intent_name: 'ONCHAIN_TX_LOOKUP_GENERAL',
            class: 'judgment',
            miner_count: 32,
            request: { params: [{ name: 'tx_hash', type: 'string' }] },
            response: { fields: [{ name: 'status', type: 'enum' }] },
            onchain: { ready: true },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith('/engine/v1/intents/ONCHAIN_TX_LOOKUP_GENERAL/miners')) {
        return new Response(JSON.stringify({ miners: [{ id: '9002', slug: 'txlens' }] }), {
          status: 200,
        });
      }
      if (url.endsWith('/engine/v1/ask')) {
        const b64 = Buffer.from(JSON.stringify(sampleChallenge)).toString('base64');
        return new Response(JSON.stringify({ error: 'payment required' }), {
          status: 402,
          headers: { 'payment-required': b64 },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const report = await runTelegraphDryRunSpike({
      txHash: '0x0000000000000000000000000000000000000000000000000000000000000001',
      chain: 'ethereum',
      dryRun: true,
      fetchImpl: mockFetch,
    });
    expect(report.mode).toBe('DRY_RUN');
    expect(report.paidExecuted).toBe(false);
    expect(report.challengeStatus).toBe(402);
    expect(report.selectedOption.scheme).toBe('escrow');

    await expect(
      runTelegraphDryRunSpike({
        txHash: '0x0000000000000000000000000000000000000000000000000000000000000001',
        chain: 'ethereum',
        dryRun: false,
        fetchImpl: mockFetch,
      }),
    ).rejects.toThrow(/Live execution is disabled/);
  });
});
