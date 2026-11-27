# Telegraph Hackathon Season II Requirements Checklist

- **Competition Window:** Nov 1 – Dec 1, 2026, 23:59 UTC (internal target: Dec 1, 2026, 18:00 WAT)
- **Track:** Apps & Agents
- **Primary Mission:** 14 — Web3 Native & DeFi (`telegraphprotocol/bounties#202`)
- **Minimum Scores:** 70/100 overall; 24/35 Technical Quality & Mainnet Readiness

## Mandatory Eligibility & Judging Criteria

- [x] **Local & Mocked Full-Stack Verification:** `npm run check` (`23` Vitest + `10` Foundry unit/fuzz/invariant), `npm run test:e2e` (`5` Playwright responsive/UI), and `npm run test:fullstack` (`18` Anvil + Fastify + Chromium scenarios) passing on `feat/protocol-foundation`.
- [x] **Documentation & Developer Enablement (Phase 8):** Complete `README.md`, `docs/telegraph-tutorial.md`, `examples/telegraph-conditional-check.mjs`, `docs/reviewer-guide.md`, `docs/security-review.md`, and `docs/community-activation.md`.
- [ ] **Genuine Live Autonomous M2M Purchase on Telegraph (`receipt_hash`, `signal_hash`)** — `NOT VERIFIED` (`BLOCKER-003`: awaiting local `.env` with funded disposable Sepolia wallets & owner broadcast authorization).
- [ ] **Live Ethereum Sepolia Contract Deployment & End-to-End Flows** — `NOT VERIFIED` (`BLOCKER-003`: predeployment report verified; deployment held pending Phase 7 wallet provisioning & authorization).
- [ ] **Star `https://github.com/telegraphprotocol/bounties`** from submitting GitHub account — **OWNER ACTION**.
- [ ] **Publish `>= 3` Original Public Updates on Separate Dates + Gather Independent Developer Feedback** (20 pts community activation) — **OWNER ACTION** (drafts ready in [community-activation.md](community-activation.md)).
- [ ] **2–5 Minute Screen-Recorded Demo + Official Season II Submission** on `hackathon.telegraphprotocol.com` / `anjoman.ai` — **OWNER ACTION** (after Phase 7 live Sepolia execution).
