# Security Model, Threat Analysis & Trust Assumptions

## Explicit Trust Assumptions (Signer Control Disclosure)

- **Mode A (Protected Payments):** Non-custodial between `sender`, `recipient`, and `RevertEscrow.sol`. No off-chain signer or admin key can cancel, claim, or redirect Mode A funds.
- **Mode B (Conditional Payments):** Uses an **explicitly trusted settlement attestor (`escrow.attestor`)** bound immutably to each escrow at funding time.
  - **Who controls the signer:** The REVERT backend operator (via isolated server-side `ATTESTOR_PRIVATE_KEY`) — or any attestor address agreed by sender and recipient at creation.
  - **What the signer can authorize:** The attestor can *only* sign an EIP-712 `SettlementAttestation` to trigger `RELEASE` (paying `escrow.amount` strictly to immutable `escrow.recipient`) or `REFUND` (returning `escrow.amount` strictly to immutable `escrow.sender`) before `escrow.deadline`.
  - **What the signer CANNOT do:** It cannot steal funds, change `recipient` or `sender`, modify `amount` or `token`, extend `deadline`, settle an already-settled escrow, or trap funds past `deadline` (because `refundExpired` is permissionless once `block.timestamp > deadline`).
  - **Why this is NOT claimed to be trustless:** If the attestor key is compromised, it could prematurely release or refund a `LOCKED` conditional escrow to the counterparty before `deadline`. Therefore, Mode B is documented as **attestor-mediated deterministic settlement**, not trustless execution.

## Threat Model & Mitigations

| Threat | Mitigation Implemented in `RevertEscrow.sol` & Client | Verification |
|---|---|---|
| **Double claim / double refund** | Strict `State.LOCKED -> RELEASED \| REFUNDED` transition before `safeTransfer` + `nonReentrant` | Foundry unit, fuzz (`256` runs) & invariant tests |
| **Signature replay / cross-chain / cross-escrow replay** | EIP-712 domain (`chainId`, `verifyingContract`) + `escrowId`, `conditionHash`, `outcome`, `nonce`, `issuedAt`, `expiresAt` + `usedAttestations[digest]` + `usedNonces[attestor][nonce]` | `test_ConditionalEscrow_RejectsWrongEscrowBindingAndNonceReplay` |
| **Stale or future-dated attestation** | Enforces `issuedAt <= block.timestamp <= expiresAt` and `expiresAt - issuedAt <= MAX_ATTESTATION_TTL (1 day)` | `test_ConditionalEscrow_RejectsStaleExpiredAndInvalidSigner` |
| **Deadline race / boundary conflict** | Mode A splits strictly at `< recoveryWindowEnd` vs `>= recoveryWindowEnd`; Mode B splits at `<= deadline` vs `> deadline` | `test_ProtectedEscrow_ClaimAtOrAfterWindowBoundary`, `test_ConditionalEscrow_RejectsZeroProofHashesAndDeadlineBoundary` |
| **Unavailable Telegraph / offline attestor trapping funds** | Permissionless `refundExpired(escrowId)` after `block.timestamp > deadline` | `test_ConditionalEscrow_RejectsZeroProofHashesAndDeadlineBoundary` + invariant tests |
| **Fee-on-transfer / rebasing / malicious ERC-20** | Owner allowlist (`allowedTokens` requiring `token.code.length > 0`) + exact balance-delta check (`_pullExactTokens`) + `SafeERC20` | `test_RejectsInvalidTokensFeeOnTransferAndReentrancy` |
| **Reentrancy via ERC-20 callback** | OpenZeppelin `ReentrancyGuard` + CEI state update prior to token transfer | `test_RejectsInvalidTokensFeeOnTransferAndReentrancy` (`ReentrantMockERC20`) |
| **Unbounded Telegraph spend / concurrent overspend** | `AsyncSpendGuard` mutex reserving `maxAuthorizedUusdc` (`<= $0.10`/req, `<= $2.00` total) | `@revert/telegraph-client` Vitest tests |
| **Private PII leakage on Telegraph** | Only public tx hashes and chain names are sent to `ONCHAIN_TX_LOOKUP_GENERAL` | Client schema validation |
