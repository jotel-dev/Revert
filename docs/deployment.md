# Deployment, Funding & Environment Runbook

**Current Deployment Status:** `NOT VERIFIED` (`RevertEscrow.sol` compiled, ABI exported, fork simulation passing; live Sepolia broadcast held pending owner wallet setup & authorization).

---

## 1. Network & Official Contract Addresses (Ethereum Sepolia `11155111`)

| Contract / Service | Verified Address / URL | Purpose |
|---|---|---|
| **Chain & RPC** | `https://ethereum-sepolia-rpc.publicnode.com` (`chainId: 11155111`) | Ethereum Sepolia RPC |
| **Test USDC** | `0xcc194e1a843B658526D0D5C431f670028582Ae17` (`6` decimals) | Publicly mintable (`mint(address,uint256)`) & claimable via `https://anjoman.ai/dashboard/faucet` |
| **Telegraph V2 Diamond** | `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b` | Port contract; escrow funded via `approve` + `LedgerFacet.depositUSDC(amount)` |
| **Telegraph Node** | `https://devnode.telegraphprotocol.com` | `ONCHAIN_TX_LOOKUP_GENERAL` (`50000 uUSDC` / `0.05 USDC` quoted) |

> **Important:** A plain ERC-20 `transfer()` of Test USDC to the Telegraph Diamond **does not** credit your escrow account. You must call `IERC20(USDC).approve(DIAMOND, amount)` followed by `LedgerFacet(DIAMOND).depositUSDC(amount)`.

---

## 2. Disposable Wallet Setup & Environment Matrix

Run the local key utility (never prints private keys, checks `.gitignore` first, refuses overwrite by default):

```bash
node scripts/setup-wallets.mjs --generate
node scripts/setup-wallets.mjs --print-public
```

### Environment Variable Classification ([.env.example](../.env.example))

- **Generated Locally (`setup-wallets.mjs`):** `DEPLOYER_PRIVATE_KEY`, `TELEGRAPH_PAYER_PRIVATE_KEY`, `ATTESTOR_PRIVATE_KEY`, `VITE_ATTESTOR_ADDRESS`
- **Mandatory Fixed Network Defaults (pre-populated):** `CHAIN_ID=11155111`, `SEPOLIA_RPC_URL`, `SUPPORTED_USDC_ADDRESS`, `TELEGRAPH_DIAMOND_ADDRESS`, `TELEGRAPH_NODE_URL`, `TELEGRAPH_PAYMENT_RAIL=escrow`, `MAX_PER_REQUEST_UUSDC=100000`, `MAX_TOTAL_BUDGET_UUSDC=2000000`
- **Mandatory Explicit Owner Gate:** `TELEGRAPH_ALLOW_LIVE_SPEND=true` (keep `false` until approved) and `REVERT_ESCROW_ADDRESS` (populated immediately after deploy)
- **Optional / Conditional:** `API_HOST`, `API_PORT`, `CORS_ORIGIN`, `API_AUTH_TOKEN`, `ENABLE_SERVER_BROADCASTER=false`, `BROADCASTER_PRIVATE_KEY`, `VITE_REVERT_ESCROW_ADDRESS`, `VITE_SEPOLIA_RPC_URL`, `ETHERSCAN_API_KEY` (only needed if Etherscan verification is desired)

---

## 3. Funding & Measured Gas Liability

- **Measured Forge Contract Gas (`forge test --gas-report`):**
  - `RevertEscrow` deployment: `2,401,406` gas (`12,003` bytes)
  - `createProtectedEscrow`: `<= 192,190` gas | `cancelProtected`: `<= 58,464` gas | `claimProtected`: `<= 77,735` gas
  - `createConditionalEscrow`: `<= 233,535` gas | `settleConditional`: `<= 138,336` gas | `refundExpired`: `<= 58,334` gas
  - `ERC20.mint`: `68,380` gas | `ERC20.approve`: `46,679` gas
  - Complete deployment + Mode A cancel/claim + Mode B settle/invalid/timeout workflow total: `~3.85M` gas (`< 4.5M` upper bound).
- **Minimum Funding:**
  - `DEPLOYER`: **`0.05 Sepolia ETH`** + **`10.00 Test USDC`** (covers deployment + Mode A/B test escrows)
  - `TELEGRAPH_PAYER`: **`0.01 Sepolia ETH`** + **`2.00 Test USDC`** deposited into Telegraph Diamond (`2000000 uUSDC`)
  - `ATTESTOR`: **`0 ETH`** (off-chain EIP-712 signer only)

---

## 4. Sepolia Deployment & Live E2E Execution Commands

1. **Mint & Deposit Test USDC to Telegraph Diamond:**
   ```bash
   cast send 0xcc194e1a843B658526D0D5C431f670028582Ae17 "mint(address,uint256)" <WALLET_ADDR> 10000000 --rpc-url $SEPOLIA_RPC_URL --private-key <KEY>
   cast send 0xcc194e1a843B658526D0D5C431f670028582Ae17 "approve(address,uint256)" 0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b 2000000 --rpc-url $SEPOLIA_RPC_URL --private-key $TELEGRAPH_PAYER_PRIVATE_KEY
   cast send 0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b "depositUSDC(uint256)" 2000000 --rpc-url $SEPOLIA_RPC_URL --private-key $TELEGRAPH_PAYER_PRIVATE_KEY
   curl -s https://devnode.telegraphprotocol.com/v1/ledger/account/<TELEGRAPH_PAYER_ADDR>
   ```
2. **Deploy `RevertEscrow.sol` (requires explicit `BROADCAST=true`):**
   ```bash
   cd packages/contracts
   BROADCAST=true forge script script/DeployRevertEscrow.s.sol:DeployRevertEscrow --rpc-url $SEPOLIA_RPC_URL --broadcast
   ```
3. **Verify First Live Telegraph Purchase & Live App Flow:**
   - Set `REVERT_ESCROW_ADDRESS`, `VITE_REVERT_ESCROW_ADDRESS`, `VITE_ATTESTOR_ADDRESS`, and `TELEGRAPH_ALLOW_LIVE_SPEND=true` in local `.env`.
   - Run `npm run telegraph:live` (`$0.05` max per request, capped at `$2.00` total across restarts/processes via `.revert-spend-ledger.json` + `.lock`).
   - Start `@revert/api` and `@revert/web` and execute live Sepolia Mode A cancel & claim, Mode B condition registration -> Telegraph purchase -> `settleConditional` release, invalid condition rejection (`CONTRADICTED`), and expired deadline `refundExpired`.

---

## 5. Key Rotation & Free/Low-Cost Hosting Configuration

- **Attestor Key Rotation:** `RevertEscrow.sol` stores `escrow.attestor` immutably per escrow. Rotating `ATTESTOR_PRIVATE_KEY` + `VITE_ATTESTOR_ADDRESS` switches all *newly created* escrows cleanly without redeploying contracts; existing active escrows bound to a previous key settle either under the old key before `deadline` or via permissionless `refundExpired()` after `deadline`.
- **Declarative Hosting Templates (Not Yet Deployed):**
  - Backend (`@revert/api`): [render.yaml](../render.yaml) (Render free Node web service, `/health` probe, `sync: false` secrets).
  - Frontend (`@revert/web`): [vercel.json](../apps/web/vercel.json) (Vercel static SPA build + rewrite; configure `VITE_API_BASE_URL` or proxy rewrite to Render API + `VITE_REVERT_ESCROW_ADDRESS` + `VITE_ATTESTOR_ADDRESS`).
