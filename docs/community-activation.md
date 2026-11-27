# Community Activation, Public Update Drafts & Evidence Tracker

> **Publication Discipline:** These drafts summarize verified engineering milestones only. They must be reviewed and posted by the project owner on genuine separate calendar dates (and live Sepolia explorer / screenshot links filled in only **after** executing Phase 7). Never backdate posts or fabricate external adoption metrics.

---

## 1. Three Original Public Progress Update Drafts

### Update 1 — The Problem & REVERT Architecture *(Architecture Milestone)*

> **Draft Copy:**
> Standard onchain transfers are final the moment they land — great for settlement certainty, painful when you send to a mistyped address or need proof of an external transaction before releasing funds.
>
> We built **REVERT** (`github.com/jotel-dev/Revert`) for Telegraph Hackathon Season II (Web3 Native & DeFi):
> - **Mode A (Protected Payments):** Senders lock allowlisted ERC-20 tokens with an immutable recovery window (`recoveryWindowEnd`). Cancel before the window ends; recipient claims once it closes. No admin key or third-party signer involved.
> - **Mode B (Conditional Proof Settlement):** Funds release only when an external condition commitment (`conditionHash`) is verified against Telegraph intelligence + EIP-712 attestation before `deadline` — with permissionless post-deadline `refundExpired()` so funds can never get stuck.
>
> `RevertEscrow.sol` passes 9 Foundry unit/fuzz suites (256 runs) and stateful invariants (64 runs, 3,200 calls, 0 reverts). Next up: Telegraph client hardening & live verification.

### Update 2 — Telegraph HTTP 402 Integration & Security Lessons *(Protocol Integration Milestone)*

> **Draft Copy:**
> Integrating autonomous Machine-to-Machine intelligence purchases into an escrow protocol taught us quickly that `402` challenge handling needs strict validation before signing a single byte:
>
> 1. **Rail choice matters:** On `devnode.telegraphprotocol.com`, `ONCHAIN_TX_LOOKUP_GENERAL` currently exposes `32` active miners. Using Telegraph's Sepolia HTTP `escrow` rail keeps everything on `eip155:11155111` at `0.01–0.05` Test USDC per check (verified via unpaid `402` dry-runs) vs `1.00 USDC` base for ERC-8183 onchain jobs.
> 2. **Validate challenge templates strictly:** Our Phase 6 security review caught that signing an escrow `extra.message` without verifying `Amount:`, `Pay To:`, and `Network:` lines inside the human-readable template against the JSON option opens a spoofing surface (`SEC-01` — now fixed and regression-tested).
> 3. **No LLM custody decisions:** Telegraph supplies ranked structured intent data; deterministic TypeScript policy evaluates exact hashes/addresses/amounts before signing an EIP-712 `SettlementAttestation`.
>
> Try our zero-spend dry-run CLI anytime: `npm install && npm run build && npm run telegraph:dry-run`.

### Update 3 — End-to-End Integration, Reproducible Failures & Developer Walkthrough *(Demonstration Milestone)*

> **Draft Copy:**
> We just verified **18 end-to-end scenarios** across `RevertEscrow.sol`, Fastify, and our React/wagmi fintech UI against a local Foundry Anvil node + Playwright Chromium (`npm run test:fullstack`):
> - Wallet connect + wrong-network Sepolia switch + ERC-20 `approve`
> - Mode A sender cancel & recipient post-window claim
> - Mode B Telegraph `402` verify -> EIP-712 `settleConditional` (`RELEASED`)
> - Adversarial & failure cases: mismatched recipient (`CONTRADICTED`), raw payload (`INCONCLUSIVE`), upstream HTTP `503` outage preserving spend cap, aggregate USDC budget exhaustion, duplicate verify deduplication, forged stranger EIP-712 signer rejection (`InvalidAttestorSignature`), and post-deadline `refundExpired`.
>
> *(Owner note: Before publishing Update 3 publicly, execute Phase 7 on live Sepolia and attach the verified Sepolia contract link, live Telegraph receipt hash, and screen recording).*
>
> Independent Web3 developers can reproduce everything locally via `docs/reviewer-guide.md` or test our standalone example `node examples/telegraph-conditional-check.mjs`.

---

## 2. Invitation for Independent Web3 Developers

> **Short Developer Testing Invitation:**
> Building or auditing conditional escrow / x402 flows on Sepolia? We'd appreciate genuine technical feedback on **REVERT** (`https://github.com/jotel-dev/Revert`, branch `feat/protocol-foundation`):
> 1. Run `npm install && npm run check && npm run test:fullstack` to reproduce all Foundry invariants, Vitest suites, and the 18-scenario Anvil + Fastify + Chromium E2E flow locally.
> 2. Run `node examples/telegraph-conditional-check.mjs` to probe Telegraph's live Sepolia `402` challenge (`0` cost) and inspect how REVERT canonicalizes `conditionHash`.
> 3. Review our threat model & signer disclosures in `docs/security-review.md` and open a GitHub issue with any edge cases, gas optimizations, or UX rough edges you find.

---

## 3. Genuine Community & Independent Reproduction Tracker

| Metric | Current Verified Count | Evidence / Notes |
|---|---|---|
| **Published Public Progress Updates** | `0 / 3` | Drafts prepared above; owner needs to publish genuinely on separate dates via official channels before Dec 1, 2026 |
| **Independent Developer Reproductions** | `0` | Not yet distributed externally; log links to real GitHub issues/PRs/discussions only as they arrive |
| **External GitHub Issues / Feedback** | `0` | Track genuine external bug reports, security review comments, or UX suggestions here |
| **Repeat Usage Evidence** | `0` | Track confirmed external reproduction reports here without fabricated metrics or paid engagement |
