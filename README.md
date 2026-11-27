# REVERT

**Send with confidence. Settle with proof.**

REVERT is a programmable crypto payment recovery and evidence-based conditional settlement protocol built for **Telegraph Hackathon Season II** (Track: **Apps & Agents**, Primary Mission: **14 — Web3 Native & DeFi**).

> **Protocol Scope Disclosure:** REVERT does **not** reverse already finalized conventional blockchain transfers. All recovery windows, deadlines, condition commitments, and attestor bindings are written immutably into `RevertEscrow.sol` **before** funds are deposited.

---

## 1. Why REVERT & Why Telegraph

Standard token transfers become irreversible the moment they finalize: a wrong recipient address, premature transfer, or unverified counterparty action leaves users with zero structured recourse. Conversely, conditional cross-chain or off-chain milestone payments traditionally require bespoke oracle contracts or subjective human multisig arbitration.

REVERT solves this with two deterministic escrow primitives in a single audited-pattern contract ([RevertEscrow.sol](packages/contracts/src/RevertEscrow.sol)):

1. **Mode A — Protected Payments (`createProtectedEscrow`):**
   - Senders lock allowlisted ERC-20 tokens (`Test USDC` on Sepolia) with an immutable `recoveryWindowEnd`.
   - Strictly before `recoveryWindowEnd`, **only the sender** can call `cancelProtected(escrowId)` to recover 100% of funds.
   - At or after `recoveryWindowEnd`, **only the recipient** can call `claimProtected(escrowId)`.
   - Non-custodial between sender, recipient, and contract; no off-chain signer or admin key can redirect or freeze Mode A funds.

2. **Mode B — Evidence-Based Conditional Payments (`createConditionalEscrow`):**
   - Senders lock allowlisted ERC-20 tokens with an immutable `deadline`, `conditionHash = keccak256(canonicalConditionJson)`, and `attestor`.
   - **Why Telegraph is necessary:** When settlement depends on an external chain transaction or milestone (`ONCHAIN_TX_LOOKUP_GENERAL`), an onchain Ethereum Sepolia contract cannot directly inspect external chains or pay RPC indexers cleanly. REVERT's verification engine autonomously discovers eligible funded escrows, inspects Telegraph HTTP `402` payment challenges, purchases ranked miner intelligence within hard USDC spending limits (`AsyncSpendGuard`), verifies `signal_hash`, cross-checks RPC state where available, and runs deterministic TypeScript policy evaluation ([policy.ts](packages/shared/src/policy.ts)).
   - Only if every condition field matches (`SATISFIED`) does the isolated attestor sign a domain-bound EIP-712 `SettlementAttestation` for `settleConditional(input, sig)`.
   - If evidence is mismatched (`CONTRADICTED`), unparsed (`INCONCLUSIVE`), or Telegraph is offline, funds remain safely `LOCKED` until valid proof arrives or `block.timestamp > deadline`, when anyone can trigger permissionless `refundExpired(escrowId)`.

---

## 2. Architecture & Technology Stack

```text
Revert/
├── packages/
│   ├── contracts/         # Solidity 0.8.24 + Foundry + OpenZeppelin (RevertEscrow.sol, DeployRevertEscrow.s.sol)
│   ├── shared/            # Zod schemas, canonical conditionHash, deterministic Mode B policy
│   ├── telegraph-client/  # Reusable M2M HTTP 402 escrow & @x402/fetch SDK, spend caps, signal verifier
│   └── telegraph-spike/   # Initial Phase 1 read-only Telegraph feasibility & dry-run probe
├── apps/
│   ├── api/               # Fastify backend, VerificationEngine, EIP-712 attestor, independent RPC sanity check
│   └── web/               # React + Vite + Tailwind + wagmi/viem + Lucide fintech interface & Playwright E2E
├── examples/              # Minimal reusable developer integration example
├── scripts/               # Cross-platform Forge runner, ABI exporter, 18-scenario full-stack Anvil E2E harness
└── docs/                  # Architecture, security review, Telegraph tutorial, blockers, evidence & community drafts
```

- **Smart Contracts:** Solidity `0.8.24`, Foundry (`forge`, `anvil`), OpenZeppelin (`Ownable2Step`, `ReentrancyGuard`, `SafeERC20`, `EIP712`, `ECDSA`, `SafeCast`)
- **Backend & Client SDK:** TypeScript, Node.js `>=20`, Fastify, Zod, `viem`, `@x402/fetch`, `@x402/evm`, `async-mutex`
- **Frontend:** React, TypeScript, Tailwind CSS, `wagmi`, `viem`, Lucide icons, `Manrope` & `Space Grotesk` typography

For the complete state machine diagram and boundary guarantees, see [docs/architecture.md](docs/architecture.md).

---

## 3. Networks, Contract Addresses & Observed Costs

