import {
  computeConditionHash,
  conditionalTxConditionSchema,
  evaluateTxLookupPolicy,
  TELEGRAPH_INTENT_NAME,
  type ConditionalTxCondition,
  type IndependentOnchainObservation,
} from '@revert/shared';
import {
  createRedactedLogger,
  type SafeLogger,
  type TelegraphClient,
} from '@revert/telegraph-client';
import type { Eip712SettlementAttestor } from './attestor.js';
import type { EscrowChainGateway, OnchainEscrowRecord } from './escrow-chain.js';
import type { IndependentRpcVerifier } from './independent-rpc.js';
import type { VerificationJobRecord, VerificationStateStore } from './state-store.js';

export interface VerificationEngineConfig {
  chainGateway: EscrowChainGateway;
  telegraphClient: TelegraphClient;
  rpcVerifier: IndependentRpcVerifier;
  attestor: Eip712SettlementAttestor;
  stateStore: VerificationStateStore;
  allowLiveSpend?: boolean;
  enableServerBroadcaster?: boolean;
  askMaxBudgetUusdc?: number;
  retryCooldownSeconds?: number;
  logger?: SafeLogger;
  nowUnix?: () => number;
}

export interface DiscoveredEscrowView {
  onchain: OnchainEscrowRecord;
  condition?: ConditionalTxCondition | undefined;
  conditionHashMatches: boolean;
  eligibleForVerification: boolean;
  eligibilityReason?: string | undefined;
  verification?: VerificationJobRecord | undefined;
}

export class VerificationEngine {
  private readonly inFlightByEscrow = new Map<string, Promise<VerificationJobRecord>>();
  private readonly allowLiveSpend: boolean;
  private readonly enableServerBroadcaster: boolean;
  private readonly askMaxBudgetUusdc: number;
  private readonly retryCooldownSeconds: number;
  private readonly logger: SafeLogger;
  private readonly nowUnix: () => number;

  constructor(private readonly config: VerificationEngineConfig) {
    this.allowLiveSpend = config.allowLiveSpend ?? false;
    this.enableServerBroadcaster = config.enableServerBroadcaster ?? false;
    this.askMaxBudgetUusdc = config.askMaxBudgetUusdc ?? 50_000;
    this.retryCooldownSeconds = config.retryCooldownSeconds ?? 60;
    this.logger = config.logger ?? createRedactedLogger();
    this.nowUnix = config.nowUnix ?? (() => Math.floor(Date.now() / 1000));
  }

  getAttestorAddress(): `0x${string}` {
    return this.config.attestor.getAddress();
  }

  getFlags(): { allowLiveSpend: boolean; enableServerBroadcaster: boolean } {
    return {
      allowLiveSpend: this.allowLiveSpend,
      enableServerBroadcaster: this.enableServerBroadcaster,
    };
  }

  async registerCondition(
    escrowId: string,
    rawCondition: unknown,
  ): Promise<{ condition: ConditionalTxCondition; conditionHash: `0x${string}` }> {
    const escrow = await this.config.chainGateway.getEscrow(escrowId);
    if (!escrow) {
      throw new Error(`Escrow ${escrowId} not found on-chain`);
    }
    if (escrow.mode !== 'Conditional') {
      throw new Error(`Escrow ${escrowId} is Mode ${escrow.mode}, not Conditional`);
    }

    const condition = conditionalTxConditionSchema.parse(rawCondition);
    const computedHash = computeConditionHash(condition);
    if (computedHash.toLowerCase() !== escrow.conditionHash.toLowerCase()) {
      throw new Error(
        `Condition hash mismatch: computed ${computedHash} != onchain ${escrow.conditionHash}`,
      );
    }

    this.config.stateStore.setCondition(escrowId, condition);
    if (!this.config.stateStore.getJob(escrowId)) {
      this.config.stateStore.upsertJob({
        escrowId,
        status: 'PENDING',
        attempts: 0,
        conditionHash: computedHash,
      });
    }
    return { condition, conditionHash: computedHash };
  }

