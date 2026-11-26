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
export type ConditionVerdict = 'SATISFIED' | 'CONTRADICTED' | 'INCONCLUSIVE';

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
  verdict: ConditionVerdict;
  reasons: string[];
  parsedResult?: z.infer<typeof txLookupResultSchema>;
}

/**
 * Deterministic Mode B settlement policy for ONCHAIN_TX_LOOKUP_GENERAL.
 * Distinguishes SATISFIED (all Telegraph & RPC checks pass), CONTRADICTED
 * (definitive verified mismatch/reversion), and INCONCLUSIVE (raw/unverified/
 * pending/partial/conflicting evidence — never releases funds).
 */
export function evaluateTxLookupPolicy(
  condition: ConditionalTxCondition,
  response: TelegraphAskResponse,
  signalVerified: boolean,
  onchainCheck?: IndependentOnchainObservation,
): PolicyEvaluationResult {
  const inconclusiveReasons: string[] = [];
  const contradictionReasons: string[] = [];

  if (response.intent && response.intent !== TELEGRAPH_INTENT_NAME) {
    inconclusiveReasons.push(`Unexpected intent ${response.intent}`);
  }
  if (response.result_shape !== 'intent') {
    inconclusiveReasons.push(`Result shape is ${response.result_shape}, expected intent`);
  }
  if (!response.signal_hash || !signalVerified) {
    inconclusiveReasons.push('Telegraph signal_hash missing or failed cryptographic verification');
  }
  if (response.fulfillment && response.fulfillment.status !== 'complete') {
    inconclusiveReasons.push(`Fulfillment incomplete: ${response.fulfillment.status}`);
  }
  if (response.field_status?.status && response.field_status.status !== 'ok') {
    inconclusiveReasons.push(`Status field_status is ${response.field_status.status}`);
  }

  const parsed = txLookupResultSchema.safeParse(response.result);
  if (!parsed.success) {
    inconclusiveReasons.push('Miner result does not match ONCHAIN_TX_LOOKUP_GENERAL schema');
    return { decision: 'INCONCLUSIVE', verdict: 'INCONCLUSIVE', reasons: inconclusiveReasons };
  }

  const data = parsed.data;

  // Detect definitive contradictions only when evidence itself is well-formed & verified
  if (data.status === 'reverted') {
    contradictionReasons.push('Transaction status is reverted on-chain');
  } else if (data.status === 'pending' || data.status === 'not_found') {
    inconclusiveReasons.push(`Transaction status is ${data.status}, requires confirmed`);
  }

  if (data.tx_hash && data.tx_hash.toLowerCase() !== condition.txHash.toLowerCase()) {
    contradictionReasons.push('Returned tx_hash does not match escrow condition');
  }
  if (!data.to) {
    inconclusiveReasons.push('Returned recipient (to) is missing');
  } else if (data.to.toLowerCase() !== condition.expectedTo.toLowerCase()) {
    contradictionReasons.push('Returned recipient (to) does not match expectedTo');
  }
  if (condition.expectedFrom) {
    if (!data.from) {
      inconclusiveReasons.push('Returned sender (from) is missing');
    } else if (data.from.toLowerCase() !== condition.expectedFrom.toLowerCase()) {
      contradictionReasons.push('Returned sender (from) does not match expectedFrom');
    }
  }
  if (condition.minValueEth > 0) {
    if (data.value_eth === undefined) {
      inconclusiveReasons.push('Returned value_eth is missing');
    } else if (data.value_eth < condition.minValueEth) {
      contradictionReasons.push(
        `Transferred value_eth (${data.value_eth}) below required minimum ${condition.minValueEth}`,
      );
    }
  }

  if (onchainCheck?.checked) {
    if (onchainCheck.status === 'reverted') {
      contradictionReasons.push('Independent RPC check observed status=reverted');
    } else if (onchainCheck.status !== 'confirmed') {
      inconclusiveReasons.push(
        `Independent RPC check observed status=${onchainCheck.status ?? 'unknown'}`,
      );
    }
    if (onchainCheck.to && onchainCheck.to.toLowerCase() !== condition.expectedTo.toLowerCase()) {
      contradictionReasons.push('Independent RPC check recipient mismatch');
    }
    if (
      condition.expectedFrom &&
      onchainCheck.from &&
      onchainCheck.from.toLowerCase() !== condition.expectedFrom.toLowerCase()
    ) {
      contradictionReasons.push('Independent RPC check sender mismatch');
    }
    if (
      condition.minValueEth > 0 &&
      onchainCheck.valueEth !== undefined &&
      onchainCheck.valueEth < condition.minValueEth
    ) {
      contradictionReasons.push('Independent RPC check value below minimum');
    }
  }

  // If signal isn't verified or schema/fulfillment was incomplete, NEVER declare CONTRADICTED (stay INCONCLUSIVE)
  if (inconclusiveReasons.length > 0) {
    return {
      decision: 'INCONCLUSIVE',
      verdict: 'INCONCLUSIVE',
      reasons: [...inconclusiveReasons, ...contradictionReasons],
      parsedResult: data,
    };
  }

  // If Telegraph said confirmed AND RPC contradicted (or vice versa), treat as INCONCLUSIVE conflict
  if (onchainCheck?.checked && data.status === 'confirmed' && onchainCheck.status !== 'confirmed') {
    return {
      decision: 'INCONCLUSIVE',
      verdict: 'INCONCLUSIVE',
      reasons: ['Conflict between Telegraph confirmed status and independent RPC observation'],
      parsedResult: data,
    };
  }

  if (contradictionReasons.length > 0) {
    return {
      decision: 'INCONCLUSIVE',
      verdict: 'CONTRADICTED',
      reasons: contradictionReasons,
      parsedResult: data,
    };
  }

  return {
    decision: 'RELEASE',
    verdict: 'SATISFIED',
    reasons: ['All deterministic Telegraph and independent verification checks passed'],
    parsedResult: data,
  };
}
