import { describe, expect, it } from 'vitest';
import {
  computeConditionHash,
  TELEGRAPH_INTENT_NAME,
  type ConditionalTxCondition,
} from '@revert/shared';
import { TelegraphClient } from '@revert/telegraph-client';
import {
  createApp,
  Eip712SettlementAttestor,
  VerificationEngine,
  VerificationStateStore,
  type EscrowChainGateway,
} from '../src/index.js';

const ATTESTOR_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const ESCROW_CONTRACT = '0x0000000000000000000000000000000000001234' as const;

const condition: ConditionalTxCondition = {
  version: 1,
  intent: TELEGRAPH_INTENT_NAME,
  chain: 'ethereum',
  txHash: '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060',
  expectedTo: '0xa1e4380a3b1f749673e270229993ee55f45663b4',
  minValueEth: 0,
};

describe('[MOCKED] Fastify API validation, auth, rate limiting, and endpoints', () => {
  it('serves health, budget, condition registration, dry-run verify, and evidence routes with auth', async () => {
    const attestor = new Eip712SettlementAttestor(ATTESTOR_PK, 11155111, ESCROW_CONTRACT);
    const now = 1_800_000_000;

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith(`/engine/v1/intents/${TELEGRAPH_INTENT_NAME}`)) {
        return new Response(
          JSON.stringify({
            intent_name: TELEGRAPH_INTENT_NAME,
            miner_count: 32,
            request: { params: [{ name: 'tx_hash', type: 'string' }] },
            response: { fields: [{ name: 'status', type: 'enum' }] },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith(`/engine/v1/intents/${TELEGRAPH_INTENT_NAME}/miners`)) {
        return new Response(JSON.stringify({ miners: [{ id: '9002' }] }), { status: 200 });
      }
      if (url.endsWith('/engine/v1/ask')) {
        const challenge = {
          x402Version: 2,
          accepts: [
            {
              scheme: 'escrow',
              network: 'eip155:11155111',
              amount: '50000',
              payTo: '0x72a70e949362670bf8bcead24efc5b8f950aa08b',
            },
          ],
        };
        return new Response(JSON.stringify({ error: 'payment required' }), {
          status: 402,
          headers: {
            'payment-required': Buffer.from(JSON.stringify(challenge)).toString('base64'),
          },
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const telegraphClient = new TelegraphClient({ fetchImpl: mockFetch });
    const gateway: EscrowChainGateway = {
      listEscrows: async () => [
        {
          escrowId: '1',
          mode: 'Conditional',
          state: 'LOCKED',
          sender: '0x1111111111111111111111111111111111111111',
          recipient: '0x2222222222222222222222222222222222222222',
          token: '0xcc194e1a843b658526d0d5c431f670028582ae17',
          amount: '5000000',
          createdAt: now - 60,
          recoveryWindowEnd: 0,
          deadline: now + 3600,
          conditionHash: computeConditionHash(condition),
          attestor: attestor.getAddress(),
        },
      ],
      getEscrow: async (id) => (id === '1' ? (await gateway.listEscrows())[0] : undefined),
      isTokenAllowed: async () => true,
      broadcastSettlement: async () => '0x0',
    };

    const engine = new VerificationEngine({
      chainGateway: gateway,
      telegraphClient,
      rpcVerifier: { verifyTransaction: async () => ({ checked: false }) },
      attestor,
      stateStore: new VerificationStateStore(),
      allowLiveSpend: false,
      nowUnix: () => now,
    });

    const app = await createApp({
      engine,
      telegraphClient,
      chainId: 11155111,
      escrowContractAddress: ESCROW_CONTRACT,
      apiAuthToken: 'secret-test-token',
    });

    const healthRes = await app.inject({ method: 'GET', url: '/health' });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json().authProtectedMutatingRoutes).toBe(true);

    const budgetRes = await app.inject({ method: 'GET', url: '/api/budget' });
    expect(budgetRes.statusCode).toBe(200);
    expect(budgetRes.json().remainingUusdc).toBe('2000000');

    // Mutating route rejects unauthenticated calls
    const unauthPost = await app.inject({
      method: 'POST',
      url: '/api/escrows/1/condition',
      payload: condition,
    });
    expect(unauthPost.statusCode).toBe(401);

    // Authenticated condition registration succeeds
    const authPost = await app.inject({
      method: 'POST',
      url: '/api/escrows/1/condition',
      headers: { authorization: 'Bearer secret-test-token' },
      payload: condition,
    });
    expect(authPost.statusCode).toBe(200);

    // Dry-run verify succeeds and creates evidence view
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/api/escrows/1/verify',
      headers: { 'x-api-key': 'secret-test-token' },
      payload: { dryRun: true },
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().status).toBe('DRY_RUN_READY');

    const evidenceRes = await app.inject({ method: 'GET', url: '/api/evidence/1' });
    expect(evidenceRes.statusCode).toBe(200);
    expect(evidenceRes.json().evidence.maxAuthorizedUusdc).toBe('50000');

    const badIdRes = await app.inject({ method: 'GET', url: '/api/escrows/not-a-number' });
    expect(badIdRes.statusCode).toBe(400);

    await app.close();
  });
});
