import { z } from 'zod';
import { TELEGRAPH_INTENT_NAME } from '@revert/shared';

export const CAIP2_ETHEREUM_SEPOLIA = 'eip155:11155111' as const;
export const CAIP2_BASE_SEPOLIA = 'eip155:84532' as const;

export const ETHEREUM_SEPOLIA_USDC = '0xcc194e1a843B658526D0D5C431f670028582Ae17' as const;
export const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const;
export const TELEGRAPH_SEPOLIA_DIAMOND = '0x72a70e949362670Bf8bceAd24eFC5b8f950aa08b' as const;
export const TELEGRAPH_TREASURY = '0xC0A3FB6d3F1f4B54617d29ffbdA4663Af5F96e2e' as const;

export const DEFAULT_ALLOWED_NETWORKS = [CAIP2_ETHEREUM_SEPOLIA, CAIP2_BASE_SEPOLIA] as const;

export const DEFAULT_ALLOWED_TOKENS_BY_NETWORK: Record<string, readonly string[]> = {
  [CAIP2_ETHEREUM_SEPOLIA]: [ETHEREUM_SEPOLIA_USDC.toLowerCase()],
  [CAIP2_BASE_SEPOLIA]: [BASE_SEPOLIA_USDC.toLowerCase()],
};

export const DEFAULT_TRUSTED_PAYTO_BY_NETWORK: Record<string, readonly string[]> = {
  [CAIP2_ETHEREUM_SEPOLIA]: [TELEGRAPH_SEPOLIA_DIAMOND.toLowerCase()],
  [CAIP2_BASE_SEPOLIA]: [TELEGRAPH_TREASURY.toLowerCase()],
};

export const telegraphAskRequestSchema = z.object({
  intent: z.literal(TELEGRAPH_INTENT_NAME),
  params: z.object({
    tx_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
    chain: z.string().min(1).max(64),
  }),
  max_budget_usdc: z.number().int().min(10_000).max(260_000).optional(),
  deadline_ms: z.number().int().min(2_000).max(60_000).optional(),
});

export type TelegraphAskRequest = z.infer<typeof telegraphAskRequestSchema>;

export const paymentAcceptOptionSchema = z.object({
  scheme: z.string().min(1),
  network: z.string().min(1),
  amount: z.string().regex(/^\d+$/),
  payTo: z.string().min(1),
  asset: z.string().optional(),
  maxTimeoutSeconds: z.number().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export type PaymentAcceptOption = z.infer<typeof paymentAcceptOptionSchema>;

export const paymentChallengeSchema = z.object({
  x402Version: z.number().int(),
  error: z.string().optional(),
  resource: z
    .object({
      url: z.string(),
      description: z.string().optional(),
      mimeType: z.string().optional(),
    })
    .optional(),
  accepts: z.array(paymentAcceptOptionSchema).min(1),
});

export type PaymentChallenge = z.infer<typeof paymentChallengeSchema>;

export const telegraphReceiptSchema = z.object({
  receipt_hash: z.string().min(1),
  rail: z.string().min(1),
  payer: z.string().min(1),
  miner: z.union([z.string(), z.number()]).transform(String),
  intent: z.string().min(1),
  amount_uusdc: z.union([z.string(), z.number()]).transform(String),
  epoch_id: z.number().int().nonnegative(),
  settlement: z.string().min(1),
  chain: z.string().min(1),
  tx_hash: z.string().optional(),
  timestamp: z.number().int().nonnegative(),
});

export type TelegraphReceipt = z.infer<typeof telegraphReceiptSchema>;

export const ledgerAccountSchema = z.object({
  address: z.string(),
  deposited: z.string().regex(/^\d+$/),
  withdrawn: z.string().regex(/^\d+$/),
  charged: z.string().regex(/^\d+$/),
  credited: z.string().regex(/^\d+$/),
  unbilled: z.string().regex(/^\d+$/),
  balance: z.string().regex(/^-?\d+$/),
  available: z.string().regex(/^-?\d+$/),
});

export type LedgerAccount = z.infer<typeof ledgerAccountSchema>;

export const intentInfoSchema = z.object({
  intent_name: z.string(),
  class: z.string().optional(),
  miner_count: z.number().int().nonnegative(),
  request: z
    .object({
      params: z.array(z.object({ name: z.string(), type: z.string() })),
    })
    .nullable(),
  response: z
    .object({
      fields: z.array(z.object({ name: z.string(), type: z.string() })),
    })
    .nullable(),
  onchain: z.object({ ready: z.boolean() }).optional(),
});

export type IntentInfo = z.infer<typeof intentInfoSchema>;

export const minersListSchema = z.object({
  miners: z.array(
    z.object({
      id: z.union([z.string(), z.number()]).transform(String),
      slug: z.string().optional(),
      name: z.string().optional(),
      min_price_usdc: z.number().int().nonnegative().optional(),
    }),
  ),
});

export type MinersList = z.infer<typeof minersListSchema>;
