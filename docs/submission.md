# Hackathon Submission Draft — Telegraph Season II

- **Project Name:** REVERT
- **Tagline:** Send with confidence. Settle with proof.
- **Track:** Apps & Agents
- **Mission:** 14 — Web3 Native & DeFi
- **Repository:** `https://github.com/jotel-dev/Revert` (branch `feat/protocol-foundation`)
- **Status:** Architecture, smart contracts, `@revert/telegraph-client`, Fastify verification engine, React/Vite fintech UI, Phase 6 security review, 18-scenario Anvil integration harness, and Phase 8 documentation complete. Live Sepolia deployment & paid Telegraph M2M execution await local `.env` wallet funding & broadcast authorization (`BLOCKER-003`).

## Commercial Summary (Draft)

1. **Who is it for?** Web3 counterparties, OTC desks, and agents executing conditional token settlements who need deterministic proof of an external/cross-chain transaction before releasing escrowed funds.
2. **What does it improve?** Replaces manual multisig/human escrow arbitration with programmable recovery windows (Mode A) and deterministic policy evaluation backed by Telegraph ranked intelligence (`ONCHAIN_TX_LOOKUP_GENERAL`) and EIP-712 verifiable settlement attestations (Mode B).
3. **What does it do today?** Mode A & B contracts (`RevertEscrow.sol`), `@revert/shared` condition hashing & policy engine, `@revert/telegraph-client`, Fastify API, and `@revert/web` UI pass all local, mocked, Playwright responsive (`320px..1440px`), and 18-scenario local Anvil full-stack E2E tests. Live Telegraph `402` dry-run inspection succeeds on Sepolia devnode (`50000 uUSDC` quote); live Sepolia deployment and paid Telegraph execution await `BLOCKER-003`.
4. **Why would someone adopt it?** Bounded risk (immutable terms, zero arbitrary LLM custody decisions, strict USDC spending caps, permissionless post-deadline `refundExpired`) and low verification cost (`$0.01–$0.05` Test USDC per check via Telegraph escrow).
5. **How can someone try it?** Follow [README.md](../README.md) and [reviewer-guide.md](reviewer-guide.md) (`npm install && npm run check && npm run test:fullstack && npm run telegraph:dry-run`), or run `node examples/telegraph-conditional-check.mjs`.