  async listEscrowViews(): Promise<DiscoveredEscrowView[]> {
    const onchainList = await this.config.chainGateway.listEscrows();
    const views: DiscoveredEscrowView[] = [];
    for (const onchain of onchainList) {
      views.push(await this.buildEscrowView(onchain));
    }
    return views;
  }

  async getEscrowView(escrowId: string): Promise<DiscoveredEscrowView | undefined> {
    const onchain = await this.config.chainGateway.getEscrow(escrowId);
    if (!onchain) return undefined;
    return this.buildEscrowView(onchain);
  }

  async discoverEligibleConditionalEscrows(): Promise<DiscoveredEscrowView[]> {
    const all = await this.listEscrowViews();
    return all.filter((v) => v.eligibleForVerification);
  }

  isVerificationDue(view: DiscoveredEscrowView, force = false): boolean {
    if (!view.eligibleForVerification) return false;
    const job = view.verification;
    if (!job) return true;
    if (job.status === 'SATISFIED' || job.status === 'BROADCASTED' || job.status === 'EXPIRED') {
      return false;
    }
    if (job.status === 'VERIFYING') return false;
    if (force) return true;
    const now = this.nowUnix();
    return (job.nextEligibleAtUnix ?? 0) <= now;
  }

  async verifyEscrow(
    escrowId: string,
    options: { dryRun?: boolean; force?: boolean } = {},
  ): Promise<VerificationJobRecord> {
    const existingPromise = this.inFlightByEscrow.get(escrowId);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = this.executeVerification(escrowId, options).finally(() => {
      this.inFlightByEscrow.delete(escrowId);
    });
    this.inFlightByEscrow.set(escrowId, promise);
    return promise;
  }

  async runPollCycle(options: { dryRun?: boolean } = {}): Promise<VerificationJobRecord[]> {
    const eligible = await this.discoverEligibleConditionalEscrows();
    const results: VerificationJobRecord[] = [];
    for (const view of eligible) {
      if (this.isVerificationDue(view)) {
        const res = await this.verifyEscrow(view.onchain.escrowId, options);
        results.push(res);
      }
    }
    return results;
  }

  async broadcastVerifiedSettlement(escrowId: string): Promise<VerificationJobRecord> {
    if (!this.enableServerBroadcaster) {
      throw new Error(
        'Server-side settlement broadcasting is disabled (ENABLE_SERVER_BROADCASTER!=true); submit attestation from user wallet instead.',
      );
    }

    const view = await this.getEscrowView(escrowId);
    if (!view) throw new Error(`Escrow ${escrowId} not found`);
    if (view.onchain.state !== 'LOCKED') {
      throw new Error(`Escrow ${escrowId} is not LOCKED (state=${view.onchain.state})`);
    }
    const job = view.verification;
    if (!job || job.status !== 'SATISFIED' || !job.attestation) {
      throw new Error(`Escrow ${escrowId} has no SATISFIED attestation ready for broadcast`);
    }
    const now = this.nowUnix();
    if (now > view.onchain.deadline) {
      throw new Error(`Escrow ${escrowId} deadline has expired`);
    }
    if (now > job.attestation.input.expiresAt) {
      throw new Error(`Attestation for escrow ${escrowId} expired; re-verify before broadcast`);
    }

    const txHash = await this.config.chainGateway.broadcastSettlement(job.attestation);
    const updated: VerificationJobRecord = {
      ...job,
      status: 'BROADCASTED',
      broadcastTxHash: txHash,
    };
    this.config.stateStore.upsertJob(updated);
    return updated;
  }

