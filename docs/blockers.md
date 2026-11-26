# Blockers Register

## Active Blockers

### BLOCKER-003 — Testnet Wallets & Sepolia ETH Funding (Required for Phase 4)
- **Severity:** High (blocks Phase 4 deployment & live paid Telegraph requests)
- **Category:** Credentials / Funding
- **What is blocked:** Deploying `RevertEscrow.sol` to Sepolia, minting/depositing test USDC into Telegraph Diamond, and executing live paid Telegraph requests.
- **Exact error:** No `.env` file or funded disposable Sepolia wallets exist in `C:\Users\PC\Desktop\Revert` (only `.env.example` is present).
- **Root cause:** Verified — fresh repository; secrets and testnet funding must be configured locally by the owner.
- **What can continue independently:** Phases 2 and 3 (contracts, local Foundry tests, shared policy, backend API, mocked Vitest tests).
- **What is needed from the owner:** Configure local `.env` with disposable Sepolia wallets (`DEPLOYER_PRIVATE_KEY`, `TELEGRAPH_PAYER_PRIVATE_KEY`, `ATTESTOR_PRIVATE_KEY`) funded with ~`0.05` Sepolia ETH before Phase 4.
- **Impact on deadline / eligibility:** Mandatory M2M paid Telegraph purchase requires this in Phase 4.

### BLOCKER-004 — Hackathon Account-Side Prerequisites
- **Severity:** Medium
- **Category:** Other (Submission Eligibility)
- **What is needed from the owner:** Star `https://github.com/telegraphprotocol/bounties`, confirm Season II registration, and publish `>= 3` original progress updates on separate dates before Dec 1, 2026.

## Resolved Blockers

### BLOCKER-001 — Workspace / Repository Mismatch (`RESOLVED` `2026-11-26`)
- Cloned `https://github.com/jotel-dev/Revert.git` to `C:\Users\PC\Desktop\Revert` and created branch `feat/protocol-foundation`.

### BLOCKER-002 — Foundry Not Installed (`RESOLVED` `2026-11-26`)
- Installed and SHA256-verified official Foundry `v1.10.0` (`forge`, `cast`, `anvil`) at `%USERPROFILE%\.foundry\bin`.
