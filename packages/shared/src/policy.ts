import { z } from 'zod';
import { TELEGRAPH_INTENT_NAME, type ConditionalTxCondition } from './condition.js';

export const txLookupStatusSchema = z.enum(['confirmed', 'reverted', 'pending', 'not_found']);

export const txLookupResultSchema = z.object({
  tx_hash: z.string().optional(),
  status: txLookupStatusSchema,
  from: z.string().optional(),
  to: z.string().optional(),
  block_number: z.number().int().nonnegative().optional(),
  value_eth: z.number().nonnegative().optional(),
});

export const telegraphAskResponseSchema = z.object({
  miner_id: z.union([z.string(), z.number()]).transform(String),
  miner_name: z.string().optional(),
  endpoint: z.string().optional(),
  intent: z.string().optional(),
  result_shape: z.enum(['intent', 'raw']),
  format_version: z.number().int().optional(),
  field_status: z.record(z.string(), z.string()).optional(),
  result: z.unknown(),
  cost_usd: z.number().nonnegative().optional(),
  duration_ms: z.number().nonnegative().optional(),
  signal_hash: z
    .string()
    .regex(/^0x[a-fA-F0-9]{64}$/)
    .optional(),
  fulfillment: z
    .object({
      status: z.enum(['complete', 'partial', 'unverifiable', 'unavailable']),
      stopped: z.string().optional(),
    })
    .optional(),
});

export type TelegraphAskResponse = z.infer<typeof telegraphAskResponseSchema>;

export type SettlementDecision = 'RELEASE' | 'INCONCLUSIVE';

export interface IndependentOnchainObservation {
  checked: boolean;
  status?: 'confirmed' | 'reverted' | 'not_found';
  from?: string;
  to?: string;
  valueEth?: number;
  error?: string;
}

export interface PolicyEvaluationResult {
  decision: SettlementDecision;
  reasons: string[];
  parsedResult?: z.infer<typeof txLookupResultSchema>;
}

/**
 * Deterministic Mode B settlement policy for ONCHAIN_TX_LOOKUP_GENERAL.
 * Never releases funds on raw/unshaped output, inconclusive miner responses,
 * mismatched addresses/values, or contradicted independent onchain checks.
 */
export function evaluateTxLookupPolicy(
  condition: ConditionalTxCondition,
  response: TelegraphAskResponse,
  signalVerified: boolean,
  onchainCheck?: IndependentOnchainObservation,
): PolicyEvaluationResult {
  const reasons: string[] = [];

  if (response.intent && response.intent !== TELEGRAPH_INTENT_NAME) {
    reasons.push(`Unexpected intent ${response.intent}`);
  }
  if (response.result_shape !== 'intent') {
    reasons.push(`Result shape is ${response.result_shape}, expected intent`);
  }
  if (!response.signal_hash || !signalVerified) {
    reasons.push('Telegraph signal_hash missing or failed cryptographic verification');
  }
  if (response.fulfillment && response.fulfillment.status !== 'complete') {
    reasons.push(`Fulfillment incomplete: ${response.fulfillment.status}`);
  }
  if (response.field_status?.status && response.field_status.status !== 'ok') {
    reasons.push(`Status field_status is ${response.field_status.status}`);
  }

  const parsed = txLookupResultSchema.safeParse(response.result);
  if (!parsed.success) {
    reasons.push('Miner result does not match ONCHAIN_TX_LOOKUP_GENERAL schema');
    return { decision: 'INCONCLUSIVE', reasons };
  }

  const data = parsed.data;
  if (data.status !== 'confirmed') {
    reasons.push(`Transaction status is ${data.status}, requires confirmed`);
  }
  if (data.tx_hash && data.tx_hash.toLowerCase() !== condition.txHash.toLowerCase()) {
    reasons.push('Returned tx_hash does not match escrow condition');
  }
  if (!data.to || data.to.toLowerCase() !== condition.expectedTo.toLowerCase()) {
    reasons.push('Returned recipient (to) does not match expectedTo');
  }
  if (
    condition.expectedFrom &&
    (!data.from || data.from.toLowerCase() !== condition.expectedFrom.toLowerCase())
  ) {
    reasons.push('Returned sender (from) does not match expectedFrom');
  }
  if (condition.minValueEth > 0) {
    if (data.value_eth === undefined || data.value_eth < condition.minValueEth) {
      reasons.push(`Transferred value_eth below required minimum ${condition.minValueEth}`);
    }
  }

  if (onchainCheck?.checked) {
    if (onchainCheck.status !== 'confirmed') {
      reasons.push(`Independent RPC check observed status=${onchainCheck.status ?? 'unknown'}`);
    }
    if (onchainCheck.to && onchainCheck.to.toLowerCase() !== condition.expectedTo.toLowerCase()) {
      reasons.push('Independent RPC check recipient mismatch');
    }
    if (
      condition.expectedFrom &&
      onchainCheck.from &&
      onchainCheck.from.toLowerCase() !== condition.expectedFrom.toLowerCase()
    ) {
      reasons.push('Independent RPC check sender mismatch');
    }
    if (
      condition.minValueEth > 0 &&
      onchainCheck.valueEth !== undefined &&
      onchainCheck.valueEth < condition.minValueEth
    ) {
      reasons.push('Independent RPC check value below minimum');
    }
  }

  if (reasons.length > 0) {
    return { decision: 'INCONCLUSIVE', reasons, parsedResult: data };
  }

  return {
    decision: 'RELEASE',
    reasons: ['All deterministic Telegraph and independent verification checks passed'],
    parsedResult: data,
  };
}
