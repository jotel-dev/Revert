import crypto from 'node:crypto';
import { ExactEvmScheme } from '@x402/evm';
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch';
import {
  evaluateTxLookupPolicy,
  telegraphAskResponseSchema,
  type ConditionalTxCondition,
  type PolicyEvaluationResult,
  type TelegraphAskResponse,
} from '@revert/shared';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { saveRedactedEvidence, type PurchaseEvidenceRecord } from './evidence-store.js';
import { createRedactedLogger, type SafeLogger } from './logger.js';
import { verifySignalByHash, type SignalVerificationResult } from './signal-verifier.js';
import { AsyncSpendGuard, DEFAULT_SPEND_LEDGER_POLICY } from './spend-ledger.js';
import {
  CAIP2_BASE_SEPOLIA,
  CAIP2_ETHEREUM_SEPOLIA,
  DEFAULT_ALLOWED_NETWORKS,
  DEFAULT_ALLOWED_TOKENS_BY_NETWORK,
  DEFAULT_TRUSTED_PAYTO_BY_NETWORK,
  intentInfoSchema,
  ledgerAccountSchema,
  minersListSchema,
  paymentChallengeSchema,
  telegraphAskRequestSchema,
  telegraphReceiptSchema,
  type IntentInfo,
  type LedgerAccount,
  type MinersList,
  type PaymentAcceptOption,
  type PaymentChallenge,
  type TelegraphAskRequest,
  type TelegraphReceipt,
} from './types.js';

export interface TelegraphClientConfig {
  nodeUrl?: string;
  preferredRail?: 'escrow' | 'exact';
  preferredNetwork?: string;
  allowedNetworks?: readonly string[];
  allowedTokensByNetwork?: Record<string, readonly string[]>;
  trustedPayToByNetwork?: Record<string, readonly string[]>;
  maxPerRequestUusdc?: bigint;
  maxTotalBudgetUusdc?: bigint;
  accountForMaxAuthorized?: boolean;
  timeoutMs?: number;
  maxPrePaymentRetries?: number;
  retryBaseDelayMs?: number;
  evidenceDir?: string;
  ledgerPersistPath?: string;
  privateKey?: `0x${string}` | undefined;
  logger?: SafeLogger;
  fetchImpl?: typeof fetch;
}

export interface ChallengeInspection {
  challengeStatus: 402;
  challenge: PaymentChallenge;
  selectedOption: PaymentAcceptOption;
  maxAuthorizedUusdc: bigint;
}

export interface DryRunSummary {
  mode: 'DRY_RUN';
  nodeUrl: string;
  intent: IntentInfo;
  minersCount: number;
  inspection: ChallengeInspection;
  expectedMaxExpenditureUusdc: string;
  budgetSummary: ReturnType<AsyncSpendGuard['getSummary']>;
  paidExecuted: false;
}

