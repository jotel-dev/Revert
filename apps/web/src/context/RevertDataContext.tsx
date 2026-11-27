import { computeConditionHash, type ConditionalTxCondition } from '@revert/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  apiClient,
  type BudgetDto,
  type EscrowViewDto,
  type HealthDto,
} from '../lib/api-client.js';
import {
  DEFAULT_ATTESTOR_ADDRESS,
  REVERT_ESCROW_ADDRESS,
  SEPOLIA_TEST_USDC_ADDRESS,
} from '../lib/contracts.js';
import { createInitialDemoEscrows, DEMO_BUDGET, DEMO_SENDER } from '../lib/demo-fixtures.js';

export type DataMode = 'live' | 'demo';

interface RevertDataContextValue {
  dataMode: DataMode;
  setDataMode: (mode: DataMode) => void;
  escrows: EscrowViewDto[];
  budget: BudgetDto | null;
  health: HealthDto | null;
  loading: boolean;
  apiError: string | null;
  refresh: () => Promise<void>;
  getEscrowById: (id: string) => EscrowViewDto | undefined;
  createDemoEscrow: (input: {
    mode: 'Protected' | 'Conditional';
    sender?: `0x${string}`;
    recipient: `0x${string}`;
    amountAtomic: string;
    recoveryWindowSeconds?: number;
    deadlineSeconds?: number;
    condition?: ConditionalTxCondition;
  }) => EscrowViewDto;
  cancelDemoEscrow: (id: string, actor: string) => void;
  claimDemoEscrow: (id: string, actor: string) => void;
  verifyDemoEscrow: (id: string) => Promise<void>;
  settleDemoEscrow: (id: string, actor: string) => void;
  refundDemoEscrow: (id: string, actor: string) => void;
}

const RevertDataContext = createContext<RevertDataContextValue | null>(null);

