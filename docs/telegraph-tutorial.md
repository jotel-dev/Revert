# Beginner's Tutorial: Verifying External Transactions with Telegraph (`ONCHAIN_TX_LOOKUP_GENERAL`)

This guide walks through how REVERT uses **Telegraph V2** to purchase machine-verifiable external transaction evidence over HTTP `402` without trusting arbitrary LLM free-text or exposing private keys.

---

## 1. Prerequisites & Authorization Requirements

1. **Dependencies built locally:**
   ```bash
   npm install
   npm run build
   ```
2. **Safe Dry-Run (Zero Spend, No Private Key Required):**
   - Runs intent discovery (`GET /engine/v1/intents/ONCHAIN_TX_LOOKUP_GENERAL`), miner discovery, and unpaid `402` challenge inspection (`POST /engine/v1/ask`).
   - Run anytime via:
     ```bash
     npm run telegraph:dry-run
     node examples/telegraph-conditional-check.mjs
     ```
3. **Live Testnet Spend Authorization (Explicit Opt-In Only):**
   - Create a local `.env` (never commit it) with a disposable `TELEGRAPH_PAYER_PRIVATE_KEY` funded on **Ethereum Sepolia (`11155111`)** with Test USDC (`0xcc194e1a843B658526D0D5C431f670028582Ae17`) deposited into Telegraph Diamond (`0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b`) via `LedgerFacet.depositUSDC(amount)`.
   - Set `TELEGRAPH_ALLOW_LIVE_SPEND=true` only when you explicitly intend to spend disposable testnet funds.

---

## 2. Actual Request Structure

REVERT validates every outbound ask payload against `telegraphAskRequestSchema` in [types.ts](file:///C:/Users/PC/Desktop/Revert/packages/telegraph-client/src/types.ts):

```json
{
  "intent": "ONCHAIN_TX_LOOKUP_GENERAL",
  "params": {
    "tx_hash": "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060",
    "chain": "ethereum"
  },
  "max_budget_usdc": 50000
}
```

- `tx_hash`: `0x`-prefixed 32-byte hex hash (public transaction identifier only — no PII).
- `chain`: Allowlisted chain string (`ethereum`, `sepolia`, `base`, `base-sepolia`, `arbitrum`, `optimism`, `polygon`).
- `max_budget_usdc`: Optional integer micro-USDC limit (`10000` = `0.01 USDC`, `50000` = `0.05 USDC`, `260000` max).

---

## 3. Observed Live Unpaid `402` Payment Challenge (`TESTNET` Read-Only)

Sending the unauthenticated `POST https://devnode.telegraphprotocol.com/engine/v1/ask` request returns HTTP `402 Payment Required` with a Base64-encoded `PAYMENT-REQUIRED` header (verified `2026-11-27`):

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:84532",
      "amount": "50000",
      "payTo": "0xC0A3FB6d3F1f4B54617d29ffbdA4663Af5F96e2e",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
    },
    {
      "scheme": "escrow",
      "network": "eip155:11155111",
      "amount": "50000",
      "payTo": "0x72a70e949362670bf8bcead24efc5b8f950aa08b",
      "extra": {
        "message": "Telegraph Escrow Payment\n\nWallet: {from}\nPay To: 0x72a70e949362670bf8bcead24efc5b8f950aa08b\nNetwork: eip155:11155111\nAmount: 50000 uUSDC\nResource: /v1/ask\nNonce: {nonce}\nValid After: {validAfter}\nValid Before: {validBefore}"
      }
    }
  ]
}
```

Before signing anything, `@revert/telegraph-client` ([client.ts](file:///C:/Users/PC/Desktop/Revert/packages/telegraph-client/src/client.ts)):
1. Verifies `scheme`, `network` (`eip155:11155111`), and `payTo` (`0x72a70e...`) against allowlists.
2. Parses `Amount:`, `Pay To:`, and `Network:` inside `extra.message` to confirm they strictly match the JSON option fields (preventing challenge template spoofing).
3. Reserves integer `maxAuthorizedUusdc` inside `AsyncSpendGuard` against `maxPerRequestUusdc` (`100000 uUSDC` / `$0.10`) and `maxTotalBudgetUusdc` (`2000000 uUSDC` / `$2.00`).

---

## 4. Expected Response & Receipt Schema (`[MOCKED]` / Schema Reference)

> Live paid responses on `devnode.telegraphprotocol.com` remain `NOT VERIFIED` pending funded Sepolia wallets (`BLOCKER-003`). Below is the validated schema exercised in `npm run test:fullstack` and `packages/telegraph-client/test/client.test.ts`.

**HTTP `200` Body (`TelegraphAskResponse`):**
```json
{
  "miner_id": "9002",
  "miner_name": "TxLens",
  "intent": "ONCHAIN_TX_LOOKUP_GENERAL",
  "result_shape": "intent",
  "field_status": { "status": "ok" },
  "signal_hash": "0xda35b45c4369a3c5786bbe5f5b698ba166d3e96d526a36678702a935210fced9",
  "fulfillment": { "status": "complete" },
  "result": {
    "tx_hash": "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060",
    "status": "confirmed",
    "from": "0x...",
    "to": "0xa1e4380a3b1f749673e270229993ee55f45663b4",
    "block_number": 100,
    "value_eth": 0.5
  }
}
```

**`X-PAYMENT-RESPONSE` Header (`telegraphReceiptSchema`):**
Contains `receipt_hash`, `rail`, `payer`, `miner`, `intent`, `amount_uusdc`, `epoch_id`, `settlement`, `chain`, and `timestamp`.

---

## 5. Deterministic Policy Evaluation & Evidence Storage

REVERT **never** asks an LLM whether to release escrowed funds. Instead, `evaluateTxLookupPolicy` ([policy.ts](file:///C:/Users/PC/Desktop/Revert/packages/shared/src/policy.ts)) checks:
- `result_shape === 'intent'` (rejects unparsed `'raw'` output as `INCONCLUSIVE`)
- `fulfillment.status === 'complete'` and `field_status.status === 'ok'`
- `signalVerification.verified === true` (`deriveSignalHash` matches `GET /engine/v1/signal/:hash`)
- Exact match on `tx_hash`, normalized `to`, optional `from`, `status === 'confirmed'`, and `value_eth >= minValueEth`

Redacted purchase metadata, receipt hashes, and policy verdicts are persisted to `evidence/live-purchases/` without writing private keys or raw auth headers. See [examples/telegraph-conditional-check.mjs](file:///C:/Users/PC/Desktop/Revert/examples/telegraph-conditional-check.mjs) for a minimal runnable integration script.
