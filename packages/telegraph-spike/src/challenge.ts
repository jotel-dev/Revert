import { z } from 'zod';

export const paymentAcceptSchema = z.object({
  scheme: z.string(),
  network: z.string(),
  amount: z.string().regex(/^\d+$/),
  payTo: z.string(),
  asset: z.string().optional(),
  maxTimeoutSeconds: z.number().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const paymentChallengeSchema = z.object({
  x402Version: z.number(),
  error: z.string().optional(),
  resource: z
    .object({
      url: z.string(),
      description: z.string().optional(),
      mimeType: z.string().optional(),
    })
    .optional(),
  accepts: z.array(paymentAcceptSchema).min(1),
});

export type PaymentAcceptOption = z.infer<typeof paymentAcceptSchema>;
export type PaymentChallenge = z.infer<typeof paymentChallengeSchema>;

export interface BudgetPolicy {
  maxPerRequestUusdc: bigint;
  maxTotalBudgetUusdc: bigint;
  spentSoFarUusdc: bigint;
}

export const DEFAULT_BUDGET_POLICY: BudgetPolicy = {
  maxPerRequestUusdc: 100_000n, // $0.10 test USDC
  maxTotalBudgetUusdc: 2_000_000n, // $2.00 test USDC
  spentSoFarUusdc: 0n,
};

export function parsePaymentRequiredHeader(headerValue: string): PaymentChallenge {
  const decodedJson = Buffer.from(headerValue.trim(), 'base64').toString('utf8');
  return paymentChallengeSchema.parse(JSON.parse(decodedJson));
}

export function selectPreferredAccept(
  challenge: PaymentChallenge,
  preferredRail: 'escrow' | 'exact' = 'escrow',
  preferredNetwork = 'eip155:11155111',
): PaymentAcceptOption {
  const exactMatch = challenge.accepts.find(
    (a) => a.scheme === preferredRail && a.network === preferredNetwork,
  );
  if (exactMatch) return exactMatch;

  const sameScheme = challenge.accepts.find((a) => a.scheme === preferredRail);
  if (sameScheme) return sameScheme;

  const first = challenge.accepts[0];
  if (!first) throw new Error('No payment accept options returned in 402 challenge');
  return first;
}

export function assertWithinBudget(quotedAmountUusdc: bigint, policy: BudgetPolicy): void {
  if (quotedAmountUusdc <= 0n) {
    throw new Error('Quoted payment amount must be positive');
  }
  if (quotedAmountUusdc > policy.maxPerRequestUusdc) {
    throw new Error(
      `Quoted amount ${quotedAmountUusdc} uUSDC exceeds per-request cap ${policy.maxPerRequestUusdc} uUSDC`,
    );
  }
  if (policy.spentSoFarUusdc + quotedAmountUusdc > policy.maxTotalBudgetUusdc) {
    throw new Error(
      `Quoted amount ${quotedAmountUusdc} uUSDC would exceed total budget cap ${policy.maxTotalBudgetUusdc} uUSDC`,
    );
  }
}

export function renderEscrowSignMessage(
  template: string,
  params: {
    fromAddress: string;
    nonce: string;
    validAfter: number;
    validBefore: number;
  },
): string {
  if (params.validBefore - params.validAfter > 120 || params.validBefore <= params.validAfter) {
    throw new Error('Telegraph escrow validity window must be > 0s and <= 120s');
  }
  return template
    .replace('{from}', params.fromAddress.toLowerCase())
    .replace('{nonce}', params.nonce)
    .replace('{validAfter}', String(params.validAfter))
    .replace('{validBefore}', String(params.validBefore));
}
