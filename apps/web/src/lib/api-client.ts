import type { ConditionalTxCondition } from '@revert/shared';

export interface EscrowViewDto {
  onchain: {
    escrowId: string;
    mode: 'Protected' | 'Conditional';
    state: 'LOCKED' | 'RELEASED' | 'REFUNDED';
    sender: `0x${string}`;
    recipient: `0x${string}`;
    token: `0x${string}`;
    amount: string;
    createdAt: number;
    recoveryWindowEnd: number;
    deadline: number;
    conditionHash: `0x${string}`;
    attestor: `0x${string}`;
  };
  condition?: ConditionalTxCondition;
  conditionHashMatches: boolean;
  eligibleForVerification: boolean;
  eligibilityReason?: string;
  verification?: {
    escrowId: string;
    status:
      | 'PENDING'
      | 'VERIFYING'
      | 'SATISFIED'
      | 'CONTRADICTED'
      | 'INCONCLUSIVE'
      | 'EXPIRED'
      | 'DRY_RUN_READY'
      | 'BROADCASTED';
    attempts: number;
    lastAttemptAt?: string;
    conditionHash?: `0x${string}`;
    latestEvidence?: {
      recordedAt: string;
      idempotencyKey: string;
      rail: string;
      network: string;
      minerId: string;
      minerName?: string;
      maxAuthorizedUusdc: string;
      observedCostUusdc: string;
      receiptHash: string;
      signalHash?: string;
      signalVerified: boolean;
      onchainRpcChecked: boolean;
      onchainRpcStatus?: string;
      verdict: 'SATISFIED' | 'CONTRADICTED' | 'INCONCLUSIVE';
      reasons: string[];
      rawParsedResult?: unknown;
    };
    attestation?: {
      chainId: number;
      verifyingContract: `0x${string}`;
      attestor: `0x${string}`;
      conditionHash: `0x${string}`;
      input: {
        escrowId: string;
        outcome: 1 | 2;
        evidenceHash: `0x${string}`;
        signalHash: `0x${string}`;
        receiptHash: `0x${string}`;
        nonce: `0x${string}`;
        issuedAt: number;
        expiresAt: number;
      };
      signature: `0x${string}`;
    };
    broadcastTxHash?: `0x${string}`;
    lastError?: string;
  };
  txHistory?: Array<{
    action: string;
    actor: string;
    timestamp: number;
    txHash: string;
  }>;
  isSimulatedFixture?: boolean;
}

export interface BudgetDto {
  maxPerRequestUusdc: string;
  maxTotalBudgetUusdc: string;
  reservedUusdc: string;
  committedUusdc: string;
  remainingUusdc: string;
}

export interface HealthDto {
  status: string;
  chainId: number;
  escrowContractAddress: string;
  attestorAddress: string;
  allowLiveSpend: boolean;
  enableServerBroadcaster: boolean;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error((body as { error?: string }).error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const apiClient = {
  getHealth: () => apiFetch<HealthDto>('/health'),
  getBudget: () => apiFetch<BudgetDto>('/api/budget'),
  listEscrows: () => apiFetch<{ escrows: EscrowViewDto[] }>('/api/escrows'),
  getEscrow: (id: string) => apiFetch<EscrowViewDto>(`/api/escrows/${encodeURIComponent(id)}`),
  registerCondition: (id: string, condition: ConditionalTxCondition) =>
    apiFetch<{ condition: ConditionalTxCondition; conditionHash: string }>(
      `/api/escrows/${encodeURIComponent(id)}/condition`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(condition),
      },
    ),
  verifyEscrow: (id: string, options: { dryRun?: boolean; force?: boolean } = {}) =>
    apiFetch<EscrowViewDto['verification']>(`/api/escrows/${encodeURIComponent(id)}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    }),
};
