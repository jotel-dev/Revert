import fs from 'node:fs';
import path from 'node:path';

export interface SpendRecord {
  idempotencyKey: string;
  intent: string;
  rail: string;
  network: string;
  maxAuthorizedUusdc: string;
  observedChargedUusdc: string;
  status: 'RESERVED' | 'SUCCEEDED' | 'FAILED_NO_CHARGE';
  receiptHash?: string;
  signalHash?: string;
  timestamp: string;
}

export interface SpendLedgerSnapshot {
  totalCommittedUusdc: string;
  records: Record<string, SpendRecord>;
}

export interface SpendLedgerPolicy {
  maxPerRequestUusdc: bigint;
  maxTotalBudgetUusdc: bigint;
}

export const DEFAULT_SPEND_LEDGER_POLICY: SpendLedgerPolicy = {
  maxPerRequestUusdc: 100_000n, // $0.10 test USDC
  maxTotalBudgetUusdc: 2_000_000n, // $2.00 test USDC
};

/**
 * Concurrency-safe, integer-only (uUSDC bigint) spend guard and idempotency ledger.
 * Reserves the MAXIMUM authorized spend before any payment signature is generated.
 */
export class AsyncSpendGuard {
  private mutexChain: Promise<void> = Promise.resolve();
  private readonly records = new Map<string, SpendRecord>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private reservedUusdc = 0n;
  private committedUusdc = 0n;

  constructor(
    private readonly policy: SpendLedgerPolicy = DEFAULT_SPEND_LEDGER_POLICY,
    private readonly persistPath?: string,
  ) {
    if (persistPath && fs.existsSync(persistPath)) {
      const raw = JSON.parse(fs.readFileSync(persistPath, 'utf8')) as SpendLedgerSnapshot;
      this.committedUusdc = BigInt(raw.totalCommittedUusdc || '0');
      for (const [k, rec] of Object.entries(raw.records || {})) {
        this.records.set(k, rec);
        if (rec.status === 'RESERVED') {
          this.reservedUusdc += BigInt(rec.maxAuthorizedUusdc);
        }
      }
    }
  }

  getSummary(): {
    maxPerRequestUusdc: bigint;
    maxTotalBudgetUusdc: bigint;
    reservedUusdc: bigint;
    committedUusdc: bigint;
    remainingUusdc: bigint;
  } {
    const used = this.reservedUusdc + this.committedUusdc;
    const remaining =
      this.policy.maxTotalBudgetUusdc > used ? this.policy.maxTotalBudgetUusdc - used : 0n;
    return {
      maxPerRequestUusdc: this.policy.maxPerRequestUusdc,
      maxTotalBudgetUusdc: this.policy.maxTotalBudgetUusdc,
      reservedUusdc: this.reservedUusdc,
      committedUusdc: this.committedUusdc,
      remainingUusdc: remaining,
    };
  }

  getExistingRecord(idempotencyKey: string): SpendRecord | undefined {
    return this.records.get(idempotencyKey);
  }

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.mutexChain;
    let release!: () => void;
    this.mutexChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async deduplicate<T>(idempotencyKey: string, executor: () => Promise<T>): Promise<T> {
    const inflight = this.inFlight.get(idempotencyKey) as Promise<T> | undefined;
    if (inflight) return inflight;

    const promise = executor().finally(() => {
      this.inFlight.delete(idempotencyKey);
    });
    this.inFlight.set(idempotencyKey, promise);
    return promise;
  }

  async reserve(params: {
    idempotencyKey: string;
    intent: string;
    rail: string;
    network: string;
    maxAuthorizedUusdc: bigint;
  }): Promise<void> {
    await this.runExclusive(async () => {
      const existing = this.records.get(params.idempotencyKey);
      if (existing && existing.status !== 'FAILED_NO_CHARGE') {
        throw new Error(
          `Duplicate purchase blocked for idempotencyKey="${params.idempotencyKey}" (status=${existing.status})`,
        );
      }

      if (params.maxAuthorizedUusdc <= 0n) {
        throw new Error('Authorized spend must be positive');
      }
      if (params.maxAuthorizedUusdc > this.policy.maxPerRequestUusdc) {
        throw new Error(
          `Requested max expenditure ${params.maxAuthorizedUusdc} uUSDC exceeds per-request cap ${this.policy.maxPerRequestUusdc} uUSDC`,
        );
      }
      const projected = this.reservedUusdc + this.committedUusdc + params.maxAuthorizedUusdc;
      if (projected > this.policy.maxTotalBudgetUusdc) {
        throw new Error(
          `Projected expenditure ${projected} uUSDC exceeds aggregate cap ${this.policy.maxTotalBudgetUusdc} uUSDC`,
        );
      }

      this.reservedUusdc += params.maxAuthorizedUusdc;
      this.records.set(params.idempotencyKey, {
        idempotencyKey: params.idempotencyKey,
        intent: params.intent,
        rail: params.rail,
        network: params.network,
        maxAuthorizedUusdc: params.maxAuthorizedUusdc.toString(),
        observedChargedUusdc: '0',
        status: 'RESERVED',
        timestamp: new Date().toISOString(),
      });
      this.persist();
    });
  }

  async finalize(params: {
    idempotencyKey: string;
    succeeded: boolean;
    observedChargedUusdc?: bigint;
    accountForMaxAuthorized?: boolean;
    receiptHash?: string;
    signalHash?: string;
  }): Promise<SpendRecord> {
    return this.runExclusive(async () => {
      const rec = this.records.get(params.idempotencyKey);
      if (!rec || rec.status !== 'RESERVED') {
        throw new Error(`No active reservation for idempotencyKey="${params.idempotencyKey}"`);
      }

      const reservedAmount = BigInt(rec.maxAuthorizedUusdc);
      this.reservedUusdc -= reservedAmount;

      if (params.succeeded) {
        const observed = params.observedChargedUusdc ?? reservedAmount;
        // Policy rule: account for maximum authorized expenditure unless explicit observed reconciliation is opted in.
        const accounted = params.accountForMaxAuthorized === false ? observed : reservedAmount;
        this.committedUusdc += accounted;
        rec.status = 'SUCCEEDED';
        rec.observedChargedUusdc = observed.toString();
        if (params.receiptHash) rec.receiptHash = params.receiptHash;
        if (params.signalHash) rec.signalHash = params.signalHash;
      } else {
        rec.status = 'FAILED_NO_CHARGE';
        rec.observedChargedUusdc = '0';
      }

      rec.timestamp = new Date().toISOString();
      this.persist();
      return { ...rec };
    });
  }

  private persist(): void {
    if (!this.persistPath) return;
    fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
    const snapshot: SpendLedgerSnapshot = {
      totalCommittedUusdc: this.committedUusdc.toString(),
      records: Object.fromEntries(this.records.entries()),
    };
    fs.writeFileSync(this.persistPath, JSON.stringify(snapshot, null, 2));
  }
}
