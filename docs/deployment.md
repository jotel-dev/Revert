# Deployment Guide

**Current Deployment Status:** `NOT VERIFIED` (contracts compiled and tested `LOCAL` only; no Sepolia transactions broadcast yet).

## Target Network

- **Chain:** Ethereum Sepolia (`11155111`)
- **RPC:** `https://ethereum-sepolia-rpc.publicnode.com`
- **Allowlisted Test USDC:** `0xcc194e1a843B658526D0D5C431f670028582Ae17`
- **Telegraph V2 Diamond:** `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b`

## Deployment Steps (To Execute Only With Owner Authorization)

1. Copy `.env.example` to `.env` locally and set `DEPLOYER_PRIVATE_KEY`, `TELEGRAPH_PAYER_PRIVATE_KEY`, and `ATTESTOR_PRIVATE_KEY` using separate disposable testnet wallets funded with Sepolia ETH.
2. Deploy `RevertEscrow.sol`:
   ```bash
   cd packages/contracts
   forge script script/DeployRevertEscrow.s.sol:DeployRevertEscrow --rpc-url $SEPOLIA_RPC_URL --broadcast
   ```
3. Mint test USDC (`0xcc194e1a843B658526D0D5C431f670028582Ae17`) to the payer and demo sender wallets, and deposit Telegraph intelligence budget (`<= 2.00` test USDC) via `LedgerFacet.depositUSDC(uint256)` on the Telegraph Diamond.
4. Record deployed contract addresses and transaction hashes in `docs/hackathon-evidence.md`.