| Component                  | Network / Endpoint                     | Status                         | Value                                                         |
| -------------------------- | -------------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| **Target Chain**           | Ethereum Sepolia (`eip155:11155111`)   | Verified RPC                   | Chain ID `11155111`                                           |
| **Allowlisted ERC-20**     | Ethereum Sepolia Test USDC             | Verified Onchain               | `0xcc194e1a843B658526D0D5C431f670028582Ae17` (`decimals = 6`) |
| **Telegraph V2 Diamond**   | Ethereum Sepolia (`eip155:11155111`)   | Verified Onchain               | `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b`                  |
| **Telegraph Devnode**      | HTTP API (`ONCHAIN_TX_LOOKUP_GENERAL`) | Verified (`402` Read-Only)     | `https://devnode.telegraphprotocol.com`                       |
| **REVERT Escrow Contract** | Ethereum Sepolia                       | `NOT VERIFIED` (`BLOCKER-003`) | Pending owner `.env` wallet funding for Phase 7 deployment    |
| **Mainnet Deployment**     | Ethereum Mainnet                       | `NOT APPLICABLE`               | Not deployed                                                  |

### Observed Request Costs & Limits

- **Telegraph `ONCHAIN_TX_LOOKUP_GENERAL` Live `402` Challenge Quote:**
  - `2026-11-26`: `50000 uUSDC` (`$0.05` `max_budget_usdc`, `$0.01` base) via Sepolia `escrow` rail (`0x72a70e...`).
  - `2026-11-27` (`npm run telegraph:dry-run`): `50000 uUSDC` (`$0.05` Test USDC) across `32` active miners.
- **Configured Safety Caps:** `MAX_PER_REQUEST_UUSDC=100000` (`$0.10 USDC`), `MAX_TOTAL_BUDGET_UUSDC=2000000` (`$2.00 USDC`), `TELEGRAPH_ALLOW_LIVE_SPEND=false` by default.
- **Live Paid Sepolia Request Receipts:** **`NOT VERIFIED`** until local `.env` wallets are funded (`BLOCKER-003`). Local mocked + Anvil E2E exercises `10000 uUSDC` (`0.01 USDC`) per check.

---

## 4. Setup & Local Development

### Prerequisites

- Node.js `>= 20.0.0` & npm
- Foundry (`forge`, `anvil`, `cast`) — see `scripts/run-forge.mjs`

### Installation & Build

```bash
npm install
npm run build
```

### Environment Variables (Never Commit `.env`)

Copy `.env.example` to `.env` locally and inspect all variables in [.env.example](.env.example):

- Network & contracts: `CHAIN_ID`, `SEPOLIA_RPC_URL`, `REVERT_ESCROW_ADDRESS`, `SUPPORTED_USDC_ADDRESS`, `TELEGRAPH_DIAMOND_ADDRESS`
- Telegraph client & spend controls: `TELEGRAPH_NODE_URL`, `TELEGRAPH_PAYMENT_RAIL`, `MAX_PER_REQUEST_UUSDC`, `MAX_TOTAL_BUDGET_UUSDC`, `TELEGRAPH_ALLOW_LIVE_SPEND`
- Server-only wallets (keep blank unless running live testnet): `DEPLOYER_PRIVATE_KEY`, `TELEGRAPH_PAYER_PRIVATE_KEY`, `ATTESTOR_PRIVATE_KEY`, `BROADCASTER_PRIVATE_KEY`
- Fastify API & frontend: `API_HOST`, `API_PORT`, `CORS_ORIGIN`, `API_AUTH_TOKEN`, `ENABLE_SERVER_BROADCASTER`, plus optional Vite build env (`VITE_REVERT_ESCROW_ADDRESS`, `VITE_ATTESTOR_ADDRESS`, `VITE_SEPOLIA_RPC_URL`)

### Local Development Servers

```bash
# Terminal 1: Fastify verification backend (requires ATTESTOR_PRIVATE_KEY & RPC in local .env)
npm --workspace=@revert/api run start

# Terminal 2: React/Vite frontend (supports offline Demo Fixtures at /app?demo=1)
npm --workspace=@revert/web run dev
```

---

## 5. Verification, Testing & Reproduction

### Full Static, Unit & Smart Contract Suite (`LOCAL`)

```bash
npm run check
```

Runs Prettier, ESLint, workspace builds, TypeScript `typecheck`, `23` Vitest tests (`@revert/shared` `3`, `@revert/telegraph-client` `9`, `@revert/telegraph-spike` `4`, `@revert/api` `4`, `@revert/web` `3`), and Foundry (`9` unit/fuzz tests with `256` fuzz runs + `1` stateful invariant suite with `64` runs / `3,200` calls).

### Playwright UI & Responsive Suite (`MOCKED`)

```bash
npm run test:e2e
```

Executes `5` Playwright Chromium E2E tests covering Landing mode toggles, live offline honest empty states, Demo Fixtures Mode A/B workflows, Developer/Security disclosure assertions, and `0` horizontal overflow across `320px..1440px` viewports.

