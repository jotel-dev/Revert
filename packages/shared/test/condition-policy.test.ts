import { describe, expect, it } from 'vitest';
import {
  canonicalizeCondition,
  computeConditionHash,
  evaluateTxLookupPolicy,
  type ConditionalTxCondition,
  type TelegraphAskResponse,
} from '../src/index.js';

const baseCondition: ConditionalTxCondition = {
  version: 1,
  intent: 'ONCHAIN_TX_LOOKUP_GENERAL',
  chain: 'sepolia',
  txHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  expectedFrom: '0x1111111111111111111111111111111111111111',
  expectedTo: '0x2222222222222222222222222222222222222222',
  minValueEth: 0.05,
};

const validResponse: TelegraphAskResponse = {
  miner_id: '9002',
  intent: 'ONCHAIN_TX_LOOKUP_GENERAL',
  result_shape: 'intent',
  field_status: { status: 'ok' },
  signal_hash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  fulfillment: { status: 'complete' },
  result: {
    tx_hash: baseCondition.txHash,
    status: 'confirmed',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
    block_number: 7123456,
    value_eth: 0.1,
  },
};

describe('Condition canonicalization and deterministic policy', () => {
  it('produces identical hash regardless of address casing', () => {
    const h1 = computeConditionHash(baseCondition);
    const h2 = computeConditionHash({
      ...baseCondition,
      expectedTo: '0x2222222222222222222222222222222222222222'.toUpperCase().replace('0X', '0x'),
    });
    expect(h1).toBe(h2);
    expect(canonicalizeCondition(baseCondition)).toContain('"intent":"ONCHAIN_TX_LOOKUP_GENERAL"');
  });

  it('releases only when all Telegraph and RPC checks succeed', () => {
    const res = evaluateTxLookupPolicy(baseCondition, validResponse, true, {
      checked: true,
      status: 'confirmed',
      from: baseCondition.expectedFrom,
      to: baseCondition.expectedTo,
      valueEth: 0.1,
    });
    expect(res.decision).toBe('RELEASE');
  });

  it('returns INCONCLUSIVE on reverted, raw shape, unverified signal, or wrong recipient', () => {
    expect(
      evaluateTxLookupPolicy(
        baseCondition,
        { ...validResponse, result: { ...(validResponse.result as object), status: 'reverted' } },
        true,
      ).decision,
    ).toBe('INCONCLUSIVE');

    expect(
      evaluateTxLookupPolicy(baseCondition, { ...validResponse, result_shape: 'raw' }, true)
        .decision,
    ).toBe('INCONCLUSIVE');

    expect(evaluateTxLookupPolicy(baseCondition, validResponse, false).decision).toBe(
      'INCONCLUSIVE',
    );

    expect(
      evaluateTxLookupPolicy(
        baseCondition,
        {
          ...validResponse,
          result: {
            ...(validResponse.result as object),
            to: '0x3333333333333333333333333333333333333333',
          },
        },
        true,
      ).decision,
    ).toBe('INCONCLUSIVE');
  });
});
