import fs from 'node:fs';
import path from 'node:path';
import type { ConditionalTxCondition, ConditionVerdict } from '@revert/shared';
import type { SignedSettlementAttestation } from './attestor.js';

export type VerificationJobStatus =
  | 'PENDING'
  | 'VERIFYING'
  | 'SATISFIED'
  | 'CONTRADICTED'
  | 'INCONCLUSIVE'
  | 'EXPIRED'
  | 'DRY_RUN_READY'
  | 'BROADCASTED';

export interface StoredEvidenceSummary {
  recordedAt: string;
  idempotencyKey: string;
  rail: string;
  network: string;
  minerId: string;
  minerName?: string | undefined;
  maxAuthorizedUusdc: string;
  observedCostUusdc: string;
  receiptHash: string;
  signalHash?: string | undefined;
  signalVerified: boolean;
  onchainRpcChecked: boolean;
  onchainRpcStatus?: string | undefined;
  verdict: ConditionVerdict;
  reasons: string[];
  rawParsedResult?: unknown;
  evidenceFilePath?: string | undefined;
}

export interface VerificationJobRecord {
  escrowId: string;
  status: VerificationJobStatus;
  attempts: number;
  lastAttemptAt?: string | undefined;
  nextEligibleAtUnix?: number | undefined;
  conditionHash?: `0x${string}` | undefined;
  latestEvidence?: StoredEvidenceSummary | undefined;
  attestation?: SignedSettlementAttestation | undefined;
  broadcastTxHash?: `0x${string}` | undefined;
  lastError?: string | undefined;
}

export interface PersistedStateSnapshot {
  version: 1;
  conditions: Record<string, ConditionalTxCondition>;
  jobs: Record<string, VerificationJobRecord>;
}

/**
 * Atomic file-backed verification store surviving restarts.
 * Resets interrupted VERIFYING jobs cleanly to INCONCLUSIVE on boot.
 */
export class VerificationStateStore {
  private readonly conditions = new Map<string, ConditionalTxCondition>();
  private readonly jobs = new Map<string, VerificationJobRecord>();

  constructor(private readonly filePath?: string) {
    if (filePath && fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as PersistedStateSnapshot;
      for (const [id, cond] of Object.entries(parsed.conditions || {})) {
        this.conditions.set(id, cond);
      }
      for (const [id, job] of Object.entries(parsed.jobs || {})) {
        if (job.status === 'VERIFYING') {
          job.status = 'INCONCLUSIVE';
          job.nextEligibleAtUnix = 0;
          job.lastError = 'Recovered from interrupted verification run on restart';
        }
        this.jobs.set(id, job);
      }
    }
  }

  getCondition(escrowId: string): ConditionalTxCondition | undefined {
    return this.conditions.get(escrowId);
  }

  setCondition(escrowId: string, condition: ConditionalTxCondition): void {
    this.conditions.set(escrowId, condition);
    this.persist();
  }

  getJob(escrowId: string): VerificationJobRecord | undefined {
    const job = this.jobs.get(escrowId);
    return job ? { ...job } : undefined;
  }

  listJobs(): VerificationJobRecord[] {
    return Array.from(this.jobs.values()).map((j) => ({ ...j }));
  }

  upsertJob(job: VerificationJobRecord): void {
    this.jobs.set(job.escrowId, { ...job });
    this.persist();
  }

  private persist(): void {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    const snapshot: PersistedStateSnapshot = {
      version: 1,
      conditions: Object.fromEntries(this.conditions.entries()),
      jobs: Object.fromEntries(this.jobs.entries()),
    };
    fs.writeFileSync(tmpPath, JSON.stringify(snapshot, null, 2));
    fs.renameSync(tmpPath, this.filePath);
  }
}
