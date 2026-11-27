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
3. **Run the reusable Telegraph client dry-run (zero spend, inspects live `402` challenge & max expenditure):**
   ```bash
   npm run telegraph:dry-run
   ```
4. **Run a gated live testnet intelligence purchase (requires local `.env` with funded wallet & `TELEGRAPH_ALLOW_LIVE_SPEND=true`):**
   ```bash
   npm run telegraph:live
   ```
5. **Run Playwright browser E2E & responsive checks (`320px..1440px`):**
   ```bash
   npm run test:e2e
   ```

## End-to-End Testnet Reproduction (`NOT VERIFIED`)

Full backend API, Sepolia escrow execution, and frontend E2E instructions will be populated here once Phases 3–5 complete.
