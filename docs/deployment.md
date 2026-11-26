# Deployment Guide

**Current Deployment Status:** `NOT VERIFIED` (contracts compiled, ABI exported, and deployment script verified in dry-run simulation only; broadcast is disabled by default).

## Target Network

- **Chain:** Ethereum Sepolia (`11155111`)
- **RPC:** `https://ethereum-sepolia-rpc.publicnode.com`
- **Allowlisted Test USDC:** `0xcc194e1a843B658526D0D5C431f670028582Ae17`
- **Telegraph V2 Diamond:** `0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b`

## Safe Dry-Run Simulation (Broadcast Disabled by Default)

Running [DeployRevertEscrow.s.sol](file:///C:/Users/PC/Desktop/Revert/packages/contracts/script/DeployRevertEscrow.s.sol) without `BROADCAST=true` simulates deployment locally without touching any live network or requiring a private key:

```bash
cd packages/contracts
forge script script/DeployRevertEscrow.s.sol:DeployRevertEscrow
```

## Live Sepolia Deployment (Requires Explicit Owner Authorization)

1. Copy `.env.example` to `.env` locally and set disposable Sepolia keys (`DEPLOYER_PRIVATE_KEY`, `TELEGRAPH_PAYER_PRIVATE_KEY`, `ATTESTOR_PRIVATE_KEY`) funded with ~`0.05` Sepolia ETH.
2. Broadcast explicitly:
   ```bash
   cd packages/contracts
   BROADCAST=true forge script script/DeployRevertEscrow.s.sol:DeployRevertEscrow --rpc-url $SEPOLIA_RPC_URL --broadcast
   ```
3. Record the deployed address and transaction hash in [hackathon-evidence.md](hackathon-evidence.md).
