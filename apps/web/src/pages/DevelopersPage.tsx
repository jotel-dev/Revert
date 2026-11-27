import { ShieldCheck } from 'lucide-react';
import { Badge, Panel } from '../components/ui.js';
import {
  REVERT_ESCROW_ADDRESS,
  SEPOLIA_TEST_USDC_ADDRESS,
  TELEGRAPH_DIAMOND_ADDRESS,
} from '../lib/contracts.js';

export function DevelopersPage() {
  return (
    <div className="space-y-8 max-w-4xl">
      <div className="space-y-2">
        <Badge tone="accent">Architecture &amp; Security Disclosure</Badge>
        <h1 className="text-2xl font-bold text-[#0B0F17] sm:text-3xl">
          Developer &amp; Security Documentation
        </h1>
        <p className="text-sm text-[#525B6C]">
          Exact network parameters, state-machine permissions, Telegraph integration mechanics, and
          explicit trust boundaries.
        </p>
      </div>

      <Panel className="p-6 space-y-4">
        <h2 className="text-lg font-bold text-[#0B0F17]">
          Verified Network Addresses (Ethereum Sepolia · 11155111)
        </h2>
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-[#667085]">Test USDC (6 decimals)</dt>
            <dd className="font-mono text-[#0B0F17] break-all">{SEPOLIA_TEST_USDC_ADDRESS}</dd>
          </div>
          <div>
            <dt className="text-[#667085]">Telegraph V2 Diamond (Port)</dt>
            <dd className="font-mono text-[#0B0F17] break-all">{TELEGRAPH_DIAMOND_ADDRESS}</dd>
          </div>
          <div>
            <dt className="text-[#667085]">Telegraph Node API</dt>
            <dd className="font-mono text-[#0B0F17]">https://devnode.telegraphprotocol.com</dd>
          </div>
          <div>
            <dt className="text-[#667085]">RevertEscrow Deployment</dt>
            <dd className="font-mono text-[#0B0F17] break-all">
              {REVERT_ESCROW_ADDRESS || 'Not yet deployed (configure VITE_REVERT_ESCROW_ADDRESS)'}
            </dd>
          </div>
        </dl>
      </Panel>

      <Panel className="p-6 space-y-3">
        <h2 className="text-lg font-bold text-[#0B0F17] flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[#1D4ED8]" aria-hidden="true" />
          Trust Assumptions &amp; Signer Control Disclosure
        </h2>
        <ul className="space-y-2 text-sm text-[#525B6C] list-disc pl-5">
          <li>
            <strong className="text-[#0B0F17]">
              Mode A (Protected Payments) is non-custodial:
            </strong>{' '}
            Only the sender can cancel before <code>recoveryWindowEnd</code> and only the recipient
            can claim at or after <code>recoveryWindowEnd</code>.
          </li>
          <li>
            <strong className="text-[#0B0F17]">
              Mode B (Conditional Payments) is attestor-mediated:
            </strong>{' '}
            <code>RevertEscrow</code> verifies an EIP-712 <code>SettlementAttestation</code> signed
            by the immutable <code>escrow.attestor</code>, bound to chain ID, contract address,
            escrow ID, condition hash, outcome, non-zero proof hashes, unique nonce, and expiry.
            This is explicitly <strong>not</strong> claimed to be trustless.
          </li>
          <li>
            <strong className="text-[#0B0F17]">Bounded risk &amp; guaranteed fallback:</strong> The
            attestor cannot steal funds, alter recipient/amount, or trap funds past{' '}
            <code>deadline</code>. Anyone can call <code>refundExpired(escrowId)</code> after the
            deadline expires.
          </li>
        </ul>
      </Panel>

      <Panel className="p-6 space-y-3">
        <h2 className="text-lg font-bold text-[#0B0F17]">Telegraph Integration Summary</h2>
        <p className="text-sm text-[#525B6C] leading-relaxed">
          REVERT queries Telegraph&apos;s canonical <code>ONCHAIN_TX_LOOKUP_GENERAL</code> Intent
          using the Ethereum Sepolia <code>escrow</code> x402v2 rail (<code>eip155:11155111</code>),
          validates <code>signal_hash</code> locally via canonical sorted-JSON{' '}
          <code>keccak256</code>, cross-checks independent JSON-RPC receipts, and enforces integer
          spend limits (<code>&lt;= $0.10</code> per call, <code>&lt;= $2.00</code> aggregate).
        </p>
      </Panel>

      <Panel className="p-6 space-y-3">
        <h2 className="text-lg font-bold text-[#0B0F17]">Known Limitations</h2>
        <ul className="space-y-1.5 text-sm text-[#525B6C] list-disc pl-5">
          <li>Already-finalized conventional transfers outside REVERT cannot be reversed.</li>
          <li>
            Off-chain condition JSON preimages must be registered with the verification engine so
            their <code>keccak256</code> matches the on-chain <code>conditionHash</code>.
          </li>
          <li>
            Live testnet deployment and paid M2M verification require owner-configured local{' '}
            <code>.env</code> secrets and funded Sepolia test wallets.
          </li>
        </ul>
      </Panel>
    </div>
  );
}
