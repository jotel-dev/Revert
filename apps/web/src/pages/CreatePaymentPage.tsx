import {
  computeConditionHash,
  conditionalTxConditionSchema,
  SUPPORTED_TARGET_CHAINS,
  TELEGRAPH_INTENT_NAME,
  type ConditionalTxCondition,
  type SupportedTargetChain,
} from '@revert/shared';
import { ArrowLeft, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { isAddress } from 'viem';
import { useAccount, usePublicClient, useReadContract, useWriteContract } from 'wagmi';
import { AlertBox, Badge, Button, Input, Label, Panel } from '../components/ui.js';
import { useRevertData } from '../context/RevertDataContext.js';
import { apiClient } from '../lib/api-client.js';
import {
  DEFAULT_ATTESTOR_ADDRESS,
  ERC20_ABI,
  REVERT_ESCROW_ABI,
  REVERT_ESCROW_ADDRESS,
  SEPOLIA_CHAIN_ID,
  SEPOLIA_TEST_USDC_ADDRESS,
} from '../lib/contracts.js';
import { DEMO_RECIPIENT, DEMO_SENDER } from '../lib/demo-fixtures.js';
import { formatUsdc, formatWeb3Error, parseUsdc, shortAddress } from '../lib/utils.js';

export function CreatePaymentPage() {
  const navigate = useNavigate();
  const { dataMode, createDemoEscrow, refresh } = useRevertData();
  const { address, isConnected, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: SEPOLIA_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();

  const [mode, setMode] = useState<'Protected' | 'Conditional'>('Protected');
  const [recipient, setRecipient] = useState<string>(DEMO_RECIPIENT);
  const [amountDecimal, setAmountDecimal] = useState<string>('25.00');
  const [recoveryMinutes, setRecoveryMinutes] = useState<string>('60');
  const [deadlineHours, setDeadlineHours] = useState<string>('6');

  // Mode B condition fields
  const [targetChain, setTargetChain] = useState<SupportedTargetChain>('ethereum');
  const [txHash, setTxHash] = useState<string>(
    '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060',
  );
  const [expectedFrom, setExpectedFrom] = useState<string>('');
  const [expectedTo, setExpectedTo] = useState<string>(
    '0xa1e4380a3b1f749673e270229993ee55f45663b4',
  );
  const [minValueEth, setMinValueEth] = useState<string>('0');

  const [step, setStep] = useState<'form' | 'review'>('form');
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: usdcBalance } = useReadContract({
    address: SEPOLIA_TEST_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: SEPOLIA_CHAIN_ID,
    query: { enabled: Boolean(address && chainId === SEPOLIA_CHAIN_ID && dataMode === 'live') },
  });

  const { data: currentAllowance } = useReadContract({
    address: SEPOLIA_TEST_USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && REVERT_ESCROW_ADDRESS ? [address, REVERT_ESCROW_ADDRESS] : undefined,
    query: {
      enabled: Boolean(
        address && REVERT_ESCROW_ADDRESS && chainId === SEPOLIA_CHAIN_ID && dataMode === 'live',
      ),
    },
  });

  const validation = useMemo(() => {
    const errors: string[] = [];
    if (!isAddress(recipient)) errors.push('Recipient must be a valid EVM address.');

    let amountAtomic = 0n;
    try {
      amountAtomic = parseUsdc(amountDecimal);
      if (amountAtomic <= 0n) errors.push('Amount must be greater than 0.');
    } catch {
      errors.push('Enter a valid USDC amount (up to 6 decimals).');
    }

    if (
      dataMode === 'live' &&
      isConnected &&
      usdcBalance !== undefined &&
      amountAtomic > usdcBalance
    ) {
      errors.push(`Insufficient Test USDC balance (${formatUsdc(usdcBalance)} USDC available).`);
    }

    let condition: ConditionalTxCondition | undefined;
    let conditionHash: `0x${string}` | undefined;

    if (mode === 'Protected') {
      const mins = Number(recoveryMinutes);
      if (!Number.isFinite(mins) || mins < 1 || mins > 525600) {
        errors.push('Recovery window must be between 1 minute and 365 days.');
      }
    } else {
      const hrs = Number(deadlineHours);
      if (!Number.isFinite(hrs) || hrs < 1 || hrs > 8760) {
        errors.push('Settlement deadline must be between 1 hour and 365 days.');
      }
      const parsed = conditionalTxConditionSchema.safeParse({
        version: 1,
        intent: TELEGRAPH_INTENT_NAME,
        chain: targetChain,
        txHash,
        ...(expectedFrom.trim() ? { expectedFrom: expectedFrom.trim() } : {}),
        expectedTo,
        minValueEth: Number(minValueEth || '0'),
      });
      if (!parsed.success) {
        errors.push(parsed.error.issues[0]?.message || 'Invalid verification condition.');
      } else {
        condition = parsed.data;
        conditionHash = computeConditionHash(parsed.data);
      }
    }

    return { errors, amountAtomic, condition, conditionHash };
  }, [
    recipient,
    amountDecimal,
    dataMode,
    isConnected,
    usdcBalance,
    mode,
    recoveryMinutes,
    deadlineHours,
    targetChain,
    txHash,
    expectedFrom,
    expectedTo,
    minValueEth,
  ]);

  const handleReview = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (validation.errors.length > 0) {
      setErrorMessage(validation.errors[0] ?? 'Please fix form errors.');
      return;
    }
    setStep('review');
  };

  const handleConfirm = async () => {
    setErrorMessage(null);
    setStatusMessage(null);
    if (validation.errors.length > 0) {
      setErrorMessage(validation.errors[0] ?? 'Invalid input.');
      return;
    }

    if (dataMode === 'demo') {
      const created = createDemoEscrow({
        mode,
        sender: (address as `0x${string}` | undefined) ?? DEMO_SENDER,
        recipient: recipient as `0x${string}`,
        amountAtomic: validation.amountAtomic.toString(),
        recoveryWindowSeconds: Math.round(Number(recoveryMinutes) * 60),
        deadlineSeconds: Math.round(Number(deadlineHours) * 3600),
        ...(validation.condition ? { condition: validation.condition } : {}),
      });
      navigate(`/payments/${created.onchain.escrowId}`);
      return;
    }

    if (!isConnected || !address) {
      setErrorMessage('Connect a Sepolia wallet before submitting a live transaction.');
      return;
    }
    if (chainId !== SEPOLIA_CHAIN_ID) {
      setErrorMessage('Switch to Ethereum Sepolia (11155111) before submitting.');
      return;
    }
    if (!REVERT_ESCROW_ADDRESS || !publicClient) {
      setErrorMessage(
        'VITE_REVERT_ESCROW_ADDRESS is not configured for live Sepolia deployment yet.',
      );
      return;
    }

    setSubmitting(true);
    try {
      const allowance = currentAllowance ?? 0n;
      if (allowance < validation.amountAtomic) {
        setStatusMessage('Step 1/2: Approving Test USDC allowance in wallet…');
        const approveHash = await writeContractAsync({
          address: SEPOLIA_TEST_USDC_ADDRESS,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [REVERT_ESCROW_ADDRESS, validation.amountAtomic],
        });
        setStatusMessage('Waiting for USDC approval confirmation…');
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }

      const nowUnix = Math.floor(Date.now() / 1000);
      setStatusMessage('Step 2/2: Confirming escrow funding transaction…');

      const createHash =
        mode === 'Protected'
          ? await writeContractAsync({
              address: REVERT_ESCROW_ADDRESS,
              abi: REVERT_ESCROW_ABI,
              functionName: 'createProtectedEscrow',
              args: [
                recipient as `0x${string}`,
                SEPOLIA_TEST_USDC_ADDRESS,
                validation.amountAtomic,
                BigInt(nowUnix + Math.round(Number(recoveryMinutes) * 60)),
              ],
            })
          : await writeContractAsync({
              address: REVERT_ESCROW_ADDRESS,
              abi: REVERT_ESCROW_ABI,
              functionName: 'createConditionalEscrow',
              args: [
                recipient as `0x${string}`,
                SEPOLIA_TEST_USDC_ADDRESS,
                validation.amountAtomic,
                BigInt(nowUnix + Math.round(Number(deadlineHours) * 3600)),
                validation.conditionHash!,
                DEFAULT_ATTESTOR_ADDRESS,
              ],
            });

      setStatusMessage('Waiting for Sepolia confirmation…');
      await publicClient.waitForTransactionReceipt({ hash: createHash });

      const nextId = (await publicClient.readContract({
        address: REVERT_ESCROW_ADDRESS,
        abi: REVERT_ESCROW_ABI,
        functionName: 'nextEscrowId',
      })) as bigint;
      const newEscrowId = (nextId - 1n).toString();

      if (mode === 'Conditional' && validation.condition) {
        try {
          await apiClient.registerCondition(newEscrowId, validation.condition);
        } catch (regErr) {
          setErrorMessage(
            `Escrow #${newEscrowId} funded on-chain, but condition registration failed: ${
              regErr instanceof Error ? regErr.message : String(regErr)
            }`,
          );
          return;
        }
      }

      await refresh();
      navigate(`/payments/${newEscrowId}`);
    } catch (err) {
      setErrorMessage(formatWeb3Error(err));
    } finally {
      setSubmitting(false);
      setStatusMessage(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Link
            to="/app"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#525B6C] hover:text-[#0B0F17]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-[#0B0F17]">Create Escrow Payment</h1>
        </div>
        <Badge tone={dataMode === 'demo' ? 'warning' : 'accent'}>
          {dataMode === 'demo' ? 'Simulated Demo Fixture' : 'Ethereum Sepolia'}
        </Badge>
      </div>

      {dataMode === 'live' && !REVERT_ESCROW_ADDRESS && (
        <AlertBox tone="warning" title="Live contract address not configured">
          <code>VITE_REVERT_ESCROW_ADDRESS</code> is unset in this build. You can review the form
          and computed <code>conditionHash</code>, or switch to <strong>Demo Fixtures</strong> in
          the header to test end-to-end creation immediately.
        </AlertBox>
      )}

      {errorMessage && (
        <AlertBox tone="danger" title="Cannot proceed">
          {errorMessage}
        </AlertBox>
      )}

      {statusMessage && (
        <AlertBox tone="accent" title="Transaction in progress">
          <span className="inline-flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            {statusMessage}
          </span>
        </AlertBox>
      )}

      {step === 'form' ? (
        <form onSubmit={handleReview} className="space-y-6">
          <Panel className="p-5 sm:p-6 space-y-5">
            <div className="space-y-2">
              <Label>Payment Mode</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => setMode('Protected')}
                  className={`rounded-xl border p-4 text-left transition-colors cursor-pointer ${
                    mode === 'Protected'
                      ? 'border-[#1D4ED8] bg-[#EFF6FF]/60'
                      : 'border-[#E4E7EC] bg-white hover:bg-[#FAFAFA]'
                  }`}
                >
                  <p className="font-display font-semibold text-sm text-[#0B0F17]">
                    Mode A · Protected Window
                  </p>
                  <p className="mt-1 text-xs text-[#525B6C]">
                    Sender can cancel before the recovery window closes; recipient claims after.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setMode('Conditional')}
                  className={`rounded-xl border p-4 text-left transition-colors cursor-pointer ${
                    mode === 'Conditional'
                      ? 'border-[#1D4ED8] bg-[#EFF6FF]/60'
                      : 'border-[#E4E7EC] bg-white hover:bg-[#FAFAFA]'
                  }`}
                >
                  <p className="font-display font-semibold text-sm text-[#0B0F17]">
                    Mode B · Conditional Proof
                  </p>
                  <p className="mt-1 text-xs text-[#525B6C]">
                    Releases only when Telegraph verifies the agreed transaction condition before
                    deadline.
                  </p>
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="recipient">Recipient Address</Label>
                <Input
                  id="recipient"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="0x..."
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="token">Supported Token</Label>
                <Input
                  id="token"
                  value={`Test USDC (${shortAddress(SEPOLIA_TEST_USDC_ADDRESS)})`}
                  disabled
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="amount">Amount (USDC)</Label>
                <Input
                  id="amount"
                  type="text"
                  inputMode="decimal"
                  value={amountDecimal}
                  onChange={(e) => setAmountDecimal(e.target.value)}
                  placeholder="25.00"
                  required
                />
                {dataMode === 'live' && isConnected && usdcBalance !== undefined && (
                  <p className="text-xs text-[#525B6C] tabular-nums">
                    Wallet balance: {formatUsdc(usdcBalance)} USDC
                  </p>
                )}
              </div>
            </div>

            {mode === 'Protected' ? (
              <div className="space-y-2 pt-2 border-t border-[#E4E7EC]">
                <Label htmlFor="recoveryMinutes">Recovery Window (minutes)</Label>
                <div className="flex flex-wrap gap-2">
                  {['15', '60', '1440'].map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant={recoveryMinutes === preset ? 'secondary' : 'outline'}
                      onClick={() => setRecoveryMinutes(preset)}
                    >
                      {preset === '15' ? '15 min' : preset === '60' ? '1 hour' : '24 hours'}
                    </Button>
                  ))}
                </div>
                <Input
                  id="recoveryMinutes"
                  type="number"
                  min={1}
                  max={525600}
                  value={recoveryMinutes}
                  onChange={(e) => setRecoveryMinutes(e.target.value)}
                />
              </div>
            ) : (
              <div className="space-y-4 pt-3 border-t border-[#E4E7EC]">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#475467]">
                    Telegraph Verification Condition ({TELEGRAPH_INTENT_NAME})
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="targetChain">Target Chain</Label>
                    <select
                      id="targetChain"
                      value={targetChain}
                      onChange={(e) => setTargetChain(e.target.value as SupportedTargetChain)}
                      className="w-full min-h-[44px] rounded-lg border border-[#D0D5DD] bg-white px-3 text-sm text-[#0B0F17]"
                    >
                      {SUPPORTED_TARGET_CHAINS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="deadlineHours">Settlement Deadline (hours)</Label>
                    <Input
                      id="deadlineHours"
                      type="number"
                      min={1}
                      max={8760}
                      value={deadlineHours}
                      onChange={(e) => setDeadlineHours(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="txHash">Expected Transaction Hash</Label>
                    <Input
                      id="txHash"
                      value={txHash}
                      onChange={(e) => setTxHash(e.target.value)}
                      placeholder="0x..."
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="expectedTo">Expected Tx Recipient</Label>
                    <Input
                      id="expectedTo"
                      value={expectedTo}
                      onChange={(e) => setExpectedTo(e.target.value)}
                      placeholder="0x..."
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="minValueEth">Minimum Native Value (ETH)</Label>
                    <Input
                      id="minValueEth"
                      type="number"
                      step="any"
                      min={0}
                      value={minValueEth}
                      onChange={(e) => setMinValueEth(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor="expectedFrom">Expected Tx Sender (Optional)</Label>
                    <Input
                      id="expectedFrom"
                      value={expectedFrom}
                      onChange={(e) => setExpectedFrom(e.target.value)}
                      placeholder="Leave empty to allow any sender"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button type="submit" size="lg" variant="primary">
                Review Terms &amp; Permissions
              </Button>
            </div>
          </Panel>
        </form>
      ) : (
        <Panel className="p-5 sm:p-6 space-y-5">
          <div className="flex items-center justify-between border-b border-[#E4E7EC] pb-4">
            <div>
              <h2 className="text-lg font-bold text-[#0B0F17]">Review Immutable Terms</h2>
              <p className="text-xs text-[#525B6C]">
                Terms cannot be altered once the escrow transaction is confirmed.
              </p>
            </div>
            <Badge tone="accent">{mode === 'Protected' ? 'Mode A' : 'Mode B'}</Badge>
          </div>

          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-[#667085]">Amount</dt>
              <dd className="font-display font-bold tabular-nums">{amountDecimal} USDC</dd>
            </div>
            <div>
              <dt className="text-xs text-[#667085]">Recipient</dt>
              <dd className="font-mono text-xs break-all">{recipient}</dd>
            </div>
            {mode === 'Protected' ? (
              <div className="sm:col-span-2">
                <dt className="text-xs text-[#667085]">Recovery Window</dt>
                <dd className="font-semibold">{recoveryMinutes} minutes from confirmation</dd>
              </div>
            ) : (
              <>
                <div>
                  <dt className="text-xs text-[#667085]">Condition Hash Commitment</dt>
                  <dd className="font-mono text-xs break-all">{validation.conditionHash}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[#667085]">Settlement Deadline</dt>
                  <dd className="font-semibold">{deadlineHours} hours from confirmation</dd>
                </div>
              </>
            )}
          </dl>

          <div className="rounded-xl border border-[#E4E7EC] bg-[#FAFAFA] p-4 space-y-2 text-xs text-[#344054]">
            <p className="font-semibold text-[#0B0F17] flex items-center gap-1.5">
              <ShieldCheck className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
              Party Permissions After Funding
            </p>
            {mode === 'Protected' ? (
              <ul className="space-y-1 list-disc pl-4">
                <li>
                  Sender can cancel and reclaim 100% strictly before the recovery window ends.
                </li>
                <li>Recipient can claim 100% at or after the recovery window ends.</li>
                <li>Neither party or admin can settle or refund twice.</li>
              </ul>
            ) : (
              <ul className="space-y-1 list-disc pl-4">
                <li>
                  Attestor ({shortAddress(DEFAULT_ATTESTOR_ADDRESS)}) can only authorize release to{' '}
                  {shortAddress(recipient)} when Telegraph verifies the exact condition before
                  deadline.
                </li>
                <li>
                  If evidence is inconclusive or Telegraph is unavailable, funds stay locked until
                  the deadline passes.
                </li>
                <li>Anyone can trigger a 100% refund to the sender after the deadline expires.</li>
              </ul>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <Button variant="outline" onClick={() => setStep('form')} disabled={submitting}>
              Edit Terms
            </Button>
            <Button
              variant="primary"
              size="lg"
              onClick={() => void handleConfirm()}
              disabled={submitting}
              aria-busy={submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Confirming…
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  {dataMode === 'demo' ? 'Create Simulated Escrow' : 'Approve & Lock Funds'}
                </>
              )}
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
