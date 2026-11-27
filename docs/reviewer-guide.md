# Reviewer Guide

## Reproducing Local & Mocked Verification (`LOCAL` + `LOCAL-ANVIL` + `TESTNET` Read-Only)

1. **Install dependencies:**
   ```bash
   npm install
   ```
2. **Run full static + unit + contract quality suite (Prettier, ESLint, workspace builds, TypeScript, Vitest, Foundry unit/fuzz/invariant tests):**
   ```bash
   npm run check
   ```
3. **Run the UI responsive & Demo Fixtures browser E2E tests (`320px..1440px`):**
   ```bash
   npm run test:e2e
   ```
4. **Run the full-stack Anvil + Fastify + Playwright Chromium integration harness (18 scenarios, Mode A cancel/claim, Mode B EIP-712 settlement, mismatch/outage/cap/unauthorized/timeout flows):**
   ```bash
   npm run test:fullstack
   ```
5. **Run the reusable Telegraph client dry-run (zero spend, inspects live Sepolia Devnode `402` challenge & max expenditure):**
   ```bash
   npm run telegraph:dry-run
   ```

## Live Ethereum Sepolia Execution (`NOT VERIFIED` — Requires Owner `.env`)

1. Copy `.env.example` to `.env` and populate disposable Sepolia keys (`DEPLOYER_PRIVATE_KEY`, `TELEGRAPH_PAYER_PRIVATE_KEY`, `ATTESTOR_PRIVATE_KEY`) funded with Sepolia ETH and Test USDC (`0xcc194e1a843B658526D0D5C431f670028582Ae17`).
2. Run a gated live testnet intelligence purchase (`TELEGRAPH_ALLOW_LIVE_SPEND=true` inside local script environment):
   ```bash
   npm run telegraph:live
   ```
3. Deploy `RevertEscrow` to Sepolia, configure `REVERT_ESCROW_ADDRESS` + `VITE_REVERT_ESCROW_ADDRESS` + `VITE_ATTESTOR_ADDRESS`, start `@revert/api` and `@revert/web`, and settle a conditional escrow with live Telegraph evidence. See [security-review.md](./security-review.md) for the complete threat and trust-model breakdown.
