import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileCheck2,
  Lock,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Panel } from '../components/ui.js';
import { useRevertData } from '../context/RevertDataContext.js';

export function LandingPage() {
  const [previewMode, setPreviewMode] = useState<'Protected' | 'Conditional'>('Conditional');
  const { setDataMode } = useRevertData();

  return (
    <div className="space-y-14 pb-10">
      {/* Hero */}
      <section className="grid gap-10 lg:grid-cols-12 lg:items-center pt-2">
        <div className="lg:col-span-7 space-y-6">
          <Badge tone="accent">Ethereum Sepolia · Telegraph Season II</Badge>
          <h1 className="text-3xl font-bold tracking-tight text-[#0B0F17] sm:text-5xl leading-[1.1]">
            Send with confidence.
            <br />
            Settle with proof.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-[#525B6C] sm:text-lg">
            REVERT locks ERC-20 payments under immutable recovery windows or objective verification
            conditions before funds ever become final. Cancel mistakes before release, or settle
            automatically only when Telegraph intelligence proves delivery.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link to="/app">
              <Button size="lg" variant="primary">
                Launch App
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
            <Link to="/create">
              <Button size="lg" variant="outline">
                Create Payment
              </Button>
            </Link>
            <Link to="/app?demo=1" onClick={() => setDataMode('demo')}>
              <Button size="lg" variant="ghost">
                Inspect Demo Fixtures
              </Button>
            </Link>
          </div>

          <p className="text-xs text-[#667085]">
            REVERT does not reverse already-finalized conventional blockchain transfers. Protection
            applies only to funds locked through REVERT escrow before settlement.
          </p>
        </div>

        {/* Purposeful interactive product preview */}
        <div className="lg:col-span-5">
          <Panel className="p-5 sm:p-6 shadow-xs">
            <div className="flex items-center justify-between gap-2 border-b border-[#E4E7EC] pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-[#667085]">
                  Protocol Preview
                </p>
                <p className="mt-0.5 font-display text-base font-semibold text-[#0B0F17]">
                  {previewMode === 'Protected'
                    ? 'Mode A · Protected Window'
                    : 'Mode B · Conditional Proof'}
                </p>
              </div>
              <div
                role="tablist"
                aria-label="Preview payment mode"
                className="inline-flex rounded-lg border border-[#E4E7EC] bg-[#F4F5F7] p-0.5 text-xs"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewMode === 'Protected'}
                  onClick={() => setPreviewMode('Protected')}
                  className={`rounded-md px-2.5 py-1 font-medium cursor-pointer ${
                    previewMode === 'Protected' ? 'bg-white text-[#0B0F17]' : 'text-[#525B6C]'
                  }`}
                >
                  Mode A
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={previewMode === 'Conditional'}
                  onClick={() => setPreviewMode('Conditional')}
                  className={`rounded-md px-2.5 py-1 font-medium cursor-pointer ${
                    previewMode === 'Conditional' ? 'bg-white text-[#0B0F17]' : 'text-[#525B6C]'
                  }`}
                >
                  Mode B
                </button>
              </div>
            </div>

            {previewMode === 'Protected' ? (
              <div className="mt-4 space-y-4 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="text-[#525B6C]">Escrowed Amount</span>
                  <span className="font-display text-xl font-bold tabular-nums">250.00 USDC</span>
                </div>
                <div className="rounded-lg border border-[#E4E7EC] bg-[#FAFAFA] p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[#525B6C]">Recovery Window</span>
                    <span className="font-semibold text-[#0B0F17] tabular-nums">30m remaining</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#525B6C]">Sender Right</span>
                    <span className="font-medium text-[#0B0F17]">
                      Cancel & reclaim before expiry
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#525B6C]">Recipient Right</span>
                    <span className="font-medium text-[#525B6C]">Claim after window closes</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-[#047857]">
                  <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Zero off-chain signers. Enforced strictly on-chain.</span>
                </div>
              </div>
            ) : (
              <div className="mt-4 space-y-4 text-sm">
                <div className="flex items-baseline justify-between">
                  <span className="text-[#525B6C]">Conditional Escrow</span>
                  <span className="font-display text-xl font-bold tabular-nums">500.00 USDC</span>
                </div>
                <div className="rounded-lg border border-[#E4E7EC] bg-[#FAFAFA] p-3.5 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#525B6C]">Telegraph Intent</span>
                    <span className="font-mono text-[#0B0F17] truncate">
                      ONCHAIN_TX_LOOKUP_GENERAL
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#525B6C]">Deterministic Policy</span>
                    <Badge tone="success">SATISFIED</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[#525B6C]">Observed Intelligence Cost</span>
                    <span className="font-medium text-[#0B0F17] tabular-nums">0.01 USDC</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-[#1D4ED8]">
                  <FileCheck2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Requires EIP-712 proof + independent RPC check; refunds if expired.</span>
                </div>
              </div>
            )}
          </Panel>
        </div>
      </section>

      {/* How it works */}
      <section className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-2xl font-bold text-[#0B0F17]">How REVERT works</h2>
          <p className="text-sm text-[#525B6C]">
            Three deterministic stages from escrow creation to verified settlement.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Panel className="p-5 space-y-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F4F5F7] text-[#0B0F17]">
              <Lock className="h-4 w-4" aria-hidden="true" />
            </div>
            <h3 className="text-base font-semibold">1. Lock immutable terms</h3>
            <p className="text-sm text-[#525B6C] leading-relaxed">
              Sender locks allowlisted USDC in <code className="text-xs">RevertEscrow</code> with an
              immutable recipient, recovery window or condition commitment hash, and deadline.
            </p>
          </Panel>

          <Panel className="p-5 space-y-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F4F5F7] text-[#0B0F17]">
              <Clock className="h-4 w-4" aria-hidden="true" />
            </div>
            <h3 className="text-base font-semibold">2. Verify proof or wait</h3>
            <p className="text-sm text-[#525B6C] leading-relaxed">
              In Mode A, sender may cancel during the recovery window. In Mode B, REVERT purchases
              ranked Telegraph intelligence within strict budget caps and cross-checks on-chain RPC.
            </p>
          </Panel>

          <Panel className="p-5 space-y-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#F4F5F7] text-[#0B0F17]">
              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            </div>
            <h3 className="text-base font-semibold">3. Release once or reclaim</h3>
            <p className="text-sm text-[#525B6C] leading-relaxed">
              Funds release strictly once to the immutable recipient when rules pass. If evidence is
              inconclusive or services fail, anyone can trigger a refund after the deadline.
            </p>
          </Panel>
        </div>
      </section>

      {/* Honest limitations */}
      <section>
        <Panel className="p-6 bg-[#F8FAFC]">
          <div className="flex items-start gap-3">
            <RotateCcw className="h-5 w-5 shrink-0 text-[#1D4ED8] mt-0.5" aria-hidden="true" />
            <div className="space-y-2">
              <h2 className="text-lg font-semibold text-[#0B0F17]">
                Explicit limitations and trust boundaries
              </h2>
              <ul className="grid gap-2 text-sm text-[#525B6C] sm:grid-cols-3 pt-1">
                <li>
                  <strong className="text-[#0B0F17]">No post-finality reversals:</strong> Standard
                  wallet-to-wallet transfers sent outside REVERT cannot be undone.
                </li>
                <li>
                  <strong className="text-[#0B0F17]">Attestor-mediated Mode B:</strong> Conditional
                  settlement uses a documented EIP-712 attestor signer, not trustless on-chain
                  oracles; post-deadline refunds remain permissionless.
                </li>
                <li>
                  <strong className="text-[#0B0F17]">Public verification inputs:</strong> Only
                  public transaction hashes and chain IDs are sent to Telegraph; never send PII.
                </li>
              </ul>
            </div>
          </div>
        </Panel>
      </section>
    </div>
  );
}
