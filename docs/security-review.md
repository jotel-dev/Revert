# REVERT — Phase 6 Security Review & Integration Report

**Date:** 2026-11-27  
**Branch:** `feat/protocol-foundation`  
**Scope:** End-to-end integration and security review across `packages/contracts`, `packages/shared`, `packages/telegraph-client`, `apps/api`, `apps/web`, and `scripts/full-stack-e2e.mjs`.

## 1. Executive Summary

All Phase 6 local integration, adversarial boundary checks, and static/dynamic security suites pass across Foundry, Vitest, Fastify, Vite, and Playwright Chromium backed by a live local Foundry Anvil EVM (`[LOCAL-ANVIL]`) and a controlled local Telegraph mock node (`[MOCKED]`). Live Ethereum Sepolia contract deployment and paid Telegraph testnet execution remain **`[NOT VERIFIED]`** until owner-supplied local `.env` keys and testnet funds are configured (`BLOCKER-003`).

Four concrete security and reliability findings identified during Phase 6 code review were remediated and covered by automated regression tests. No critical or high-severity unmitigated vulnerabilities remain in first-party REVERT code.

## 2. Attack Surface Audit & Findings

### Remediated Findings

| ID | Severity | Component | Finding & Remediation | Verification |
|---|---|---|---|---|
| **SEC-01** | **High** *(Fixed)* | `@revert/telegraph-client` ([client.ts](../packages/telegraph-client/src/client.ts)) | The HTTP `402` challenge escrow rail signed `extra.message` templates after validating `option.amount`, `option.payTo`, and `option.network`, without verifying that `Amount:`, `Pay To:`, and `Network:` lines inside `extra.message` matched those validated fields. Added strict regex comparison rejecting mismatched `extra.message` fields before signing. | Unit test `rejects spoofed extra.message template fields that mismatch option.amount or payTo` (`client.test.ts`) |
| **SEC-02** | **Medium** *(Fixed)* | `@revert/api` ([engine.ts](../apps/api/src/engine.ts)) | `executeVerification` did not guard `BROADCASTED` jobs early against re-execution, and `dryRun` runs overwrote pre-existing `INCONCLUSIVE` state records. Added early return for `BROADCASTED` and preserved existing `INCONCLUSIVE` status during dry-run inspections. | Unit test in `apps/api/test/engine.test.ts` (`dry.status === 'INCONCLUSIVE'`) |
| **SEC-03** | **Medium** *(Fixed)* | `@revert/api` ([escrow-chain.ts](../apps/api/src/escrow-chain.ts)) | `ViemEscrowChainGateway.getEscrow()` previously caught all contract read exceptions and returned `undefined`, masking transient Sepolia RPC outages as missing escrows. Scoped `undefined` return strictly to `EscrowNotFound`; all other RPC errors now propagate explicitly. | Code review & `node scripts/full-stack-e2e.mjs` against Anvil |
| **SEC-04** | **Low** *(Fixed)* | `@revert/web` ([CreatePaymentPage.tsx](../apps/web/src/pages/CreatePaymentPage.tsx)) | `apiClient.registerCondition()` errors during Mode B creation were previously swallowed silently via `.catch(() => undefined)`, risking an on-chain escrow with no backend condition preimage registered. Replaced with explicit error banner surfacing registration failure. | `@revert/web` build + `CreatePaymentPage` Mode B Anvil flow |
| **SEC-05** | **Medium** *(Fixed)* | `@revert/telegraph-client` ([spend-ledger.ts](../packages/telegraph-client/src/spend-ledger.ts)) | `AsyncSpendGuard` previously serialized writes only in-memory per process without reloading persisted snapshots or acquiring a cross-process file lock, risking aggregate budget overrun if CLI (`telegraph:live`) and `@revert/api` ran concurrently on the same `.revert-spend-ledger.json`. Added exclusive `.lock` file coordination (`openSync(..., 'wx')` + stale-lock recovery), disk reload inside lock, and atomic temp-write + `renameSync`. | `spend-and-signal.test.ts` multi-worker + restart test |

### Open / Accepted Risks & Trust Boundaries

