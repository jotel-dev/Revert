import { computeConditionHash, TELEGRAPH_INTENT_NAME } from '@revert/shared';
import type { BudgetDto, EscrowViewDto } from './api-client.js';
import { DEFAULT_ATTESTOR_ADDRESS, SEPOLIA_TEST_USDC_ADDRESS } from './contracts.js';

export const DEMO_SENDER = '0x1111111111111111111111111111111111111111' as const;
export const DEMO_RECIPIENT = '0x2222222222222222222222222222222222222222' as const;

const cond2 = {
  version: 1 as const,
  intent: TELEGRAPH_INTENT_NAME,
  chain: 'ethereum' as const,
  txHash: '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060' as const,
  expectedFrom: DEMO_SENDER,
  expectedTo: '0xa1e4380a3b1f749673e270229993ee55f45663b4' as const,
  minValueEth: 0.5,
};

const cond4 = {
  version: 1 as const,
  intent: TELEGRAPH_INTENT_NAME,
  chain: 'base' as const,
  txHash: '0x9a11111111111111111111111111111111111111111111111111111111111111' as const,
  expectedTo: DEMO_RECIPIENT,
  minValueEth: 1.0,
};

export function createInitialDemoEscrows(nowUnix = Math.floor(Date.now() / 1000)): EscrowViewDto[] {
  return [
    {
      isSimulatedFixture: true,
      onchain: {
        escrowId: '1',
        mode: 'Protected',
        state: 'LOCKED',
        sender: DEMO_SENDER,
        recipient: DEMO_RECIPIENT,
        token: SEPOLIA_TEST_USDC_ADDRESS,
        amount: '250000000', // 250.00 USDC
        createdAt: nowUnix - 600,
        recoveryWindowEnd: nowUnix + 1800,
        deadline: nowUnix + 1800,
        conditionHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        attestor: '0x0000000000000000000000000000000000000000',
      },
      conditionHashMatches: false,
      eligibleForVerification: false,
      eligibilityReason: 'Mode A Protected escrow uses immutable recovery window.',
      txHistory: [
        {
          action: 'ProtectedEscrowCreated',
          actor: DEMO_SENDER,
          timestamp: nowUnix - 600,
          txHash: '0xdemo01a111111111111111111111111111111111111111111111111111111111',
        },
      ],
    },
    {
      isSimulatedFixture: true,
      onchain: {
        escrowId: '2',
        mode: 'Conditional',
        state: 'LOCKED',
        sender: DEMO_SENDER,
        recipient: DEMO_RECIPIENT,
        token: SEPOLIA_TEST_USDC_ADDRESS,
        amount: '500000000', // 500.00 USDC
        createdAt: nowUnix - 1200,
        recoveryWindowEnd: 0,
        deadline: nowUnix + 7200,
        conditionHash: computeConditionHash(cond2),
        attestor: DEFAULT_ATTESTOR_ADDRESS,
      },
      condition: cond2,
      conditionHashMatches: true,
      eligibleForVerification: true,
      verification: {
        escrowId: '2',
        status: 'SATISFIED',
        attempts: 1,
        lastAttemptAt: new Date((nowUnix - 180) * 1000).toISOString(),
        conditionHash: computeConditionHash(cond2),
        latestEvidence: {
          recordedAt: new Date((nowUnix - 180) * 1000).toISOString(),
          idempotencyKey: 'demo-escrow-2-attempt-1',
          rail: 'escrow',
          network: 'eip155:11155111',
          minerId: '9002',
          minerName: 'TxLens (Simulated Fixture)',
          maxAuthorizedUusdc: '50000',
          observedCostUusdc: '10000',
          receiptHash: '0xdemo02receipt000000000000000000000000000000000000000000000000001',
          signalHash: '0xdemo02signal0000000000000000000000000000000000000000000000000001',
          signalVerified: true,
          onchainRpcChecked: true,
          onchainRpcStatus: 'confirmed',
          verdict: 'SATISFIED',
          reasons: ['All deterministic Telegraph and independent verification checks passed'],
          rawParsedResult: {
            tx_hash: cond2.txHash,
            status: 'confirmed',
            from: DEMO_SENDER,
            to: cond2.expectedTo,
            block_number: 46147,
            value_eth: 1.0,
          },
        },
        attestation: {
          chainId: 11155111,
          verifyingContract: '0x0000000000000000000000000000000000001234',
          attestor: DEFAULT_ATTESTOR_ADDRESS,
          conditionHash: computeConditionHash(cond2),
          input: {
            escrowId: '2',
            outcome: 1,
            evidenceHash: '0xdemo02evidence00000000000000000000000000000000000000000000000001',
            signalHash: '0xdemo02signal0000000000000000000000000000000000000000000000000001',
            receiptHash: '0xdemo02receipt000000000000000000000000000000000000000000000000001',
            nonce: '0xdemo02nonce0000000000000000000000000000000000000000000000000001',
            issuedAt: nowUnix - 180,
            expiresAt: nowUnix + 720,
          },
          signature: '0xdemo00signature0000000000000000000000000000000000000000000000000000',
        },
      },
      txHistory: [
        {
          action: 'ConditionalEscrowCreated',
          actor: DEMO_SENDER,
          timestamp: nowUnix - 1200,
          txHash: '0xdemo02a111111111111111111111111111111111111111111111111111111111',
        },
      ],
    },
    {
      isSimulatedFixture: true,
      onchain: {
        escrowId: '3',
        mode: 'Protected',
        state: 'RELEASED',
        sender: DEMO_SENDER,
        recipient: DEMO_RECIPIENT,
        token: SEPOLIA_TEST_USDC_ADDRESS,
        amount: '120000000', // 120.00 USDC
        createdAt: nowUnix - 7200,
        recoveryWindowEnd: nowUnix - 3600,
        deadline: nowUnix - 3600,
        conditionHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
        attestor: '0x0000000000000000000000000000000000000000',
      },
      conditionHashMatches: false,
      eligibleForVerification: false,
      txHistory: [
        {
          action: 'ProtectedEscrowCreated',
          actor: DEMO_SENDER,
          timestamp: nowUnix - 7200,
          txHash: '0xdemo03a111111111111111111111111111111111111111111111111111111111',
        },
        {
          action: 'EscrowReleased',
          actor: DEMO_RECIPIENT,
          timestamp: nowUnix - 3500,
          txHash: '0xdemo03b222222222222222222222222222222222222222222222222222222222',
        },
      ],
    },
    {
      isSimulatedFixture: true,
      onchain: {
        escrowId: '4',
        mode: 'Conditional',
        state: 'REFUNDED',
        sender: DEMO_SENDER,
        recipient: DEMO_RECIPIENT,
        token: SEPOLIA_TEST_USDC_ADDRESS,
        amount: '75000000', // 75.00 USDC
        createdAt: nowUnix - 10800,
        recoveryWindowEnd: 0,
        deadline: nowUnix - 900,
        conditionHash: computeConditionHash(cond4),
        attestor: DEFAULT_ATTESTOR_ADDRESS,
      },
      condition: cond4,
      conditionHashMatches: true,
      eligibleForVerification: false,
      verification: {
        escrowId: '4',
        status: 'EXPIRED',
        attempts: 1,
        lastAttemptAt: new Date((nowUnix - 1800) * 1000).toISOString(),
        latestEvidence: {
          recordedAt: new Date((nowUnix - 1800) * 1000).toISOString(),
          idempotencyKey: 'demo-escrow-4-attempt-1',
          rail: 'escrow',
          network: 'eip155:11155111',
          minerId: '9007',
          minerName: 'INTERLOCK (Simulated Fixture)',
          maxAuthorizedUusdc: '50000',
          observedCostUusdc: '10000',
          receiptHash: '0xdemo04receipt000000000000000000000000000000000000000000000000001',
          signalVerified: true,
          onchainRpcChecked: true,
          onchainRpcStatus: 'not_found',
          verdict: 'INCONCLUSIVE',
          reasons: ['Transaction status is not_found, requires confirmed'],
        },
      },
      txHistory: [
        {
          action: 'ConditionalEscrowCreated',
          actor: DEMO_SENDER,
          timestamp: nowUnix - 10800,
          txHash: '0xdemo04a111111111111111111111111111111111111111111111111111111111',
        },
        {
          action: 'EscrowRefunded',
          actor: DEMO_SENDER,
          timestamp: nowUnix - 850,
          txHash: '0xdemo04b222222222222222222222222222222222222222222222222222222222',
        },
      ],
    },
  ];
}

export const DEMO_BUDGET: BudgetDto = {
  maxPerRequestUusdc: '100000',
  maxTotalBudgetUusdc: '2000000',
  reservedUusdc: '0',
  committedUusdc: '20000',
  remainingUusdc: '1980000',
};
