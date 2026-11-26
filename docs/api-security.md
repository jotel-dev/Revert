# API Security, Validation, Auth, Rate Limiting & Key Handling

## Request Validation

- All path parameters (`:id` strictly positive integers), query params, and JSON request bodies (`ConditionalTxCondition`, `verify` options) are validated at runtime with **Zod**.
- `POST /api/escrows/:id/condition` computes `conditionHash = keccak256(canonicalizeCondition(body))` and rejects (`HTTP 400`) any payload that does not exactly match the immutable `conditionHash` stored on `RevertEscrow.sol`.
- Body payload size is capped at `64 KiB` (`bodyLimit: 65536`).

## Authentication & Separation of Concerns

- Read-only inspection routes (`GET /health`, `GET /api/budget`, `GET /api/escrows`, `GET /api/escrows/:id`, `GET /api/evidence/:id`) are public for UI and reviewer inspection.
- Mutating endpoints (`POST /api/escrows/:id/condition`, `POST /api/escrows/:id/verify`, `POST /api/escrows/:id/broadcast-settlement`) enforce constant-time Bearer / `x-api-key` authentication (`crypto.timingSafeEqual`) whenever `API_AUTH_TOKEN` is configured.
- **Verification vs. Broadcasting Separation:** `POST /api/escrows/:id/verify` only evaluates evidence and signs an off-chain EIP-712 `SettlementAttestation`. On-chain broadcasting (`POST /api/escrows/:id/broadcast-settlement`) is disabled by default (`ENABLE_SERVER_BROADCASTER=false`) so users or separate relayers submit the signed attestation.

## Rate Limiting & CORS

- `@fastify/cors` restricts browser origins to `CORS_ORIGIN` (default `http://localhost:5173`).
- `@fastify/rate-limit` enforces `60 req/min` globally and `15 req/min` on `POST /api/escrows/:id/verify`.

## Storage & Private Key Handling

- `VerificationStateStore` persists condition preimages, job states, receipts, and attestations atomically via temp-file write + rename (`.revert-verification-state.json`, excluded by `.gitignore`).
- On restart, interrupted `VERIFYING` jobs automatically recover to `INCONCLUSIVE` without losing attempt counts or spend reservations.
- Private keys (`ATTESTOR_PRIVATE_KEY`, `TELEGRAPH_PAYER_PRIVATE_KEY`, optional `BROADCASTER_PRIVATE_KEY`) live strictly in server-side `.env` (never committed, never returned in API responses, and masked by `sanitizeForLog`).

## Architectural Limitations (Flagged Explicitly)

1. **Trusted Attestor Assumption:** Mode B relies on `ATTESTOR_PRIVATE_KEY` to attest off-chain Telegraph intelligence (`ONCHAIN_TX_LOOKUP_GENERAL`) on-chain. Compromising `ATTESTOR_PRIVATE_KEY` could prematurely release or refund an active `LOCKED` conditional escrow (within the immutable `sender`/`recipient`/`deadline` bounds).
2. **Off-Chain Condition Preimage Availability:** `RevertEscrow.sol` stores `conditionHash` (a `bytes32` commitment) rather than raw strings to save gas and protect unnecessary metadata on-chain. The sender/recipient must register the matching JSON condition via `POST /api/escrows/:id/condition` before the verification engine can query Telegraph.
3. **Target-Chain RPC Coverage:** Independent RPC cross-checks rely on configured public RPCs; if a target chain RPC is unavailable, `evaluateTxLookupPolicy` still enforces strict Telegraph `signal_hash` cryptographic verification and schema matching, or flags mismatches as `INCONCLUSIVE`.
