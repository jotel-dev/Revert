# Security Model & Threat Analysis

## Trust Assumptions (Explicit)

- **Mode A (Protected Payments):** Non-custodial between `sender`, `recipient`, and `RevertEscrow.sol`. No off-chain signer is involved.
- **Mode B (Conditional Payments):** Uses a **trusted settlement attestor model** (`escrow.attestor` set immutably at escrow creation). REVERT is **not** claimed to be fully trustless for off-chain intelligence evaluation.
  - **Bounded Attestor Power:** The attestor can *only* authorize releasing `escrow.amount` to the immutable `escrow.recipient` before `escrow.deadline` using non-zero proof commitments (`evidenceHash`, `signalHash`, `receiptHash`). The attestor **cannot** redirect funds, change amounts, extend deadlines, or block post-deadline refunds.

## Implemented Smart Contract Controls (`RevertEscrow.sol`)

- **Immutable Terms:** `sender`, `recipient`, `token`, `amount`, `recoveryWindowEnd`, `deadline`, `conditionHash`, and `attestor` cannot be modified after creation.
- **Reentrancy & Double-Settlement Guards:** OpenZeppelin `ReentrancyGuard`, checks-effects-interactions (state updated before `safeTransfer`), and EIP-712 `usedAttestations[digest]` tracking.
- **Token Safety:** Owner-controlled `allowedTokens` allowlist (`Ownable2Step`) plus exact balance-delta verification (`_pullExactTokens`) rejecting fee-on-transfer tokens.
- **Replay & Expiry Protection:** Chain- and contract-bound EIP-712 domain (`RevertEscrow`, `"1"`), `expiresAt` timestamp on attestations, and `deadline` bound on conditional settlement.
- **Safe Fallback:** Permissionless `refundExpired(escrowId)` once `block.timestamp > deadline`.

## Off-Chain Controls (Shared Policy & Planned Backend)

- **Strict Policy Validation:** `evaluateTxLookupPolicy` rejects `result_shape: "raw"`, unverified `signal_hash`, incomplete `fulfillment`, non-`confirmed` statuses, and address/value mismatches.
- **Privacy:** Only public transaction hashes and chain identifiers are sent to Telegraph; no private customer data is transmitted.
- **Key Isolation & Redaction:** Private keys live strictly in local `.env` files on the backend server; never logged or exposed to the frontend.
