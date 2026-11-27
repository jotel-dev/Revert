# Hackathon Evidence Ledger

> Strict rule: Never invent evidence. Every entry must clearly state its verification tier: `LOCAL`, `MOCKED`, `TESTNET`, `PRODUCTION`, or `NOT VERIFIED`.

## 1. Live Discovery & Challenge Evidence (`TESTNET` — Read-Only)

- **Node:** `https://devnode.telegraphprotocol.com`
- **Intent Verified (`2026-11-26` & `2026-11-27`):** `ONCHAIN_TX_LOOKUP_GENERAL` (`32` active miners, `class: "judgment"`, `onchain.ready: true`, `format_version: 4`)
- **Unpaid `402` Challenge Verified (`npm run telegraph:dry-run` & `node examples/telegraph-conditional-check.mjs`, `2026-11-27`):**
  - Request: `{ intent: "ONCHAIN_TX_LOOKUP_GENERAL", params: { tx_hash: "0x5c504ed4...", chain: "ethereum" }, max_budget_usdc: 50000 }`
  - `PAYMENT-REQUIRED` options:
    - `scheme: "exact"`, `network: "eip155:84532"`, `amount: "50000"`, `payTo: "0xC0A3FB6d3F1f4B54617d29ffbdA4663Af5F96e2e"`
    - `scheme: "exact"`, `network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"`, `amount: "50000"`
    - `scheme: "escrow"`, `network: "eip155:11155111"`, `amount: "50000"`, `payTo: "0x72a70e949362670bf8bcead24efc5b8f950aa08b"`
  - Paid spend executed: `false` (`0 uUSDC` spent)
- **Ethereum Sepolia On-Chain Probes (`https://ethereum-sepolia-rpc.publicnode.com`):**
  - Chain ID `11155111` (live block `12222381` inspected `2026-11-27`)
  - Test USDC (`0xcc194e1a843B658526D0D5C431f670028582Ae17`): `name = "USD Coin"`, `symbol = "USDC"`, `decimals = 6`, `4,210` runtime bytes
  - Telegraph Diamond (`0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b`): `287` runtime proxy bytes; `usdcToken()`, `getJobBasePrice() = 1000000`, `getTreasury()`, `protocolParams()` verified

## 2. Local, Contract & Mocked Full-Stack Evidence (`LOCAL` / `LOCAL-ANVIL` / `MOCKED`)

- **Foundry Smart Contracts (`npm run test:contracts`):** `10/10` tests passing (`9` `RevertEscrowTest` unit/fuzz tests with `256` fuzz runs + `1` `RevertEscrowInvariantTest` suite with `64` runs and `3,200` calls, `0` reverts).
- **TypeScript Unit Suites (`npm run test`):** `23/23` Vitest tests passing (`@revert/shared` `3`, `@revert/telegraph-client` `9`, `@revert/telegraph-spike` `4`, `@revert/api` `4`, `@revert/web` `3`).
- **Playwright UI & Responsive Suite (`npm run test:e2e`):** `5/5` Chromium tests passing across `320px..1440px` (`0` overflow) + desktop/mobile screenshots in `apps/web/screenshots/`.
- **18-Scenario Anvil + Fastify + Chromium Integration (`npm run test:fullstack`):** All `18` scenarios passing (`Mode A` cancel & claim, `Mode B` EIP-712 release, mismatch, raw, `503` outage, duplicate cache, cap exhaustion, unauthorized signer revert, `refundExpired`, refresh recovery, mobile `375x812`).

## 3. Live Paid Intelligence Purchases (`NOT VERIFIED` — `BLOCKER-003`)

- Telegraph `receipt_hash`: `NOT VERIFIED`
- Telegraph `signal_hash`: `NOT VERIFIED`
- Live observed cost & latency: `NOT VERIFIED` (awaiting local `.env` with funded disposable Sepolia wallets)

## 4. Live Sepolia Contract Deployments & Transactions (`NOT VERIFIED` — `BLOCKER-003`)

- `RevertEscrow.sol` Sepolia deployment address: `NOT VERIFIED` (fork simulation cleanly simulated `0x9410c9031b8D168B22bb86aCBd32B0Af2c62A4A8`)
- Mode A & Mode B live Sepolia transaction hashes: `NOT VERIFIED`

## 5. Community Activation Tracker

See [community-activation.md](community-activation.md) (`0` external reproductions/issues recorded; `0 / 3` public posts published yet — drafts ready for separate-date owner publication).
