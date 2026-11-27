import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileSearch,
  Loader2,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';
import { AlertBox, Badge, Button, Panel } from '../components/ui.js';
import { useRevertData } from '../context/RevertDataContext.js';
import { apiClient } from '../lib/api-client.js';
import { REVERT_ESCROW_ABI, REVERT_ESCROW_ADDRESS, SEPOLIA_CHAIN_ID } from '../lib/contracts.js';
import { DEMO_RECIPIENT, DEMO_SENDER } from '../lib/demo-fixtures.js';
import {
  formatCountdown,
  formatTimestamp,
  formatUsdc,
  formatWeb3Error,
  shortAddress,
  shortHash,
} from '../lib/utils.js';

export function PaymentDetailPage() {
  const { id = '' } = useParams();
  const {
    dataMode,
    getEscrowById,
    refresh,
    cancelDemoEscrow,
    claimDemoEscrow,
    verifyDemoEscrow,
    settleDemoEscrow,
    refundDemoEscrow,
  } = useRevertData();

  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();

  const [nowUnix, setNowUnix] = useState(() => Math.floor(Date.now() / 1000));
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [showRawEvidence, setShowRawEvidence] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNowUnix(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);

  const escrow = getEscrowById(id);

  if (!escrow) {
    return (
      <div className="space-y-4">
        <Link
          to="/app"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[#525B6C] hover:text-[#0B0F17]"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to Dashboard
        </Link>
        <Panel className="p-8 text-center space-y-2">
          <h1 className="text-lg font-bold text-[#0B0F17]">Escrow #{id} not found</h1>
          <p className="text-sm text-[#525B6C]">
            This payment ID is not present in the current{' '}
            {dataMode === 'demo' ? 'Demo Fixture' : 'Sepolia Live'} view.
          </p>
        </Panel>
      </div>
    );
  }

  const { onchain, condition, verification, txHistory } = escrow;
  const isLocked = onchain.state === 'LOCKED';
  const windowActive = onchain.mode === 'Protected' && nowUnix < onchain.recoveryWindowEnd;
  const deadlinePassed = nowUnix > onchain.deadline;

  const connectedLower = address?.toLowerCase();
  const canSenderCancel =
    isLocked &&
    onchain.mode === 'Protected' &&
    windowActive &&
    (dataMode === 'demo' || connectedLower === onchain.sender.toLowerCase());

  const canRecipientClaim =
    isLocked &&
    onchain.mode === 'Protected' &&
    !windowActive &&
    (dataMode === 'demo' || connectedLower === onchain.recipient.toLowerCase());

  const canVerify =
    isLocked && onchain.mode === 'Conditional' && !deadlinePassed && Boolean(condition);

  const canSettle =
    isLocked &&
    onchain.mode === 'Conditional' &&
    !deadlinePassed &&
    verification?.status === 'SATISFIED' &&
    Boolean(verification.attestation);

  const canRefundExpired = isLocked && onchain.mode === 'Conditional' && deadlinePassed;

  const runLiveWrite = async (label: string, fn: () => Promise<`0x${string}`>) => {
    setActionError(null);
    setActionSuccess(null);
    if (!isConnected || chainId !== SEPOLIA_CHAIN_ID || !REVERT_ESCROW_ADDRESS || !publicClient) {
      setActionError(
        'Connect an Ethereum Sepolia wallet and configure VITE_REVERT_ESCROW_ADDRESS.',
      );
      return;
    }
    setBusyAction(label);
    try {
      const hash = await fn();
      await publicClient.waitForTransactionReceipt({ hash });
      await refresh();
      setActionSuccess(`${label} confirmed (${shortHash(hash)}).`);
    } catch (err) {
      setActionError(formatWeb3Error(err));
    } finally {
      setBusyAction(null);
    }
  };

  const handleCancel = async () => {
    if (dataMode === 'demo') {
      cancelDemoEscrow(onchain.escrowId, address ?? DEMO_SENDER);
      setActionSuccess('Simulated escrow cancelled and refunded to sender.');
      return;
    }
    await runLiveWrite('Cancel escrow', () =>
      writeContractAsync({
        address: REVERT_ESCROW_ADDRESS as `0x${string}`,
        abi: REVERT_ESCROW_ABI,
        functionName: 'cancelProtected',
        args: [BigInt(onchain.escrowId)],
      }),
    );
  };

  const handleClaim = async () => {
    if (dataMode === 'demo') {
      claimDemoEscrow(onchain.escrowId, address ?? DEMO_RECIPIENT);
      setActionSuccess('Simulated escrow claimed by recipient.');
      return;
    }
    await runLiveWrite('Claim escrow', () =>
      writeContractAsync({
        address: REVERT_ESCROW_ADDRESS as `0x${string}`,
        abi: REVERT_ESCROW_ABI,
        functionName: 'claimProtected',
        args: [BigInt(onchain.escrowId)],
      }),
    );
  };

  const handleVerify = async () => {
    setActionError(null);
    setActionSuccess(null);
    setBusyAction('verify');
    try {
      if (dataMode === 'demo') {
        await verifyDemoEscrow(onchain.escrowId);
        setActionSuccess('Simulated Telegraph verification completed.');
      } else {
        await apiClient.verifyEscrow(onchain.escrowId, { force: true });
        await refresh();
        setActionSuccess('Verification completed against backend engine.');
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Verification failed.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleSettle = async () => {
    if (dataMode === 'demo') {
      settleDemoEscrow(onchain.escrowId, address ?? DEMO_RECIPIENT);
      setActionSuccess('Simulated conditional escrow settled with EIP-712 proof.');
      return;
    }
    const att = verification?.attestation;
    if (!att) return;
    await runLiveWrite('Settle conditional escrow', () =>
      writeContractAsync({
        address: REVERT_ESCROW_ADDRESS as `0x${string}`,
        abi: REVERT_ESCROW_ABI,
        functionName: 'settleConditional',
        args: [
          {
            escrowId: BigInt(att.input.escrowId),
            outcome: att.input.outcome,
            evidenceHash: att.input.evidenceHash,
            signalHash: att.input.signalHash,
            receiptHash: att.input.receiptHash,
            nonce: att.input.nonce,
            issuedAt: BigInt(att.input.issuedAt),
            expiresAt: BigInt(att.input.expiresAt),
          },
          att.signature,
        ],
      }),
    );
  };

  const handleRefundExpired = async () => {
    if (dataMode === 'demo') {
      refundDemoEscrow(onchain.escrowId, address ?? DEMO_SENDER);
      setActionSuccess('Simulated expired escrow refunded to sender.');
      return;
    }
    await runLiveWrite('Refund expired escrow', () =>
      writeContractAsync({
        address: REVERT_ESCROW_ADDRESS as `0x${string}`,
        abi: REVERT_ESCROW_ABI,
        functionName: 'refundExpired',
        args: [BigInt(onchain.escrowId)],
      }),
    );
  };

  const stateTone =
    onchain.state === 'RELEASED' ? 'success' : onchain.state === 'REFUNDED' ? 'neutral' : 'warning';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            to="/app"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#525B6C] hover:text-[#0B0F17]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to Dashboard
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold text-[#0B0F17]">Escrow #{onchain.escrowId}</h1>
            <Badge tone={onchain.mode === 'Conditional' ? 'accent' : 'neutral'}>
              {onchain.mode === 'Protected' ? 'Mode A · Protected' : 'Mode B · Conditional'}
            </Badge>
            <Badge tone={stateTone}>{onchain.state}</Badge>
          </div>
        </div>

        <div className="text-left sm:text-right">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
            Escrowed Value
          </p>
          <p className="font-display text-3xl font-bold tabular-nums text-[#0B0F17]">
            {formatUsdc(onchain.amount)} USDC
          </p>
        </div>
      </div>

      {actionError && (
        <AlertBox tone="danger" title="Action failed">
          {actionError}
        </AlertBox>
      )}
      {actionSuccess && (
        <AlertBox tone="success" title="Update applied">
          {actionSuccess}
        </AlertBox>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left column: Immutable Terms & Actions */}
        <div className="lg:col-span-7 space-y-6">
          <Panel className="p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E4E7EC] pb-3">
              <h2 className="text-base font-bold text-[#0B0F17]">Immutable Payment Terms</h2>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#525B6C] tabular-nums">
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                {isLocked
                  ? onchain.mode === 'Protected'
                    ? `Recovery time: ${formatCountdown(onchain.recoveryWindowEnd, nowUnix)}`
                    : `Deadline: ${formatCountdown(onchain.deadline, nowUnix)}`
                  : 'Settled'}
              </span>
            </div>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-[#667085]">Sender</dt>
                <dd className="font-mono text-xs break-all text-[#0B0F17]">{onchain.sender}</dd>
              </div>
              <div>
                <dt className="text-xs text-[#667085]">Recipient</dt>
                <dd className="font-mono text-xs break-all text-[#0B0F17]">{onchain.recipient}</dd>
              </div>
              <div>
                <dt className="text-xs text-[#667085]">Token Contract</dt>
                <dd className="font-mono text-xs break-all text-[#0B0F17]">{onchain.token}</dd>
              </div>
              <div>
                <dt className="text-xs text-[#667085]">Created At</dt>
                <dd className="text-xs text-[#0B0F17]">{formatTimestamp(onchain.createdAt)}</dd>
              </div>
              {onchain.mode === 'Protected' ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs text-[#667085]">Recovery Window End</dt>
                  <dd className="text-xs font-semibold text-[#0B0F17]">
                    {formatTimestamp(onchain.recoveryWindowEnd)}
                  </dd>
                </div>
              ) : (
                <>
                  <div>
                    <dt className="text-xs text-[#667085]">Settlement Deadline</dt>
                    <dd className="text-xs font-semibold text-[#0B0F17]">
                      {formatTimestamp(onchain.deadline)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[#667085]">Immutable Attestor</dt>
                    <dd className="font-mono text-xs break-all text-[#0B0F17]">
                      {onchain.attestor}
                    </dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-[#667085]">Condition Hash Commitment</dt>
                    <dd className="font-mono text-xs break-all text-[#0B0F17]">
                      {onchain.conditionHash}
                    </dd>
                  </div>
                </>
              )}
            </dl>

            {condition && (
              <div className="rounded-lg border border-[#E4E7EC] bg-[#FAFAFA] p-3.5 text-xs space-y-1.5">
                <p className="font-semibold text-[#0B0F17]">
                  Agreed Verification Condition ({condition.intent})
                </p>
                <p className="text-[#525B6C] font-mono break-all">
                  Chain: {condition.chain} · Tx: {condition.txHash}
                </p>
                <p className="text-[#525B6C] font-mono break-all">
                  Expected To: {condition.expectedTo} · Min ETH: {condition.minValueEth}
                </p>
              </div>
            )}
          </Panel>

          {/* Actions */}
          <Panel className="p-5 sm:p-6 space-y-4">
            <h2 className="text-base font-bold text-[#0B0F17]">Available Contract Actions</h2>

            {!isLocked ? (
              <p className="text-sm text-[#525B6C]">
                This escrow is finalized ({onchain.state}). No further state transitions are
                permitted by <code>RevertEscrow.sol</code>.
              </p>
            ) : onchain.mode === 'Protected' ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="danger"
                    disabled={!canSenderCancel || busyAction !== null}
                    onClick={() => void handleCancel()}
                  >
                    Cancel &amp; Reclaim (Sender)
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!canRecipientClaim || busyAction !== null}
                    onClick={() => void handleClaim()}
                  >
                    Claim Payment (Recipient)
                  </Button>
                </div>
                <p className="text-xs text-[#525B6C]">
                  {windowActive
                    ? 'Recovery window is currently active: only the sender may cancel; recipient claim unlocks once the window closes.'
                    : 'Recovery window has closed: sender cancellation is locked; only the recipient may claim.'}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    disabled={!canVerify || busyAction !== null}
                    onClick={() => void handleVerify()}
                    aria-busy={busyAction === 'verify'}
                  >
                    {busyAction === 'verify' ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        Verifying…
                      </>
                    ) : (
                      <>
                        <FileSearch className="h-4 w-4" aria-hidden="true" />
                        Verify via Telegraph
                      </>
                    )}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={!canSettle || busyAction !== null}
                    onClick={() => void handleSettle()}
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Settle with Proof
                  </Button>
                  <Button
                    variant="danger"
                    disabled={!canRefundExpired || busyAction !== null}
                    onClick={() => void handleRefundExpired()}
                  >
                    <XCircle className="h-4 w-4" aria-hidden="true" />
                    Refund Expired Escrow
                  </Button>
                </div>
                <p className="text-xs text-[#525B6C]">
                  {deadlinePassed
                    ? 'Deadline has passed: settlement is closed and permissionless refundExpired() is unlocked.'
                    : 'Settlement requires a SATISFIED deterministic verdict and valid EIP-712 attestation prior to deadline.'}
                </p>
              </div>
            )}
          </Panel>
        </div>

        {/* Right column: Telegraph Evidence & Tx History */}
        <div className="lg:col-span-5 space-y-6">
          {onchain.mode === 'Conditional' && (
            <Panel className="p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-[#0B0F17]">Telegraph Verification</h2>
                {verification ? (
                  <Badge
                    tone={
                      verification.status === 'SATISFIED'
                        ? 'success'
                        : verification.status === 'CONTRADICTED'
                          ? 'danger'
                          : 'neutral'
                    }
                  >
                    {verification.status}
                  </Badge>
                ) : (
                  <Badge tone="neutral">PENDING</Badge>
                )}
              </div>

              {verification?.latestEvidence ? (
                <div className="space-y-3 text-xs">
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-[#E4E7EC] bg-[#FAFAFA] p-3">
                    <div>
                      <span className="text-[#667085]">Observed Cost</span>
                      <p className="font-display text-sm font-bold tabular-nums text-[#0B0F17]">
                        {formatUsdc(verification.latestEvidence.observedCostUusdc)} USDC
                      </p>
                    </div>
                    <div>
                      <span className="text-[#667085]">Max Authorized</span>
                      <p className="font-display text-sm font-bold tabular-nums text-[#0B0F17]">
                        {formatUsdc(verification.latestEvidence.maxAuthorizedUusdc)} USDC
                      </p>
                    </div>
                    <div>
                      <span className="text-[#667085]">Miner</span>
                      <p className="font-medium text-[#0B0F17]">
                        {verification.latestEvidence.minerName ||
                          verification.latestEvidence.minerId}
                      </p>
                    </div>
                    <div>
                      <span className="text-[#667085]">Signal Verified</span>
                      <p className="font-medium text-[#0B0F17]">
                        {verification.latestEvidence.signalVerified ? 'Cryptographic Match' : 'No'}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <p className="text-[#667085]">
                      Receipt Hash:{' '}
                      <span className="font-mono text-[#0B0F17] break-all">
                        {shortHash(verification.latestEvidence.receiptHash)}
                      </span>
                    </p>
                    {verification.latestEvidence.signalHash && (
                      <p className="text-[#667085]">
                        Signal Hash:{' '}
                        <span className="font-mono text-[#0B0F17] break-all">
                          {shortHash(verification.latestEvidence.signalHash)}
                        </span>
                      </p>
                    )}
                    <p className="text-[#667085]">
                      Policy Reason:{' '}
                      <span className="text-[#0B0F17]">
                        {verification.latestEvidence.reasons.join('; ')}
                      </span>
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowRawEvidence((v) => !v)}
                    className="text-xs font-semibold text-[#1D4ED8] underline underline-offset-2 cursor-pointer"
                  >
                    {showRawEvidence ? 'Hide evidence JSON' : 'Inspect evidence JSON'}
                  </button>

                  {showRawEvidence && (
                    <pre className="max-h-60 overflow-auto rounded-lg border border-[#E4E7EC] bg-[#0B0F17] p-3 text-[11px] text-[#F8FAFC]">
                      {JSON.stringify(
                        {
                          evidence: verification.latestEvidence,
                          attestation: verification.attestation ?? null,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  )}
                </div>
              ) : (
                <div className="flex items-start gap-2 text-xs text-[#525B6C]">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <p>
                    No verification evidence recorded yet. Click{' '}
                    <strong>Verify via Telegraph</strong> to query{' '}
                    <code>ONCHAIN_TX_LOOKUP_GENERAL</code>.
                  </p>
                </div>
              )}
            </Panel>
          )}

          <Panel className="p-5 sm:p-6 space-y-4">
            <h2 className="text-base font-bold text-[#0B0F17]">Transaction History</h2>
            {txHistory && txHistory.length > 0 ? (
              <ul className="space-y-3 text-xs">
                {txHistory.map((item, idx) => (
                  <li
                    key={`${item.txHash}-${idx}`}
                    className="flex items-start justify-between gap-2 border-b border-[#E4E7EC] pb-2.5 last:border-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[#0B0F17]">{item.action}</p>
                      <p className="text-[#525B6C] font-mono truncate">
                        Actor: {shortAddress(item.actor)}
                      </p>
                      <p className="text-[#667085] font-mono truncate">
                        Tx: {shortHash(item.txHash)}
                      </p>
                    </div>
                    <span className="text-[#667085] shrink-0">
                      {formatTimestamp(item.timestamp)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[#525B6C]">
                On-chain state synced from <code>RevertEscrow.getEscrow({onchain.escrowId})</code>.
              </p>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
