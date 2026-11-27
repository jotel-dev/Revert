# Blockers Register

## Active Blockers

### BLOCKER-003 — Testnet Wallets & Sepolia Funding (Required for Live Sepolia E2E & Paid Telegraph Purchase)
- **Severity:** High (blocks live Sepolia deployment and genuine paid Telegraph execution)
- **Category:** Credentials / Funding
- **What is blocked:** Deploying `RevertEscrow.sol` to live Ethereum Sepolia, depositing test USDC into Telegraph Diamond (`0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b`), and executing real paid M2M Telegraph requests (`npm run telegraph:live`).
- **Exact error:** No `.env` file or funded disposable Sepolia wallets exist in `C:\Users\PC\Desktop\Revert` (only `.env.example` is present).
- **Root cause:** Verified — secrets and testnet funds must be provisioned locally by the project owner.
- **What has completed independently:** Phases 1–6 (contracts, Foundry unit/fuzz/invariant suites, shared policy, reusable Telegraph client, Fastify backend, React/Vite UI, Playwright responsive suite, full-stack 18-scenario Anvil + Fastify + Chromium E2E harness, and Phase 6 security review).
- **What is needed from the owner:** Run `node scripts/setup-wallets.mjs --generate` locally to generate 3 disposable Sepolia-only wallets into git-ignored `.env`, fund `DEPLOYER` (`0.05 Sepolia ETH` + `10 Test USDC`) and `TELEGRAPH_PAYER` (`0.01 Sepolia ETH` + `2.00 Test USDC` deposited into Telegraph Diamond `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b`), and authorize Phase 7 broadcast/spend.
- **Impact on deadline / eligibility:** Mandatory paid M2M Telegraph purchase on Sepolia requires these credentials/funds prior to Dec 1, 2026 submission.

### BLOCKER-004 — Hackathon Account-Side Prerequisites
- **Severity:** Medium
- **Category:** Other (Submission Eligibility)
- **What is needed from the owner:** Star `https://github.com/telegraphprotocol/bounties`, confirm Season II registration, and publish `>= 3` original progress updates on separate dates before Dec 1, 2026.

## Resolved Blockers

### BLOCKER-001 — Workspace / Repository Mismatch (`RESOLVED` `2026-11-26`)
- Cloned `https://github.com/jotel-dev/Revert.git` to `C:\Users\PC\Desktop\Revert` and checked out feature branch `feat/protocol-foundation`.

### BLOCKER-002 — Foundry Not Installed (`RESOLVED` `2026-11-26`)
- Installed and SHA256-verified official Foundry `v1.10.0` (`forge`, `cast`, `anvil`) at `%USERPROFILE%\.foundry\bin`.
