import { describe, expect, it } from 'vitest';
import { createInitialDemoEscrows } from '../src/lib/demo-fixtures.js';
import { formatCountdown, formatUsdc, formatWeb3Error, parseUsdc } from '../src/lib/utils.js';

describe('REVERT frontend utility helpers', () => {
  it('formats and parses 6-decimal USDC cleanly', () => {
    expect(formatUsdc('10000')).toBe('0.01');
    expect(formatUsdc('250000000')).toBe('250.00');
    expect(parseUsdc('42.50')).toBe(42_500_000n);
  });

  it('formats countdowns and maps contract revert errors clearly', () => {
    expect(formatCountdown(1000, 1000)).toBe('Elapsed');
    expect(formatCountdown(4661, 1000)).toBe('1h 1m 1s');
    expect(formatWeb3Error(new Error('User rejected the request'))).toContain('cancelled');
    expect(formatWeb3Error(new Error('RecoveryWindowActive(100, 50)'))).toContain('still active');
  });

  it('labels all demonstration fixtures explicitly', () => {
    const fixtures = createInitialDemoEscrows(1_800_000_000);
    expect(fixtures.length).toBeGreaterThanOrEqual(4);
    expect(fixtures.every((f) => f.isSimulatedFixture === true)).toBe(true);
  });
});
