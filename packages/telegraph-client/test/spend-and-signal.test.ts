import { describe, expect, it } from 'vitest';
import {
  AsyncSpendGuard,
  createRedactedLogger,
  deriveSignalHash,
  sanitizeForLog,
} from '../src/index.js';

describe('[FIXTURE] AsyncSpendGuard concurrency, caps, and idempotency', () => {
  it('blocks concurrent requests from exceeding total budget cap', async () => {
    const guard = new AsyncSpendGuard({
      maxPerRequestUusdc: 100_000n,
      maxTotalBudgetUusdc: 120_000n,
    });

    const results = await Promise.allSettled([
      guard.reserve({
        idempotencyKey: 'req-1',
        intent: 'ONCHAIN_TX_LOOKUP_GENERAL',
        rail: 'escrow',
        network: 'eip155:11155111',
        maxAuthorizedUusdc: 80_000n,
      }),
      guard.reserve({
        idempotencyKey: 'req-2',
        intent: 'ONCHAIN_TX_LOOKUP_GENERAL',
        rail: 'escrow',
        network: 'eip155:11155111',
        maxAuthorizedUusdc: 80_000n,
      }),
    ]);

    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]?.status).toBe('rejected');
    expect(guard.getSummary().reservedUusdc).toBe(80_000n);
  });

  it('accounts for maxAuthorizedUusdc and blocks duplicate idempotency keys', async () => {
    const guard = new AsyncSpendGuard({
      maxPerRequestUusdc: 100_000n,
      maxTotalBudgetUusdc: 200_000n,
    });

    await guard.reserve({
      idempotencyKey: 'dup-key',
      intent: 'ONCHAIN_TX_LOOKUP_GENERAL',
      rail: 'escrow',
      network: 'eip155:11155111',
      maxAuthorizedUusdc: 50_000n,
    });

    await guard.finalize({
      idempotencyKey: 'dup-key',
      succeeded: true,
      observedChargedUusdc: 10_000n,
      accountForMaxAuthorized: true,
      receiptHash: '0xreceipt',
    });

    // Policy accounts for maxAuthorizedUusdc (50,000), leaving 150,000
    expect(guard.getSummary().committedUusdc).toBe(50_000n);
    expect(guard.getSummary().remainingUusdc).toBe(150_000n);

    await expect(
      guard.reserve({
        idempotencyKey: 'dup-key',
        intent: 'ONCHAIN_TX_LOOKUP_GENERAL',
        rail: 'escrow',
        network: 'eip155:11155111',
        maxAuthorizedUusdc: 10_000n,
      }),
    ).rejects.toThrow(/Duplicate purchase blocked/);
  });

  it('releases reservation when request fails before charge', async () => {
    const guard = new AsyncSpendGuard({
      maxPerRequestUusdc: 100_000n,
      maxTotalBudgetUusdc: 100_000n,
    });

    await guard.reserve({
      idempotencyKey: 'retryable-fail',
      intent: 'ONCHAIN_TX_LOOKUP_GENERAL',
      rail: 'escrow',
      network: 'eip155:11155111',
      maxAuthorizedUusdc: 50_000n,
    });

    await guard.finalize({
      idempotencyKey: 'retryable-fail',
      succeeded: false,
    });

    expect(guard.getSummary().remainingUusdc).toBe(100_000n);
    await expect(
      guard.reserve({
        idempotencyKey: 'retryable-fail',
        intent: 'ONCHAIN_TX_LOOKUP_GENERAL',
        rail: 'escrow',
        network: 'eip155:11155111',
        maxAuthorizedUusdc: 50_000n,
      }),
    ).resolves.toBeUndefined();
  });
});

describe('[FIXTURE] Redacted logging and signal hash verification', () => {
  it('redacts secret fields and private keys from logs', () => {
    const lines: string[] = [];
    const logger = createRedactedLogger((l) => lines.push(l));
    logger.info('debug', {
      privateKey: '0x1111111111111111111111111111111111111111111111111111111111111111',
      signature: '0xabcdef',
      safeField: 'visible',
    });

    const sanitized = sanitizeForLog({
      'x-payment': 'secret-envelope',
      nested: { api_key: 'top-secret', ok: true },
    }) as Record<string, unknown>;

    expect(lines[0]).not.toContain('1111111111111111');
    expect(lines[0]).toContain('[REDACTED]');
    expect(lines[0]).toContain('visible');
    expect(sanitized['x-payment']).toBe('[REDACTED]');
    expect((sanitized.nested as Record<string, unknown>).api_key).toBe('[REDACTED]');
  });

  it('derives deterministic signal_hash with lowercased wallet_address', () => {
    const h1 = deriveSignalHash({
      b: 'x&y<z>',
      wallet_address: '0xAbCdEf1234567890AbCdEf1234567890AbCdEf12',
      a: 1,
    });
    const h2 = deriveSignalHash({
      a: 1,
      wallet_address: '0xabcdef1234567890abcdef1234567890abcdef12',
      b: 'x&y<z>',
    });
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^0x[a-f0-9]{64}$/);
  });
});
