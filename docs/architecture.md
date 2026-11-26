# REVERT Architecture

## System Overview

REVERT separates on-chain custody from off-chain intelligence acquisition and deterministic verification:

1. **On-Chain Escrow Custody (`packages/contracts/src/RevertEscrow.sol`)**
   - Deployed on Ethereum Sepolia (`11155111`).
   - Holds allowlisted ERC-20 tokens (`0xcc194e1a843B658526D0D5C431f670028582Ae17` test USDC on Sepolia).
   - Enforces immutable payment terms (`sender`, `recipient`, `token`, `amount`, `recoveryWindowEnd` / `deadline`, `conditionHash`, `attestor`) and strict state transitions (`LOCKED -> RELEASED | REFUNDED`).

2. **Deterministic Policy & Canonical Hashing (`packages/shared`)**
   - Canonicalizes Mode B condition parameters (`ONCHAIN_TX_LOOKUP_GENERAL`) into a sorted JSON payload and computes `conditionHash = keccak256(canonicalJson)`.
   - Evaluates Telegraph Engine responses (`result_shape == "intent"`, `field_status.status == "ok"`, `result.status == "confirmed"`, `fulfillment.status == "complete"`, address/value bounds, verified `signal_hash`, and independent RPC cross-check).
   - Never allows raw or free-form natural language output to release funds.

3. **Autonomous Telegraph Client & Settlement API (`apps/api`, planned Phase 3)**
   - Discovers live Intents and miners dynamically from `https://devnode.telegraphprotocol.com`.
   - Enforces per-request and cumulative spending caps, per-escrow concurrency mutexes, and bounded timeouts/retries.
   - Signs EIP-712 `SettlementAttestation` messages only when `evaluateTxLookupPolicy` returns `RELEASE`.

4. **Fintech Web Interface (`apps/web`, planned Phase 5)**
   - Minimalist light-mode interface built with React, Vite, Tailwind CSS, shadcn/ui, wagmi, and viem.
   - Displays Mode A & Mode B escrow lifecycles, live Telegraph receipts (`receipt_hash`, `signal_hash`), and audit trails.
