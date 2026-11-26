# Hackathon Evidence Ledger

> Strict rule: Never invent evidence. Every entry must clearly state its verification tier: `LOCAL`, `MOCKED`, `TESTNET`, `PRODUCTION`, or `NOT VERIFIED`.

## 1. Live Discovery & Challenge Evidence (`TESTNET` — Read-Only, `2026-11-26`)

- **Node:** `https://devnode.telegraphprotocol.com`
- **Intent Verified:** `ONCHAIN_TX_LOOKUP_GENERAL` (`32` active miners, `class: "judgment"`, `onchain.ready: true`, `format_version: 4`)
- **Unpaid `402` Challenge Verified:** `POST /engine/v1/ask` with `{ intent: "ONCHAIN_TX_LOOKUP_GENERAL", params: { tx_hash, chain }, max_budget_usdc: 50000 }` returned HTTP `402` with `PAYMENT-REQUIRED` offering:
  - `scheme: "exact"`, `network: "eip155:84532"`, `amount: "50000"`, `payTo: "0xC0A3FB6d3F1f4B54617d29ffbdA4663Af5F96e2e"`
  - `scheme: "exact"`, `network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"`, `amount: "50000"`
  - `scheme: "escrow"`, `network: "eip155:11155111"`, `amount: "50000"`, `payTo: "0x72a70e949362670bf8bcead24efc5b8f950aa08b"`
- **Ethereum Sepolia On-Chain Probes (`2026-11-26` via `cast call`):**
  - `Diamond (0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b)`:
    - `usdcToken()` -> `0xcc194e1a843B658526D0D5C431f670028582Ae17`
    - `getJobBasePrice()` -> `1000000` (`1.00` test USDC)
    - `getTreasury()` -> `0xC0A3FB6d3F1f4B54617d29ffbdA4663Af5F96e2e`
    - `protocolParams()` -> `(2, 604800, 3600, 300000)`

## 2. Paid Intelligence Purchases (`NOT VERIFIED` — Scheduled for Phase 4)

- Telegraph `receipt_hash`: `NOT VERIFIED`
- Telegraph `signal_hash`: `NOT VERIFIED`
- Observed cost & latency: `NOT VERIFIED`

## 3. Contract Deployments & Escrow Transactions (`NOT VERIFIED` — Scheduled for Phase 4)

- `RevertEscrow.sol` Sepolia deployment address: `NOT VERIFIED`
- Mode A & Mode B Sepolia transaction hashes: `NOT VERIFIED`
