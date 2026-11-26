# AGENTS.md — REVERT Engineering Guidelines

## Architecture & Principles

- Deterministic application logic and autonomous machine-to-machine (M2M) intelligence purchases via Telegraph Protocol. No conversational AI assistant.
- Never claim REVERT reverses already finalized conventional blockchain transfers.
- Treat all external inputs, Telegraph miner responses, and off-chain RPC observations as untrusted.
- Document trusted backend attestor assumptions explicitly; never describe Mode B as fully trustless.

## Mandatory Development & Git Rules

- Never commit directly to `main`. Work on descriptive feature branches and open PRs after passing `npm run check`.
- Never commit secrets, `.env`, private keys, or keystore files.
- Never execute paid Telegraph requests, mints, or deployments without explicit owner approval and local `.env` configuration.
- Run `npm run check` (formatting, ESLint, TypeScript typecheck, build, unit tests, and Foundry contract tests) before every commit.
- Update `docs/development-status.md`, `docs/blockers.md`, and `docs/hackathon-evidence.md` with honest `LOCAL` / `MOCKED` / `TESTNET` / `NOT VERIFIED` labels.
