import fs from 'node:fs';
import path from 'node:path';
import { sanitizeForLog } from './logger.js';
import type { TelegraphReceipt } from './types.js';
import type { SignalVerificationResult } from './signal-verifier.js';

export interface PurchaseEvidenceRecord {
  version: 1;
  recordedAt: string;
  verificationTier: 'TESTNET' | 'MOCKED';
  idempotencyKey: string;
  nodeUrl: string;
  request: {
    intent: string;
    params: Record<string, unknown>;
    max_budget_usdc?: number;
  };
  payment: {
    rail: string;
    network: string;
    payTo: string;
    asset?: string;
    maxAuthorizedUusdc: string;
    observedCostUusdc: string;
    receipt: TelegraphReceipt;
  };
  response: {
    minerId: string;
    minerName?: string;
    intent?: string;
    resultShape: string;
    fieldStatus?: Record<string, string>;
    result: unknown;
    durationMs?: number;
    fulfillment?: unknown;
  };
  signalVerification?: SignalVerificationResult;
}

export function saveRedactedEvidence(
  directory: string,
  filenamePrefix: string,
  record: PurchaseEvidenceRecord,
): string {
  fs.mkdirSync(directory, { recursive: true });
  const safeSlug = filenamePrefix.replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = path.join(directory, `${safeSlug}.json`);
  const sanitized = sanitizeForLog(record);
  fs.writeFileSync(filePath, JSON.stringify(sanitized, null, 2));
  return filePath;
}
