import { keccak256, stringToHex } from 'viem';
import { z } from 'zod';

const signalResponseSchema = z.object({
  signal: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  verification: z
    .object({
      verified: z.boolean(),
    })
    .optional(),
});

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/**
 * Re-derives Telegraph signal_hash per official docs:
 * compact JSON with sorted keys, lowercased wallet_address, and <, >, & escaped.
 */
export function deriveSignalHash(payload: Record<string, unknown>): `0x${string}` {
  const normalized: Record<string, unknown> = { ...payload };
  if (typeof normalized.wallet_address === 'string') {
    normalized.wallet_address = normalized.wallet_address.toLowerCase();
  }
  const sorted = sortKeysDeep(normalized);
  const compact = JSON.stringify(sorted)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
  return keccak256(stringToHex(compact));
}

export interface SignalVerificationResult {
  signalHash: `0x${string}`;
  nodeVerified: boolean;
  localHashMatched: boolean;
  derivedHash?: `0x${string}`;
  error?: string;
}

export async function verifySignalByHash(
  nodeUrl: string,
  signalHash: `0x${string}`,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<SignalVerificationResult> {
  const base = nodeUrl.replace(/\/$/, '');
  const res = await fetchImpl(`${base}/engine/v1/signal/${signalHash}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    return {
      signalHash,
      nodeVerified: false,
      localHashMatched: false,
      error: `GET /engine/v1/signal/${signalHash} returned HTTP ${res.status}`,
    };
  }

  const parsed = signalResponseSchema.parse(await res.json());
  const nodeVerified = parsed.verification?.verified === true;
  if (!parsed.payload) {
    return {
      signalHash,
      nodeVerified,
      localHashMatched: false,
      error: 'Signal response missing payload field',
    };
  }

  const derived = deriveSignalHash(parsed.payload);
  return {
    signalHash,
    nodeVerified,
    localHashMatched: derived.toLowerCase() === signalHash.toLowerCase(),
    derivedHash: derived,
  };
}
