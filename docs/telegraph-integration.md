# Telegraph Protocol Integration Specification

**Last verified against live node & Sepolia Diamond:** `2026-11-26`

## Official Sources Consulted (`2026-11-26`)

- `https://hackathon.telegraphprotocol.com/` and `/rules`, `/missions`, `/intents`, `/build`
- `https://docs.telegraphprotocol.com/docs/whats-new-v2` (updated Nov 25, 2026)
- `https://docs.telegraphprotocol.com/docs/protocol/addresses-and-params` (updated Nov 26, 2026)
- `https://docs.telegraphprotocol.com/docs/using/x402-inference` (updated Nov 17, 2026)
- `https://docs.telegraphprotocol.com/docs/using/escrow-inference` (updated Nov 25, 2026)
- `https://docs.telegraphprotocol.com/docs/using/engine-ask` (updated Nov 17, 2026)
- `https://docs.telegraphprotocol.com/docs/using/intent-schema` (updated Nov 1, 2026)
- `https://docs.telegraphprotocol.com/docs/using/erc8183-jobs` (updated Nov 25, 2026)
- `https://github.com/telegraphprotocol/bounties/issues/202` (Mission 14: Web3 Native & DeFi)

## Live Verified Network Parameters (`2026-11-26`)

- **Network:** Ethereum Sepolia (`eip155:11155111`)
- **Node HTTP API:** `https://devnode.telegraphprotocol.com`
- **V2 Diamond (Port) Contract:** `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b`
  - Verified on-chain via `cast call`:
    - `usdcToken()` -> `0xcc194e1a843B658526D0D5C431f670028582Ae17`
    - `getTreasury()` -> `0xC0A3FB6d3F1f4B54617d29ffbdA4663Af5F96e2e`
    - `getJobBasePrice()` -> `1000000` (`1.00` test USDC per ERC-8183 job)
    - `protocolParams()` -> `(2, 604800, 3600, 300000)` (`jobCancelDelay = 3600s`, `jobCallbackGas = 300000`)

## Live `402` Challenge Observation (`2026-11-26`)

Probing `POST https://devnode.telegraphprotocol.com/engine/v1/ask` with `{ "intent": "ONCHAIN_TX_LOOKUP_GENERAL", "params": { "tx_hash": "0x...01", "chain": "ethereum" }, "max_budget_usdc": 50000 }` returned HTTP `402` with `PAYMENT-REQUIRED` offering:
1. `scheme: "exact"`, `network: "eip155:84532"` (Base Sepolia Circle USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, `amount: "50000"`, `payTo: "0xC0A3FB6d3F1f4B54617d29ffbdA4663Af5F96e2e"`)
2. `scheme: "exact"`, `network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"` (Solana Devnet, `amount: "50000"`)
3. `scheme: "escrow"`, `network: "eip155:11155111"` (Ethereum Sepolia Diamond `0x72a70e949362670bf8bcead24efc5b8f950aa08b`, `amount: "50000"`)

## Rail Comparison & Selection

| Criterion | HTTP `x402 exact` | HTTP `Telegraph escrow` (**Selected**) | On-Chain `ERC-8183` Job |
|---|---|---|---|
| **Live Networks** | Base Sepolia (`84532`), Solana Devnet (NOT Eth Sepolia on live `402`) | Ethereum Sepolia (`11155111`, Diamond) | Ethereum Sepolia (`11155111`, Diamond) |
| **Unit Cost** | `$0.01` base (no `max_budget_usdc` on Base Sepolia) | `$0.01` base (`$0.05` `max_budget_usdc` supported) | `1.00` test USDC (`getJobBasePrice() = 1000000`) — exceeds `$0.10` cap |
| **Latency** | Synchronous HTTP | Synchronous HTTP (milliseconds) | ~10–15+ minutes (safe block + quorum) |
| **Multi-Miner Recovery** | Not supported on Base Sepolia (`400` error) | Supported (`max_budget_usdc` up to `260000` uUSDC) | Protocol-routed |
| **Proof Artifacts** | `X-TELEGRAPH-RECEIPT` + `signal_hash` | `X-PAYMENT-RESPONSE` (`receipt_hash`) + `signal_hash` + epoch Merkle proof | `JobTerminal` event + callback |
| **Funding Requirement** | Base Sepolia Circle USDC + gas | Sepolia test USDC deposited once via `LedgerFacet.depositUSDC` | Sepolia test USDC approval + gas per job |

**Selected Option:** **Telegraph HTTP `escrow` (`scheme: "escrow"`, `eip155:11155111`)** — the simplest rail that stays natively on Ethereum Sepolia with mintable test USDC (`0xcc194...`), supports multi-miner `max_budget_usdc` recovery within our `$0.10` per-request budget, returns synchronous structured intent outputs, and yields verifiable `receipt_hash` + `signal_hash` proofs.

## Selected Canonical Intent

- **Intent:** `ONCHAIN_TX_LOOKUP_GENERAL`
- **Live status (`2026-11-26`):** `32` active miners (`txlens`, `livecert`, `interlock-onchain-tx-lookup`, `a1-preflight`, etc.), `class: "judgment"`, `onchain.ready: true`, `format_version: 4`
- **Request Params:** `{ tx_hash: string, chain: string }`
- **Response Fields:** `tx_hash`, `status` (`confirmed | reverted | pending | not_found`), `from`, `to`, `block_number`, `value_eth`
- **Integration Status:** Discovery, schema, `402` challenge, and dry-run spike (`npm run spike:dry-run`) verified (`TESTNET` read-only); paid execution `NOT VERIFIED` (pending Phase 4 funded wallets).
