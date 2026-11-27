import { keccak256, stringToHex } from 'viem';
import { z } from 'zod';

export const TELEGRAPH_INTENT_NAME = 'ONCHAIN_TX_LOOKUP_GENERAL' as const;

export const evmAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, 'Must be a valid 20-byte hex EVM address')
  .transform((v) => v.toLowerCase() as `0x${string}`);

export const txHashSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{64}$/, 'Must be a valid 32-byte hex transaction hash')
  .transform((v) => v.toLowerCase() as `0x${string}`);

export const SUPPORTED_TARGET_CHAINS = [
  'ethereum',
  'sepolia',
  'base',
  'base-sepolia',
  'arbitrum',
  'optimism',
  'polygon',
] as const;

export const supportedTargetChainSchema = z.enum(SUPPORTED_TARGET_CHAINS);

export type SupportedTargetChain = z.infer<typeof supportedTargetChainSchema>;

export const conditionalTxConditionSchema = z.object({
  version: z.literal(1),
  intent: z.literal(TELEGRAPH_INTENT_NAME),
  chain: supportedTargetChainSchema,
  txHash: txHashSchema,
  expectedFrom: evmAddressSchema.optional(),
  expectedTo: evmAddressSchema,
  minValueEth: z.number().nonnegative().finite().default(0),
});

export type ConditionalTxCondition = z.infer<typeof conditionalTxConditionSchema>;

export function canonicalizeCondition(input: ConditionalTxCondition): string {
  const parsed = conditionalTxConditionSchema.parse(input);
  const canonicalObj: Record<string, string | number> = {
    chain: parsed.chain,
    intent: parsed.intent,
    minValueEth: parsed.minValueEth,
    txHash: parsed.txHash,
    expectedTo: parsed.expectedTo,
    version: parsed.version,
  };
  if (parsed.expectedFrom !== undefined) {
    canonicalObj.expectedFrom = parsed.expectedFrom;
  }
  const sortedKeys = Object.keys(canonicalObj).sort();
  const sorted: Record<string, string | number> = {};
  for (const k of sortedKeys) {
    const val = canonicalObj[k];
    if (val !== undefined) sorted[k] = val;
  }
  return JSON.stringify(sorted);
}

export function computeConditionHash(input: ConditionalTxCondition): `0x${string}` {
  const canonical = canonicalizeCondition(input);
  return keccak256(stringToHex(canonical));
}