  private async buildEscrowView(onchain: OnchainEscrowRecord): Promise<DiscoveredEscrowView> {
    const verification = this.config.stateStore.getJob(onchain.escrowId);
    if (onchain.mode !== 'Conditional') {
      return {
        onchain,
        conditionHashMatches: false,
        eligibleForVerification: false,
        eligibilityReason: 'Mode A Protected escrow does not use Telegraph verification',
        verification,
      };
    }

    const condition = this.config.stateStore.getCondition(onchain.escrowId);
    const conditionHashMatches = condition
      ? computeConditionHash(condition).toLowerCase() === onchain.conditionHash.toLowerCase()
      : false;

    const now = this.nowUnix();
    let eligible = true;
    let reason: string | undefined;

    if (onchain.state !== 'LOCKED') {
      eligible = false;
      reason = `Escrow state is ${onchain.state}`;
    } else if (BigInt(onchain.amount) <= 0n) {
      eligible = false;
      reason = 'Escrow amount is zero';
    } else if (now > onchain.deadline) {
      eligible = false;
      reason = 'Escrow deadline expired; sender refund via refundExpired available';
    } else if (onchain.attestor.toLowerCase() !== this.getAttestorAddress()) {
      eligible = false;
      reason = `Escrow attestor ${onchain.attestor} does not match service attestor`;
    } else if (!condition || !conditionHashMatches) {
      eligible = false;
      reason = 'Matching off-chain condition preimage not registered';
    } else if (!(await this.config.chainGateway.isTokenAllowed(onchain.token))) {
      eligible = false;
      reason = `Token ${onchain.token} is not allowlisted`;
    }

    return {
      onchain,
      condition,
      conditionHashMatches,
      eligibleForVerification: eligible,
      eligibilityReason: reason,
      verification,
    };
  }

