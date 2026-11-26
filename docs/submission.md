# Hackathon Submission Draft — Telegraph Season II

- **Project Name:** REVERT
- **Tagline:** Send with confidence. Settle with proof.
- **Track:** Apps & Agents
- **Mission:** 14 — Web3 Native & DeFi
- **Repository:** `https://github.com/jotel-dev/Revert`
- **Status:** In active development (Phase 1 foundation & feasibility complete; live paid integration and UI pending Phases 3–5).

## Commercial Summary (Draft)

1. **Who is it for?** Web3 counterparties, OTC desks, and agents executing conditional token settlements who need deterministic proof of an external/cross-chain transaction before releasing escrowed funds.
2. **What does it improve?** Replaces manual multisig/human escrow arbitration with programmable recovery windows (Mode A) and deterministic policy evaluation backed by Telegraph ranked intelligence (`ONCHAIN_TX_LOOKUP_GENERAL`) and verifiable receipts.
3. **What does it do today?** Mode A & B smart contracts (`RevertEscrow.sol`) and canonical condition/policy engine (`@revert/shared`) pass local unit & fuzz tests; live Telegraph dry-run discovery & `402` challenge verification run cleanly (`TESTNET` read-only). Paid M2M execution, backend API, and UI remain pending Phases 3–5.
4. **Why would someone adopt it?** Bounded risk (immutable terms, no arbitrary LLM release, permissionless deadline refunds) and low verification cost (`$0.01–$0.05` per check via Telegraph escrow).
5. **How can someone try it?** Follow [reviewer-guide.md](reviewer-guide.md) (`npm install && npm run check && npm run spike:dry-run`).
