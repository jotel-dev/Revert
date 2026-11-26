# REVERT

**Send with confidence. Settle with proof.**

REVERT is a programmable crypto payment recovery and evidence-based conditional settlement protocol built for **Telegraph Hackathon Season II** (Track: **Apps & Agents**, Primary Mission: **14 — Web3 Native & DeFi**).

> REVERT does **not** reverse already finalized conventional blockchain transfers. All recovery windows and settlement rules are locked immutably in escrow **before** funds are deposited.

## Payment Modes

1. **Mode A — Protected Payments (`createProtectedEscrow`)**
   - Sender locks allowlisted ERC-20 tokens with an agreed immutable `recoveryWindowEnd`.
   - Sender can cancel and reclaim funds strictly before `recoveryWindowEnd`.
   - Recipient can claim funds at or after `recoveryWindowEnd`.
   - Strict `LOCKED -> RELEASED | REFUNDED` state machine prevents double settlement.

2. **Mode B — Evidence-Based Conditional Payments (`createConditionalEscrow`)**
   - Sender locks allowlisted ERC-20 tokens with an immutable `deadline`, `conditionHash`, and `attestor`.
   - REVERT autonomously purchases ranked intelligence from Telegraph using the canonical `ONCHAIN_TX_LOOKUP_GENERAL` Intent.
   - A deterministic policy evaluates the Telegraph result, verifies `signal_hash`, performs an independent RPC sanity check when available, and signs an EIP-712 `SettlementAttestation` only if every requirement is met.
   - If evidence is inconclusive, conflicting, or Telegraph is unavailable, funds stay safely `LOCKED` until valid proof arrives or `deadline` expires (allowing sender refund via `refundExpired`).

## Repository Structure

```text
Revert/
├── packages/
│   ├── contracts/   # Foundry Solidity smart contracts (RevertEscrow.sol)
│   └── shared/      # Strict TypeScript schemas, condition hashing & deterministic policy
├── scripts/         # Cross-platform build/test helpers
└── docs/            # Architecture, security, Telegraph integration & hackathon evidence
```

## Quick Verification (Phase 2)

```bash
npm install
npm run check
```

## Status Legend

- **LOCAL:** Verified on local machine / Foundry Anvil EVM / unit tests.
- **MOCKED:** Verified against deterministic mock responses (no real Telegraph spend).
- **TESTNET:** Verified live on Ethereum Sepolia (`11155111`) / Telegraph `devnode`.
- **PRODUCTION:** Mainnet deployment (NOT APPLICABLE / NOT VERIFIED).
- **NOT VERIFIED:** Not yet executed.

Current phase status: See [docs/development-status.md](docs/development-status.md) and [docs/blockers.md](docs/blockers.md).