| ID | Severity | Area | Assessment & Mitigation |
|---|---|---|---|
| **RISK-01** | **Informational** *(Accepted)* | Centralized Attestor (`RevertEscrow.sol` Mode B) & Key Rotation | `RevertEscrow.sol` binds an immutable `escrow.attestor` per conditional escrow at creation. The attestor can trigger `RELEASE` (only to immutable `recipient`) or `REFUND` (only to immutable `sender`) strictly `<= deadline` using EIP-712 signatures bound to `block.chainid`, `address(this)`, `escrowId`, `conditionHash`, `outcome`, `evidenceHash`, `signalHash`, `receiptHash`, `nonce`, `issuedAt`, and `expiresAt`. Rotating `ATTESTOR_PRIVATE_KEY` cleanly switches newly created escrows (`VITE_ATTESTOR_ADDRESS`) without redeploying the contract, while pre-existing escrows remain safeguarded by permissionless `refundExpired()` after `deadline`. This is **not** claimed to be trustless. |
| **RISK-02** | **Resolved** *(0 Advisories)* | Dependency Audit (`npm audit`) | Upgraded `wagmi` (`^2.15.6` -> `^3.7.11`, moving unused connectors to optional peers and removing `@coinbase/cdp-sdk` / `@reown/*` / `@walletconnect/*` / nested `ws` / `decode-uri-component`), `zod` (`^3.25.0` -> `^4.6.7`), and `vitest` (`^3.2.4` -> `^5.1.2`, resolving both critical `tinypool < 2.1.2` and `@vitest/mocker` advisories). `npm audit` reports **0 vulnerabilities** (`0` critical, `0` high, `0` moderate). |
| **RISK-03** | **Informational** | Forge Linter Constructor Notice | `RevertEscrow.sol` lines 460–461 emit Forge's `require-revert-in-loop` linter warning inside `_setAllowedToken` called from the constructor loop over `initialAllowedTokens` (bounded deployment-time admin list). Safe. |

## 3. Contract & Backend Security Checklist Verification

- **Reentrancy:** `RevertEscrow.sol` inherits OpenZeppelin `ReentrancyGuard` (`nonReentrant` on all state-mutating external functions) and applies Checks-Effects-Interactions (`state = State.RELEASED / REFUNDED` before `safeTransfer`). Tested against `ReentrantMockERC20`.
- **Replay & Binding:** EIP-712 domain binds `RevertEscrow` v1, `block.chainid`, `address(this)`. Struct binds `escrowId`, `conditionHash`, `outcome`, `evidenceHash`, `signalHash`, `receiptHash`, `nonce`, `issuedAt`, `expiresAt`. Contract records both `usedAttestations[digest]` and `usedNonces[attestor][nonce]`.
- **Timestamp Boundaries:** Mode A allows sender cancel strictly `< recoveryWindowEnd` and recipient claim `>= recoveryWindowEnd`. Mode B allows `settleConditional` `<= deadline` and permissionless `refundExpired` strictly `> deadline`. Attestations enforce `issuedAt <= block.timestamp <= expiresAt` and `expiresAt - issuedAt <= MAX_ATTESTATION_TTL` (`1 days`).
- **Integer Precision & ERC-20 Assumptions:** USDC amounts in `@revert/telegraph-client` and `@revert/shared` are handled strictly as integer `bigint` micro-USDC (`uUSDC`, 6 decimals). `RevertEscrow.sol` enforces owner-managed `allowedTokens` (`token.code.length > 0`) and exact balance-delta validation (`_pullExactTokens` rejects `FeeOnTransferMockERC20`).
- **Secret Scanning:** `git ls-files` and `git grep` scan confirmed **0 committed private keys, `.env` files, or API tokens**.

## 4. Phase 6 Scenario Coverage Matrix (18/18 Verified Locally)