  private async executeVerification(
    escrowId: string,
    options: { dryRun?: boolean; force?: boolean },
  ): Promise<VerificationJobRecord> {
    const view = await this.getEscrowView(escrowId);
    if (!view) {
      throw new Error(`Escrow ${escrowId} not found`);
    }

    const existing = view.verification ?? {
      escrowId,
      status: 'PENDING' as const,
      attempts: 0,
      conditionHash: view.onchain.conditionHash,
    };

    const now = this.nowUnix();
    if (view.onchain.state === 'LOCKED' && now > view.onchain.deadline) {
      const expired: VerificationJobRecord = {
        ...existing,
        status: 'EXPIRED',
        lastError: 'Deadline passed; eligible for permissionless refundExpired()',
      };
      this.config.stateStore.upsertJob(expired);
      return expired;
    }

    if (!view.eligibleForVerification || !view.condition) {
      throw new Error(view.eligibilityReason ?? 'Escrow is not eligible for verification');
    }

    if (existing.status === 'BROADCASTED') {
      return existing;
    }

    if (
      existing.status === 'SATISFIED' &&
      existing.attestation &&
      existing.attestation.input.expiresAt > now + 30
    ) {
      return existing;
    }

    if (!options.force && (existing.nextEligibleAtUnix ?? 0) > now) {
      return existing;
    }

    const dryRun = options.dryRun ?? !this.allowLiveSpend;

    if (dryRun) {
      const drySummary = await this.config.telegraphClient.dryRunAsk({
        intent: TELEGRAPH_INTENT_NAME,
        params: { tx_hash: view.condition.txHash, chain: view.condition.chain },
        max_budget_usdc: this.askMaxBudgetUusdc,
      });

      const dryRecord: VerificationJobRecord = {
        ...existing,
        status: existing.status === 'PENDING' ? 'DRY_RUN_READY' : existing.status,
        lastAttemptAt: new Date(now * 1000).toISOString(),
        latestEvidence: existing.latestEvidence ?? {
          recordedAt: new Date(now * 1000).toISOString(),
          idempotencyKey: `dry-run-${escrowId}`,
          rail: drySummary.inspection.selectedOption.scheme,
          network: drySummary.inspection.selectedOption.network,
          minerId: 'DRY_RUN',
          maxAuthorizedUusdc: drySummary.expectedMaxExpenditureUusdc,
          observedCostUusdc: '0',
          receiptHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
          signalVerified: false,
          onchainRpcChecked: false,
          verdict: 'INCONCLUSIVE',
          reasons: ['Dry-run mode: challenge validated with zero spend and no attestation signed'],
        },
      };
      this.config.stateStore.upsertJob(dryRecord);
      return dryRecord;
    }

    if (!this.allowLiveSpend) {
      throw new Error(
        'Live verification requires TELEGRAPH_ALLOW_LIVE_SPEND=true (or run with dryRun=true).',
      );
    }

    const attemptNum = existing.attempts + 1;
    const verifyingJob: VerificationJobRecord = {
      ...existing,
      status: 'VERIFYING',
      attempts: attemptNum,
      lastAttemptAt: new Date(now * 1000).toISOString(),
      lastError: undefined,
    };
    this.config.stateStore.upsertJob(verifyingJob);

    const idempotencyKey = `revert-escrow-${escrowId}-attempt-${attemptNum}`;

    try {
      const [purchase, rpcObservation] = await Promise.all([
        this.config.telegraphClient.purchaseIntelligence(
          {
            intent: TELEGRAPH_INTENT_NAME,
            params: { tx_hash: view.condition.txHash, chain: view.condition.chain },
            max_budget_usdc: this.askMaxBudgetUusdc,
          },
          { idempotencyKey, verifySignal: true },
        ),
        this.config.rpcVerifier.verifyTransaction(view.condition),
      ]);

      const signalVerified = Boolean(
        purchase.signalVerification?.nodeVerified && purchase.signalVerification?.localHashMatched,
      );

      const evaluation = evaluateTxLookupPolicy(
        view.condition,
        purchase.response,
        signalVerified,
        rpcObservation,
      );

      const evidenceSummary = {
        recordedAt: new Date().toISOString(),
        idempotencyKey,
        rail: purchase.rail,
        network: purchase.network,
        minerId: purchase.response.miner_id,
        minerName: purchase.response.miner_name,
        maxAuthorizedUusdc: purchase.maxAuthorizedUusdc.toString(),
        observedCostUusdc: purchase.observedCostUusdc.toString(),
        receiptHash: purchase.receipt.receipt_hash,
        signalHash: purchase.response.signal_hash,
        signalVerified,
        onchainRpcChecked: rpcObservation.checked,
        onchainRpcStatus: rpcObservation.status,
        verdict: evaluation.verdict,
        reasons: evaluation.reasons,
        rawParsedResult: evaluation.parsedResult,
        evidenceFilePath: purchase.evidenceFilePath,
      };

      if (evaluation.verdict === 'SATISFIED') {
        const signalHash = purchase.response.signal_hash as `0x${string}`;
        const receiptHash = purchase.receipt.receipt_hash as `0x${string}`;
        const attestation = await this.config.attestor.signReleaseAttestation({
          escrowId,
          conditionHash: view.onchain.conditionHash,
          evidencePayload: evidenceSummary,
          signalHash,
          receiptHash,
          ttlSeconds: Math.min(900, Math.max(60, view.onchain.deadline - this.nowUnix())),
          nowUnix: this.nowUnix(),
        });

        const satisfiedJob: VerificationJobRecord = {
          ...verifyingJob,
          status: 'SATISFIED',
          latestEvidence: evidenceSummary,
          attestation,
        };
        this.config.stateStore.upsertJob(satisfiedJob);
        this.logger.info('Conditional escrow verification SATISFIED and attested', {
          escrowId,
          receiptHash,
          signalHash,
          observedCostUusdc: purchase.observedCostUusdc.toString(),
        });
        return satisfiedJob;
      }

      const nextStatus = evaluation.verdict === 'CONTRADICTED' ? 'CONTRADICTED' : 'INCONCLUSIVE';
      const unresolvedJob: VerificationJobRecord = {
        ...verifyingJob,
        status: nextStatus,
        nextEligibleAtUnix: this.nowUnix() + this.retryCooldownSeconds,
        latestEvidence: evidenceSummary,
      };
      this.config.stateStore.upsertJob(unresolvedJob);
      return unresolvedJob;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const erroredJob: VerificationJobRecord = {
        ...verifyingJob,
        status: 'INCONCLUSIVE',
        nextEligibleAtUnix: this.nowUnix() + this.retryCooldownSeconds,
        lastError: msg,
      };
      this.config.stateStore.upsertJob(erroredJob);
      this.logger.warn('Verification attempt failed safely; escrow remains LOCKED', {
        escrowId,
        error: msg,
      });
      return erroredJob;
    }
  }
}

export type { IndependentOnchainObservation };
