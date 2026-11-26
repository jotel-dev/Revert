# Telegraph Protocol Integration Specification

**Last verified against live node:** `2026-11-26`

## Official Sources Consulted (`2026-11-26`)

- `https://hackathon.telegraphprotocol.com/` and `/rules`, `/missions`, `/intents`, `/build`
- `https://docs.telegraphprotocol.com/docs/whats-new-v2` (updated Nov 25, 2026)
- `https://docs.telegraphprotocol.com/docs/protocol/addresses-and-params` (updated Nov 26, 2026)
- `https://docs.telegraphprotocol.com/docs/using/x402-inference` (updated Nov 17, 2026)
- `https://docs.telegraphprotocol.com/docs/using/escrow-inference` (updated Nov 25, 2026)
- `https://docs.telegraphprotocol.com/docs/using/engine-ask` (updated Nov 17, 2026)
- `https://docs.telegraphprotocol.com/docs/using/intent-schema` (updated Nov 1, 2026)
- `https://github.com/telegraphprotocol/bounties/issues/202` (Mission 14: Web3 Native & DeFi)

## Live Verified Network Parameters (`2026-11-26`)

- **Network:** Ethereum Sepolia (`eip155:11155111`)
- **Node HTTP API:** `https://devnode.telegraphprotocol.com`
- **V2 Diamond (Port) Contract:** `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b` (verified bytecode on Sepolia)
- **Test USDC Contract:** `0xcc194e1a843B658526D0D5C431f670028582Ae17` (6 decimals, verified bytecode on Sepolia)

## Live `402` Challenge Observation (`2026-11-26`)

Probing `POST https://devnode.telegraphprotocol.com/engine/v1/ask` returned HTTP `402` with `PAYMENT-REQUIRED` offering:
1. `scheme: "exact"`, `network: "eip155:84532"` (Base Sepolia Circle USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, `amount: "10000"`)
2. `scheme: "exact"`, `network: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"` (Solana Devnet)
3. `scheme: "escrow"`, `network: "eip155:11155111"` (Ethereum Sepolia Diamond `0x72a70e949362670bf8bcead24efc5b8f950aa08b`, `amount: "10000"`)

**Architectural consequence:** On Ethereum Sepolia, HTTP intelligence purchases (and all `max_budget_usdc` multi-miner asks) use the **Telegraph `escrow` x402 v2 scheme** (`X-PAYMENT` header with EIP-191 `personal_sign` against `LedgerFacet.depositUSDC` balance).

## Selected Canonical Intent

- **Intent:** `ONCHAIN_TX_LOOKUP_GENERAL`
- **Live status (`2026-11-26`):** `32` active miners, `class: "judgment"`, `onchain.ready: true`, `format_version: 4`
- **Request Params:** `{ tx_hash: string, chain: string }`
- **Response Fields:** `tx_hash`, `status` (`confirmed | reverted | pending | not_found`), `from`, `to`, `block_number`, `value_eth`
- **Integration Status:** Discovery & schema verified (`TESTNET`); paid execution `NOT VERIFIED` (pending Phase 4 funded wallets).
