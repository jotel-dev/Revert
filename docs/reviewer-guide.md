# Reviewer Guide

## Reproducing Current Phase 1 Verification (`LOCAL` + `TESTNET` Read-Only)

1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Run full quality suite (formatting, ESLint, TypeScript, builds, Vitest, Foundry unit & fuzz tests):**
   ```bash
   npm run check
   ```
3. **Run the bounded Telegraph dry-run integration spike (zero spend):**
   ```bash
   npm run spike:dry-run
   ```
   This inspects the live `ONCHAIN_TX_LOOKUP_GENERAL` Intent schema, discovers active ranked miners, performs an unpaid `POST /engine/v1/ask` request to verify the live `402 PAYMENT-REQUIRED` challenge, validates the quoted cost against the `$0.10` per-request budget cap, and exits without signing or broadcasting.

## End-to-End Testnet Reproduction (`NOT VERIFIED`)

Full backend API, Sepolia escrow execution, and frontend E2E instructions will be populated here once Phases 3–5 complete.