### 18-Scenario Full-Stack Anvil + Fastify + Chromium E2E (`LOCAL-ANVIL` + `MOCKED`)

```bash
npm run test:fullstack
```

Spins up local Anvil (`chainId 11155111`), deploys compiled `RevertEscrow.sol`, etches `MockERC20` + `MockMulticall3`, starts the real Fastify Verification API and a mocked Telegraph challenge node, builds `@revert/web`, and exercises all 18 Phase 6 scenarios (wallet connect, network switch, approval, Mode A cancel/claim, Mode B verify/settle, duplicate verify cache, spending-cap exhaustion, stranger EIP-712 rejection, mismatch/raw/503 outage handling, deadline warp + `refundExpired`, refresh recovery, and mobile viewport check).

### Zero-Spend Live Telegraph Dry-Run (`TESTNET` Read-Only)

```bash
npm run telegraph:dry-run
# Or run the standalone developer example:
node examples/telegraph-conditional-check.mjs
```

### Live Integration Reproduction (`TESTNET` — Requires Owner `.env`)

1. Copy `.env.example` to `.env` locally with funded disposable Sepolia wallets (`DEPLOYER_PRIVATE_KEY`, `TELEGRAPH_PAYER_PRIVATE_KEY`, `ATTESTOR_PRIVATE_KEY`).
2. Deposit Test USDC (`0xcc194e1a843B658526D0D5C431f670028582Ae17`) into Telegraph Diamond (`0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b`) via `LedgerFacet.depositUSDC(amount)`.
3. Run a bounded live Telegraph purchase (`TELEGRAPH_ALLOW_LIVE_SPEND=true` inside local `.env`):
   ```bash
   npm run telegraph:live
   ```
4. Deploy `RevertEscrow.sol` (`BROADCAST=true forge script ...`), set `REVERT_ESCROW_ADDRESS`, `VITE_REVERT_ESCROW_ADDRESS`, and `VITE_ATTESTOR_ADDRESS`, start `@revert/api` and `@revert/web`, and settle a Mode B conditional escrow on Sepolia (`NOT VERIFIED` locally until `.env` is provisioned — see [docs/blockers.md](docs/blockers.md)).

### Failure-Case Reproduction

1. **Spoofed `402` challenge template / Spending-cap breach / Duplicate request:** Covered deterministically in [client.test.ts](packages/telegraph-client/test/client.test.ts) and [engine.test.ts](apps/api/test/engine.test.ts).
2. **Mismatched evidence (`CONTRADICTED`), unparsed `raw` output (`INCONCLUSIVE`), upstream `503` outage, unauthorized EIP-712 signer (`InvalidAttestorSignature`), spending-cap exhaustion, and timeout `refundExpired()` recovery:** Verified end-to-end against real `RevertEscrow.sol` in `npm run test:fullstack`.

---

## 6. Deployment & Trust Limitations

### Deployment Simulation (`Dry-Run`) vs Live Sepolia

```bash
cd packages/contracts
forge script script/DeployRevertEscrow.s.sol:DeployRevertEscrow --fork-url https://ethereum-sepolia-rpc.publicnode.com -vv
```

Live broadcast requires explicit `BROADCAST=true` and funded disposable Sepolia wallets configured in local `.env` (see [docs/deployment.md](docs/deployment.md) and [docs/blockers.md](docs/blockers.md)).

### Trust & Security Disclosures

- **No LLM Custody Decisions:** Mode B never delegates fund-release authorization to an LLM. Deterministic schema/policy rules evaluate structured Telegraph data.
- **Mode B Is Attestor-Mediated (Not Claimed Trustless):** Mode B binds an immutable `escrow.attestor` at funding time (`@revert/api`). That signer can trigger `RELEASE` strictly to `escrow.recipient` or `REFUND` strictly to `escrow.sender` before `deadline`, but cannot change recipients/amounts/tokens or trap funds past `deadline` (thanks to permissionless `refundExpired`).
- Full threat model, dependency audit (`npm audit`), and Phase 6 findings: [docs/security-review.md](docs/security-review.md) and [docs/security.md](docs/security.md).

---

## 7. Guides, AI Disclosure & License

- **Beginner Telegraph Tutorial:** [docs/telegraph-tutorial.md](docs/telegraph-tutorial.md)
- **Reviewer Guide:** [docs/reviewer-guide.md](docs/reviewer-guide.md)
- **Standalone Integration Example:** [examples/telegraph-conditional-check.mjs](examples/telegraph-conditional-check.mjs)
- **Community Activation & Public Update Drafts:** [docs/community-activation.md](docs/community-activation.md)
- **AI-Assisted Development Disclosure:** [docs/ai-usage.md](docs/ai-usage.md)
- **License & Reused Components:** Released under the [MIT License](LICENSE). Built using OpenZeppelin Contracts, Foundry/Forge, Viem, Wagmi, `@x402/fetch`, `@x402/evm`, Fastify, Zod, React, Vite, Tailwind CSS, and Lucide Icons.