| # | Scenario | Verification Tier | Mechanism |
|---|---|---|---|
| 1 | Wallet connection | `[LOCAL-ANVIL]` | Playwright EIP-1193 wallet connects in `@revert/web` |
| 2 | Network switching | `[LOCAL-ANVIL]` | Starts on chain `0x1`, detects mismatch alert, switches via `wallet_switchEthereumChain` to `11155111` and loads `1,000.00 USDC` |
| 3 | Token approval | `[LOCAL-ANVIL]` | ERC-20 `approve()` on etched `MockERC20` (`6` decimals) before escrow creation |
| 4 | Protected payment creation (Mode A) | `[LOCAL-ANVIL]` | Creates Mode A escrow #1 (`25.00 USDC`) |
| 5 | Sender cancellation | `[LOCAL-ANVIL]` | Sender executes `cancelProtected(1)` inside recovery window -> `REFUNDED` |
| 6 | Recipient claim | `[LOCAL-ANVIL]` | Mode A escrow #2 (`30.00 USDC`, 1m window) -> `anvil_increaseTime(120)` -> recipient `claimProtected(2)` -> `RELEASED` |
| 7 | Conditional payment creation (Mode B) | `[LOCAL-ANVIL]` | Registers condition preimage in Fastify API + creates Mode B escrow #3 (`50.00 USDC`) |
| 8 | Autonomous Telegraph verification | `[LOCAL-ANVIL]` + `[MOCKED]` | `POST /api/escrows/3/verify` inspects `402`, signs challenge permit, verifies schema + `signal_hash`, records `0.01 USDC` cost |
| 9 | Settlement when condition satisfied | `[LOCAL-ANVIL]` | Submits signed EIP-712 attestation to `settleConditional(3)` -> `RELEASED` |
| 10 | Invalid / mismatched evidence rejection | `[LOCAL-ANVIL]` + `[MOCKED]` | Mode B #4 receives wrong recipient `to` -> `CONTRADICTED`, settle disabled |
| 11 | Inconclusive evidence | `[LOCAL-ANVIL]` + `[MOCKED]` | Mode B #4 receives `raw` unparsed payload -> `INCONCLUSIVE`, settle disabled |
| 12 | Verification service outage | `[LOCAL-ANVIL]` + `[MOCKED]` | HTTP `503` upstream outage -> `INCONCLUSIVE`, budget reservation released (`committedUusdc` unchanged) |
| 13 | Timeout recovery | `[LOCAL-ANVIL]` | `anvil_increaseTime(4000)` past 1h deadline -> permissionless `refundExpired(4)` -> `REFUNDED` |
| 14 | Duplicate request handling | `[LOCAL-ANVIL]` | Second `POST /api/escrows/3/verify` while `SATISFIED` serves cached attestation without double-charging |
| 15 | Spending-cap enforcement | `[LOCAL-ANVIL]` + `[MOCKED]` | `30,000 uUSDC` aggregate budget exhausted -> 4th attempt rejected cleanly (`remainingUusdc === "0"`) |
| 16 | Unauthorized settlement attempt | `[LOCAL-ANVIL]` | Stranger-signed EIP-712 attestation for #4 rejected by `RevertEscrow.settleConditional` with `InvalidAttestorSignature` |
| 17 | Browser refresh & transaction recovery | `[LOCAL-ANVIL]` | `page.reload()` re-reads settled `RELEASED` & `SATISFIED` state from Anvil + Fastify |
| 18 | Mobile and desktop interactions | `[LOCAL-ANVIL]` + `[MOCKED]` | Zero horizontal overflow (`scrollWidth <= innerWidth`) across `320px..1440px` (`revert.spec.ts`) and live detail view at `375x812` (`full-stack-e2e.mjs`) |

## 5. Pre-Submission Sepolia Live Verification Plan

Once `BLOCKER-003` is resolved locally with funded disposable Sepolia wallets in `.env`:
1. Deploy `RevertEscrow` on Ethereum Sepolia allowing `0xcc194e1a843B658526D0D5C431f670028582Ae17`.
2. Deposit disposable testnet USDC into Telegraph Diamond (`0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b`) and execute `npm run telegraph:live` (`$0.01–$0.02` cap).
3. Run one Mode A cancel, one Mode A claim, and one Mode B live Sepolia conditional settlement via `apps/web` + `apps/api` (`TELEGRAPH_ALLOW_LIVE_SPEND=true`), recording explorer transaction hashes and redacted receipt artifacts in `evidence/live-purchases/`.
