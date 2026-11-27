import { parseAbi } from 'viem';
import revertEscrowArtifact from '../../../../packages/contracts/abi/RevertEscrow.json';

export const SEPOLIA_CHAIN_ID = 11155111;
export const SEPOLIA_TEST_USDC_ADDRESS = '0xcc194e1a843B658526D0D5C431f670028582Ae17' as const;
export const TELEGRAPH_DIAMOND_ADDRESS = '0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b' as const;
export const DEFAULT_ATTESTOR_ADDRESS =
  (import.meta.env.VITE_ATTESTOR_ADDRESS as `0x${string}` | undefined) ??
  ('0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const);

export const REVERT_ESCROW_ADDRESS = (import.meta.env.VITE_REVERT_ESCROW_ADDRESS || '') as
  `0x${string}` | '';

export const REVERT_ESCROW_ABI = revertEscrowArtifact.abi;

export const ERC20_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);