export function RevertDataProvider({ children }: { children: ReactNode }) {
  const initialDemo =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('demo') === '1';

  const [dataMode, setDataMode] = useState<DataMode>(initialDemo ? 'demo' : 'live');
  const [liveEscrows, setLiveEscrows] = useState<EscrowViewDto[]>([]);
  const [liveBudget, setLiveBudget] = useState<BudgetDto | null>(null);
  const [liveHealth, setLiveHealth] = useState<HealthDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const [demoEscrows, setDemoEscrows] = useState<EscrowViewDto[]>(() => createInitialDemoEscrows());
  const [demoBudget, setDemoBudget] = useState<BudgetDto>(DEMO_BUDGET);

  const refresh = useCallback(async () => {
    if (dataMode === 'demo') return;
    setLoading(true);
    setApiError(null);
    try {
      const [h, b, e] = await Promise.all([
        apiClient.getHealth(),
        apiClient.getBudget(),
        apiClient.listEscrows(),
      ]);
      setLiveHealth(h);
      setLiveBudget(b);
      setLiveEscrows(e.escrows);
    } catch (err) {
      setLiveHealth(null);
      setLiveBudget(null);
      setLiveEscrows([]);
      setApiError(
        err instanceof Error
          ? err.message
          : 'Verification API unreachable. Live contract reads require wallet/RPC configuration.',
      );
    } finally {
      setLoading(false);
    }
  }, [dataMode]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createDemoEscrow = useCallback<RevertDataContextValue['createDemoEscrow']>((input) => {
    const now = Math.floor(Date.now() / 1000);
    let created!: EscrowViewDto;
    setDemoEscrows((prev) => {
      const nextId = String(prev.length + 1);
      const condHash =
        input.mode === 'Conditional' && input.condition
          ? computeConditionHash(input.condition)
          : ('0x0000000000000000000000000000000000000000000000000000000000000000' as const);
      const windowEnd =
        input.mode === 'Protected' ? now + (input.recoveryWindowSeconds ?? 3600) : 0;
      const deadline =
        input.mode === 'Protected' ? windowEnd : now + (input.deadlineSeconds ?? 7200);

      created = {
        isSimulatedFixture: true,
        onchain: {
          escrowId: nextId,
          mode: input.mode,
          state: 'LOCKED',
          sender: input.sender ?? DEMO_SENDER,
          recipient: input.recipient,
          token: SEPOLIA_TEST_USDC_ADDRESS,
          amount: input.amountAtomic,
          createdAt: now,
          recoveryWindowEnd: windowEnd,
          deadline,
          conditionHash: condHash,
          attestor:
            input.mode === 'Conditional'
              ? DEFAULT_ATTESTOR_ADDRESS
              : '0x0000000000000000000000000000000000000000',
        },
        ...(input.condition
          ? { condition: input.condition, conditionHashMatches: true }
          : { conditionHashMatches: false }),
        eligibleForVerification: input.mode === 'Conditional',
        txHistory: [
          {
            action:
              input.mode === 'Protected' ? 'ProtectedEscrowCreated' : 'ConditionalEscrowCreated',
            actor: input.sender ?? DEMO_SENDER,
            timestamp: now,
            txHash: `0xdemo${nextId.padStart(2, '0')}${'a'.repeat(58)}`,
          },
        ],
      };
      return [created, ...prev];
    });
    return created;
  }, []);

  const cancelDemoEscrow = useCallback((id: string, actor: string) => {
    const now = Math.floor(Date.now() / 1000);
    setDemoEscrows((prev) =>
      prev.map((item) => {
        if (item.onchain.escrowId !== id || item.onchain.state !== 'LOCKED') return item;
        return {
          ...item,
          onchain: { ...item.onchain, state: 'REFUNDED' },
          txHistory: [
            ...(item.txHistory ?? []),
            {
              action: 'EscrowRefunded',
              actor,
              timestamp: now,
              txHash: `0xdemocancel${'b'.repeat(54)}`,
            },
          ],
        };
      }),
    );
  }, []);

  const claimDemoEscrow = useCallback((id: string, actor: string) => {
    const now = Math.floor(Date.now() / 1000);
    setDemoEscrows((prev) =>
      prev.map((item) => {
        if (item.onchain.escrowId !== id || item.onchain.state !== 'LOCKED') return item;
        return {
          ...item,
          onchain: { ...item.onchain, state: 'RELEASED' },
          txHistory: [
            ...(item.txHistory ?? []),
            {
              action: 'EscrowReleased',
              actor,
              timestamp: now,
              txHash: `0xdemoclaim${'c'.repeat(55)}`,
            },
          ],
        };
      }),
    );
  }, []);

  const verifyDemoEscrow = useCallback(async (id: string) => {
    await new Promise((r) => setTimeout(r, 250));
    const now = Math.floor(Date.now() / 1000);
    setDemoEscrows((prev) =>
      prev.map((item) => {
        if (item.onchain.escrowId !== id || !item.condition) return item;
        const isConfirmedFixture = !item.condition.txHash.startsWith('0x9a');
        return {
          ...item,
          verification: {
            escrowId: id,
            status: isConfirmedFixture ? 'SATISFIED' : 'INCONCLUSIVE',
            attempts: (item.verification?.attempts ?? 0) + 1,
            lastAttemptAt: new Date(now * 1000).toISOString(),
            conditionHash: item.onchain.conditionHash,
            latestEvidence: {
              recordedAt: new Date(now * 1000).toISOString(),
              idempotencyKey: `demo-escrow-${id}-attempt-${(item.verification?.attempts ?? 0) + 1}`,
              rail: 'escrow',
              network: 'eip155:11155111',
              minerId: '9002',
              minerName: 'TxLens (Simulated Fixture)',
              maxAuthorizedUusdc: '50000',
              observedCostUusdc: '10000',
              receiptHash: `0xdemo${id.padStart(2, '0')}rcpt${'e'.repeat(54)}`,
              signalHash: `0xdemo${id.padStart(2, '0')}sig${'f'.repeat(55)}`,
              signalVerified: true,
              onchainRpcChecked: true,
              onchainRpcStatus: isConfirmedFixture ? 'confirmed' : 'not_found',
              verdict: isConfirmedFixture ? 'SATISFIED' : 'INCONCLUSIVE',
              reasons: isConfirmedFixture
                ? ['All deterministic Telegraph and independent verification checks passed']
                : ['Transaction status is not_found, requires confirmed'],
            },
            ...(isConfirmedFixture
              ? {
                  attestation: {
                    chainId: 11155111,
                    verifyingContract: (REVERT_ESCROW_ADDRESS ||
                      '0x0000000000000000000000000000000000001234') as `0x${string}`,
                    attestor: DEFAULT_ATTESTOR_ADDRESS,
                    conditionHash: item.onchain.conditionHash,
                    input: {
                      escrowId: id,
                      outcome: 1 as const,
                      evidenceHash: `0xdemo${id.padStart(2, '0')}evid${'1'.repeat(54)}`,
                      signalHash: `0xdemo${id.padStart(2, '0')}sig${'f'.repeat(55)}`,
                      receiptHash: `0xdemo${id.padStart(2, '0')}rcpt${'e'.repeat(54)}`,
                      nonce: `0xdemo${id.padStart(2, '0')}nonce${'2'.repeat(53)}`,
                      issuedAt: now,
                      expiresAt: now + 900,
                    },
                    signature: `0xdemosig${'3'.repeat(57)}`,
                  },
                }
              : {}),
          },
        };
      }),
    );
    setDemoBudget((b) => ({
      ...b,
      committedUusdc: String(BigInt(b.committedUusdc) + 10_000n),
      remainingUusdc: String(BigInt(b.remainingUusdc) - 10_000n),
    }));
  }, []);

  const settleDemoEscrow = useCallback((id: string, actor: string) => {
    const now = Math.floor(Date.now() / 1000);
    setDemoEscrows((prev) =>
      prev.map((item) => {
        if (item.onchain.escrowId !== id || item.onchain.state !== 'LOCKED') return item;
        return {
          ...item,
          onchain: { ...item.onchain, state: 'RELEASED' },
          txHistory: [
            ...(item.txHistory ?? []),
            {
              action: 'EscrowReleased',
              actor,
              timestamp: now,
              txHash: `0xdemosettle${'d'.repeat(54)}`,
            },
          ],
        };
      }),
    );
  }, []);

  const refundDemoEscrow = useCallback((id: string, actor: string) => {
    const now = Math.floor(Date.now() / 1000);
    setDemoEscrows((prev) =>
      prev.map((item) => {
        if (item.onchain.escrowId !== id || item.onchain.state !== 'LOCKED') return item;
        return {
          ...item,
          onchain: { ...item.onchain, state: 'REFUNDED' },
          txHistory: [
            ...(item.txHistory ?? []),
            {
              action: 'EscrowRefunded',
              actor,
              timestamp: now,
              txHash: `0xdemorefund${'9'.repeat(54)}`,
            },
          ],
        };
      }),
    );
  }, []);

  const escrows = dataMode === 'demo' ? demoEscrows : liveEscrows;
  const budget = dataMode === 'demo' ? demoBudget : liveBudget;

  const getEscrowById = useCallback(
    (id: string) => escrows.find((e) => e.onchain.escrowId === id),
    [escrows],
  );

  const value = useMemo<RevertDataContextValue>(
    () => ({
      dataMode,
      setDataMode,
      escrows,
      budget,
      health: dataMode === 'demo' ? null : liveHealth,
      loading,
      apiError: dataMode === 'demo' ? null : apiError,
      refresh,
      getEscrowById,
      createDemoEscrow,
      cancelDemoEscrow,
      claimDemoEscrow,
      verifyDemoEscrow,
      settleDemoEscrow,
      refundDemoEscrow,
    }),
    [
      dataMode,
      escrows,
      budget,
      liveHealth,
      loading,
      apiError,
      refresh,
      getEscrowById,
      createDemoEscrow,
      cancelDemoEscrow,
      claimDemoEscrow,
      verifyDemoEscrow,
      settleDemoEscrow,
      refundDemoEscrow,
    ],
  );

  return <RevertDataContext.Provider value={value}>{children}</RevertDataContext.Provider>;
}

export function useRevertData(): RevertDataContextValue {
  const ctx = useContext(RevertDataContext);
  if (!ctx) throw new Error('useRevertData must be used inside RevertDataProvider');
  return ctx;
}