export interface PurchaseResult {
  idempotencyKey: string;
  fromCache: boolean;
  rail: string;
  network: string;
  payTo: string;
  maxAuthorizedUusdc: bigint;
  observedCostUusdc: bigint;
  latencyMs: number;
  receipt: TelegraphReceipt;
  response: TelegraphAskResponse;
  signalVerification?: SignalVerificationResult | undefined;
  policyEvaluation?: PolicyEvaluationResult | undefined;
  evidenceFilePath?: string | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class TelegraphClient {
  private readonly nodeUrl: string;
  private readonly preferredRail: 'escrow' | 'exact';
  private readonly preferredNetwork: string;
  private readonly allowedNetworks: Set<string>;
  private readonly allowedTokensByNetwork: Record<string, readonly string[]>;
  private readonly trustedPayToByNetwork: Record<string, readonly string[]>;
  private readonly accountForMaxAuthorized: boolean;
  private readonly timeoutMs: number;
  private readonly maxPrePaymentRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly evidenceDir: string | undefined;
  private readonly logger: SafeLogger;
  private readonly fetchFn: typeof fetch;
  private readonly account: PrivateKeyAccount | undefined;
  private readonly spendGuard: AsyncSpendGuard;
  private readonly completedCache = new Map<string, PurchaseResult>();

  constructor(config: TelegraphClientConfig = {}) {
    this.nodeUrl = (config.nodeUrl ?? 'https://devnode.telegraphprotocol.com').replace(/\/$/, '');
    this.preferredRail = config.preferredRail ?? 'escrow';
    this.preferredNetwork = config.preferredNetwork ?? CAIP2_ETHEREUM_SEPOLIA;
    this.allowedNetworks = new Set(config.allowedNetworks ?? DEFAULT_ALLOWED_NETWORKS);
    this.allowedTokensByNetwork =
      config.allowedTokensByNetwork ?? DEFAULT_ALLOWED_TOKENS_BY_NETWORK;
    this.trustedPayToByNetwork = config.trustedPayToByNetwork ?? DEFAULT_TRUSTED_PAYTO_BY_NETWORK;
    this.accountForMaxAuthorized = config.accountForMaxAuthorized ?? true;
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.maxPrePaymentRetries = config.maxPrePaymentRetries ?? 2;
    this.retryBaseDelayMs = config.retryBaseDelayMs ?? 300;
    this.evidenceDir = config.evidenceDir;
    this.logger = config.logger ?? createRedactedLogger();
    this.fetchFn = config.fetchImpl ?? fetch;
    this.account = config.privateKey ? privateKeyToAccount(config.privateKey) : undefined;
    this.spendGuard = new AsyncSpendGuard(
      {
        maxPerRequestUusdc:
          config.maxPerRequestUusdc ?? DEFAULT_SPEND_LEDGER_POLICY.maxPerRequestUusdc,
        maxTotalBudgetUusdc:
          config.maxTotalBudgetUusdc ?? DEFAULT_SPEND_LEDGER_POLICY.maxTotalBudgetUusdc,
      },
      config.ledgerPersistPath,
    );
  }

  getWalletAddress(): `0x${string}` | undefined {
    return this.account?.address;
  }

  getBudgetSummary(): ReturnType<AsyncSpendGuard['getSummary']> {
    return this.spendGuard.getSummary();
  }

  async discoverIntent(intentName: string): Promise<IntentInfo> {
    const res = await this.fetchWithRetry(
      `${this.nodeUrl}/engine/v1/intents/${encodeURIComponent(intentName)}`,
      { method: 'GET' },
    );
    if (!res.ok) {
      throw new Error(`Intent discovery failed for ${intentName}: HTTP ${res.status}`);
    }
    const parsed = intentInfoSchema.parse(await res.json());
    if (parsed.miner_count === 0 || !parsed.request || !parsed.response) {
      throw new Error(`Intent ${intentName} has no active miners or published schema`);
    }
    return parsed;
  }

  async discoverMiners(intentName: string): Promise<MinersList> {
    const res = await this.fetchWithRetry(
      `${this.nodeUrl}/engine/v1/intents/${encodeURIComponent(intentName)}/miners`,
      { method: 'GET' },
    );
    if (!res.ok) {
      throw new Error(`Miner discovery failed for ${intentName}: HTTP ${res.status}`);
    }
    return minersListSchema.parse(await res.json());
  }

  async getEscrowAccount(address: `0x${string}`): Promise<LedgerAccount> {
    const res = await this.fetchWithRetry(
      `${this.nodeUrl}/v1/ledger/account/${address.toLowerCase()}`,
      { method: 'GET' },
    );
    if (!res.ok) {
      throw new Error(`Escrow ledger lookup failed: HTTP ${res.status}`);
    }
    return ledgerAccountSchema.parse(await res.json());
  }

  async inspectChallenge(rawRequest: TelegraphAskRequest): Promise<ChallengeInspection> {
    const request = telegraphAskRequestSchema.parse(rawRequest);
    const res = await this.fetchWithRetry(`${this.nodeUrl}/engine/v1/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (res.status !== 402) {
      const bodyPreview = await res.text();
      throw new Error(
        `Expected HTTP 402 challenge during inspection, got HTTP ${res.status}: ${bodyPreview.slice(0, 200)}`,
      );
    }

    const header = res.headers.get('payment-required');
    if (!header) {
      throw new Error('402 response missing PAYMENT-REQUIRED header');
    }

    const decoded = JSON.parse(Buffer.from(header.trim(), 'base64').toString('utf8')) as unknown;
    const challenge = paymentChallengeSchema.parse(decoded);
    const selectedOption = this.validateAndSelectOption(challenge, request.max_budget_usdc);

    return {
      challengeStatus: 402,
      challenge,
      selectedOption,
      maxAuthorizedUusdc: BigInt(selectedOption.amount),
    };
  }

  async dryRunAsk(rawRequest: TelegraphAskRequest): Promise<DryRunSummary> {
    const request = telegraphAskRequestSchema.parse(rawRequest);
    const [intent, miners, inspection] = await Promise.all([
      this.discoverIntent(request.intent),
      this.discoverMiners(request.intent),
      this.inspectChallenge(request),
    ]);

    const summary = this.spendGuard.getSummary();
    if (inspection.maxAuthorizedUusdc > summary.maxPerRequestUusdc) {
      throw new Error(
        `Dry-run failed cap check: quoted ${inspection.maxAuthorizedUusdc} uUSDC > per-request cap ${summary.maxPerRequestUusdc}`,
      );
    }
    if (inspection.maxAuthorizedUusdc > summary.remainingUusdc) {
      throw new Error(
        `Dry-run failed cap check: quoted ${inspection.maxAuthorizedUusdc} uUSDC > remaining budget ${summary.remainingUusdc}`,
      );
    }

    return {
      mode: 'DRY_RUN',
      nodeUrl: this.nodeUrl,
      intent,
      minersCount: miners.miners.length,
      inspection,
      expectedMaxExpenditureUusdc: inspection.maxAuthorizedUusdc.toString(),
      budgetSummary: summary,
      paidExecuted: false,
    };
  }

  async purchaseIntelligence(
    rawRequest: TelegraphAskRequest,
    options: {
      idempotencyKey: string;
      condition?: ConditionalTxCondition;
      verifySignal?: boolean;
    },
  ): Promise<PurchaseResult> {
    if (!this.account) {
      throw new Error('Cannot execute paid purchase without configured local signer account');
    }
    if (!options.idempotencyKey || options.idempotencyKey.trim().length < 4) {
      throw new Error('idempotencyKey must be at least 4 characters');
    }

    const cached = this.completedCache.get(options.idempotencyKey);
    if (cached) {
      return { ...cached, fromCache: true };
    }

    const existingRecord = this.spendGuard.getExistingRecord(options.idempotencyKey);
    if (existingRecord && existingRecord.status === 'SUCCEEDED') {
      throw new Error(
        `Duplicate purchase blocked for already-completed idempotencyKey="${options.idempotencyKey}" (receipt=${existingRecord.receiptHash ?? 'unknown'})`,
      );
    }

    return this.spendGuard.deduplicate(options.idempotencyKey, async () => {
      const request = telegraphAskRequestSchema.parse(rawRequest);
      const inspection = await this.inspectChallenge(request);
      const option = inspection.selectedOption;
      const maxAuthorized = inspection.maxAuthorizedUusdc;

      await this.spendGuard.reserve({
        idempotencyKey: options.idempotencyKey,
        intent: request.intent,
        rail: option.scheme,
        network: option.network,
        maxAuthorizedUusdc: maxAuthorized,
      });

      this.logger.info('Reserved Telegraph purchase budget', {
        idempotencyKey: options.idempotencyKey,
        intent: request.intent,
        rail: option.scheme,
        network: option.network,
        payTo: option.payTo,
        maxAuthorizedUusdc: maxAuthorized.toString(),
      });

      const started = Date.now();
      let succeeded = false;
      try {
        const execResult =
          option.scheme === 'escrow'
            ? await this.executeEscrowPurchase(request, option, this.account!)
            : await this.executeX402ExactPurchase(request, option, this.account!);

        const latencyMs = Date.now() - started;
        const observedCostUusdc = BigInt(execResult.receipt.amount_uusdc);

        let signalVerification: SignalVerificationResult | undefined;
        if (options.verifySignal !== false && execResult.parsed.signal_hash) {
          signalVerification = await verifySignalByHash(
            this.nodeUrl,
            execResult.parsed.signal_hash as `0x${string}`,
            this.fetchFn,
            this.timeoutMs,
          );
        }

        const policyEvaluation = options.condition
          ? evaluateTxLookupPolicy(
              options.condition,
              execResult.parsed,
              Boolean(
                signalVerification &&
                signalVerification.nodeVerified &&
                signalVerification.localHashMatched,
              ),
            )
          : undefined;

        await this.spendGuard.finalize({
          idempotencyKey: options.idempotencyKey,
          succeeded: true,
          observedChargedUusdc: observedCostUusdc,
          accountForMaxAuthorized: this.accountForMaxAuthorized,
          receiptHash: execResult.receipt.receipt_hash,
          ...(execResult.parsed.signal_hash ? { signalHash: execResult.parsed.signal_hash } : {}),
        });
        succeeded = true;

        let evidenceFilePath: string | undefined;
        if (this.evidenceDir) {
          const evidenceRecord: PurchaseEvidenceRecord = {
            version: 1,
            recordedAt: new Date().toISOString(),
            verificationTier: 'TESTNET',
            idempotencyKey: options.idempotencyKey,
            nodeUrl: this.nodeUrl,
            request: {
              intent: request.intent,
              params: request.params,
              ...(request.max_budget_usdc !== undefined
                ? { max_budget_usdc: request.max_budget_usdc }
                : {}),
            },
            payment: {
              rail: option.scheme,
              network: option.network,
              payTo: option.payTo,
              ...(option.asset ? { asset: option.asset } : {}),
              maxAuthorizedUusdc: maxAuthorized.toString(),
              observedCostUusdc: observedCostUusdc.toString(),
              receipt: execResult.receipt,
            },
            response: {
              minerId: execResult.parsed.miner_id,
              ...(execResult.parsed.miner_name ? { minerName: execResult.parsed.miner_name } : {}),
              ...(execResult.parsed.intent ? { intent: execResult.parsed.intent } : {}),
              resultShape: execResult.parsed.result_shape,
              ...(execResult.parsed.field_status
                ? { fieldStatus: execResult.parsed.field_status }
                : {}),
              result: execResult.parsed.result,
              ...(execResult.parsed.duration_ms !== undefined
                ? { durationMs: execResult.parsed.duration_ms }
                : {}),
              ...(execResult.parsed.fulfillment
                ? { fulfillment: execResult.parsed.fulfillment }
                : {}),
            },
            ...(signalVerification ? { signalVerification } : {}),
          };
          evidenceFilePath = saveRedactedEvidence(
            this.evidenceDir,
            options.idempotencyKey,
            evidenceRecord,
          );
        }

        const result: PurchaseResult = {
          idempotencyKey: options.idempotencyKey,
          fromCache: false,
          rail: option.scheme,
          network: option.network,
          payTo: option.payTo,
          maxAuthorizedUusdc: maxAuthorized,
          observedCostUusdc,
          latencyMs,
          receipt: execResult.receipt,
          response: execResult.parsed,
          signalVerification,
          policyEvaluation,
          evidenceFilePath,
        };
        this.completedCache.set(options.idempotencyKey, result);
        return result;
      } finally {
        if (!succeeded) {
          await this.spendGuard.finalize({
            idempotencyKey: options.idempotencyKey,
            succeeded: false,
          });
        }
      }
    });
  }

  private validateAndSelectOption(
    challenge: PaymentChallenge,
    requestedMaxBudget?: number,
  ): PaymentAcceptOption {
    const eligible = challenge.accepts.filter((opt) => {
      if (!this.allowedNetworks.has(opt.network)) return false;

      const trustedPayTos = this.trustedPayToByNetwork[opt.network];
      if (!trustedPayTos || !trustedPayTos.includes(opt.payTo.toLowerCase())) {
        return false;
      }

      if (opt.scheme === 'exact') {
        const allowedAssets = this.allowedTokensByNetwork[opt.network];
        if (!opt.asset || !allowedAssets || !allowedAssets.includes(opt.asset.toLowerCase())) {
          return false;
        }
      }
      return true;
    });

    if (eligible.length === 0) {
      throw new Error(
        `No challenge accept options passed network/token/payTo allowlists (${challenge.accepts.map((a) => `${a.scheme}:${a.network}`).join(', ')})`,
      );
    }

    const chosen =
      eligible.find(
        (a) => a.scheme === this.preferredRail && a.network === this.preferredNetwork,
      ) ??
      eligible.find((a) => a.scheme === this.preferredRail) ??
      eligible[0]!;

    const quoted = BigInt(chosen.amount);
    if (requestedMaxBudget !== undefined && quoted > BigInt(requestedMaxBudget)) {
      throw new Error(
        `Challenge amount ${quoted} exceeds requested max_budget_usdc ${requestedMaxBudget}`,
      );
    }
    return chosen;
  }

  private async executeEscrowPurchase(
    request: TelegraphAskRequest,
    option: PaymentAcceptOption,
    account: PrivateKeyAccount,
  ): Promise<{ parsed: TelegraphAskResponse; receipt: TelegraphReceipt }> {
    const extra = option.extra as { message?: unknown } | undefined;
    const template = typeof extra?.message === 'string' ? extra.message : undefined;
    if (!template) {
      throw new Error('Escrow 402 option missing extra.message signing template');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const validAfter = nowSec - 5;
    const validBefore = nowSec + 100; // <= 120s required by Telegraph
    const nonce = crypto.randomUUID();
    const fromLower = account.address.toLowerCase();

    const message = template
      .replace('{from}', fromLower)
      .replace('{nonce}', nonce)
      .replace('{validAfter}', String(validAfter))
      .replace('{validBefore}', String(validBefore));

    const signature = await account.signMessage({ message });

    const envelope = {
      x402Version: 2,
      scheme: 'escrow',
      network: option.network,
      payload: {
        signature,
        authorization: {
          from: fromLower,
          to: option.payTo,
          value: option.amount,
          validAfter: String(validAfter),
          validBefore: String(validBefore),
          nonce,
        },
      },
    };

    const paymentHeader = Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64');
    const res = await this.fetchFn(`${this.nodeUrl}/engine/v1/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PAYMENT': paymentHeader,
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (res.status === 402) {
      const reason = await res.text();
      throw new Error(`Telegraph escrow payment refused (HTTP 402): ${reason.slice(0, 300)}`);
    }
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(
        `Telegraph escrow request failed (HTTP ${res.status}): ${errBody.slice(0, 300)}`,
      );
    }

    const receiptHeader =
      res.headers.get('x-payment-response') ?? res.headers.get('x-telegraph-receipt');
    if (!receiptHeader) {
      throw new Error('HTTP 200 response missing X-PAYMENT-RESPONSE / X-TELEGRAPH-RECEIPT header');
    }

    const receiptJson = JSON.parse(
      Buffer.from(receiptHeader.trim(), 'base64').toString('utf8'),
    ) as unknown;
    const receipt = telegraphReceiptSchema.parse(receiptJson);
    const parsed = telegraphAskResponseSchema.parse(await res.json());

    return { parsed, receipt };
  }

  private async executeX402ExactPurchase(
    request: TelegraphAskRequest,
    option: PaymentAcceptOption,
    account: PrivateKeyAccount,
  ): Promise<{ parsed: TelegraphAskResponse; receipt: TelegraphReceipt }> {
    if (option.network !== CAIP2_BASE_SEPOLIA && option.network !== CAIP2_ETHEREUM_SEPOLIA) {
      throw new Error(`Unsupported x402 exact network: ${option.network}`);
    }
    const allowedAssets = this.allowedTokensByNetwork[option.network] ?? [];
    const trustedPayTos = this.trustedPayToByNetwork[option.network] ?? [];
    const maxPerPayment = this.spendGuard.getSummary().maxPerRequestUusdc.toString();

    const fetchWithPayment = wrapFetchWithPaymentFromConfig(this.fetchFn, {
      schemes: [
        {
          network: option.network as `${string}:${string}`,
          client: new ExactEvmScheme(account),
        },
      ],
      spendControls: {
        allowedAssets: allowedAssets.map((asset) => ({
          network: option.network as `${string}:${string}`,
          asset,
          maxAmountPerPayment: maxPerPayment,
        })),
      },
      policies: [
        (_version, reqs) =>
          reqs.filter(
            (r) =>
              this.allowedNetworks.has(r.network) &&
              trustedPayTos.includes(r.payTo.toLowerCase()) &&
              allowedAssets.includes(r.asset.toLowerCase()),
          ),
      ],
    });

    const res = await fetchWithPayment(`${this.nodeUrl}/engine/v1/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (res.status === 402) {
      throw new Error('x402 exact purchase still returned HTTP 402 (payment rejected)');
    }
    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`x402 exact purchase failed (HTTP ${res.status}): ${errBody.slice(0, 300)}`);
    }

    const receiptHeader =
      res.headers.get('x-telegraph-receipt') ?? res.headers.get('x-payment-response');
    if (!receiptHeader) {
      throw new Error('HTTP 200 x402 response missing X-TELEGRAPH-RECEIPT header');
    }
    const receiptJson = JSON.parse(
      Buffer.from(receiptHeader.trim(), 'base64').toString('utf8'),
    ) as unknown;
    const receipt = telegraphReceiptSchema.parse(receiptJson);
    const parsed = telegraphAskResponseSchema.parse(await res.json());

    return { parsed, receipt };
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxPrePaymentRetries; attempt++) {
      try {
        const res = await this.fetchFn(url, {
          ...init,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if ((res.status === 429 || res.status === 503) && attempt < this.maxPrePaymentRetries) {
          await sleep(this.retryBaseDelayMs * 2 ** attempt);
          continue;
        }
        return res;
      } catch (err) {
        lastError = err;
        if (attempt < this.maxPrePaymentRetries) {
          await sleep(this.retryBaseDelayMs * 2 ** attempt);
          continue;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}
