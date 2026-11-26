import crypto from 'node:crypto';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { conditionalTxConditionSchema } from '@revert/shared';
import type { TelegraphClient } from '@revert/telegraph-client';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { VerificationEngine } from './engine.js';

export interface AppConfig {
  engine: VerificationEngine;
  telegraphClient: TelegraphClient;
  chainId: number;
  escrowContractAddress: `0x${string}`;
  corsOrigin?: string;
  apiAuthToken?: string | undefined;
  rateLimitMax?: number;
}

const escrowIdParamsSchema = z.object({
  id: z.string().regex(/^\d+$/, 'Escrow ID must be a positive integer'),
});

const verifyBodySchema = z
  .object({
    dryRun: z.boolean().optional(),
    force: z.boolean().optional(),
  })
  .optional();

function timingSafeMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function extractAuthToken(req: FastifyRequest): string | undefined {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 0) return apiKey;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim();
  }
  return undefined;
}

export async function createApp(config: AppConfig): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 64 * 1024,
  });

  await app.register(cors, {
    origin: config.corsOrigin ?? 'http://localhost:5173',
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    max: config.rateLimitMax ?? 60,
    timeWindow: '1 minute',
  });

  const requireAuthIfConfigured = async (req: FastifyRequest): Promise<void> => {
    if (!config.apiAuthToken) return;
    const provided = extractAuthToken(req);
    if (!provided || !timingSafeMatch(provided, config.apiAuthToken)) {
      const err = new Error('Unauthorized') as Error & { statusCode?: number };
      err.statusCode = 401;
      throw err;
    }
  };

  app.get('/health', async () => {
    const flags = config.engine.getFlags();
    return {
      status: 'ok',
      chainId: config.chainId,
      escrowContractAddress: config.escrowContractAddress,
      attestorAddress: config.engine.getAttestorAddress(),
      allowLiveSpend: flags.allowLiveSpend,
      enableServerBroadcaster: flags.enableServerBroadcaster,
      authProtectedMutatingRoutes: Boolean(config.apiAuthToken),
    };
  });

  app.get('/api/budget', async () => {
    const s = config.telegraphClient.getBudgetSummary();
    return {
      maxPerRequestUusdc: s.maxPerRequestUusdc.toString(),
      maxTotalBudgetUusdc: s.maxTotalBudgetUusdc.toString(),
      reservedUusdc: s.reservedUusdc.toString(),
      committedUusdc: s.committedUusdc.toString(),
      remainingUusdc: s.remainingUusdc.toString(),
    };
  });

  app.get('/api/escrows', async () => {
    const escrows = await config.engine.listEscrowViews();
    return { escrows };
  });

  app.get('/api/escrows/:id', async (req, reply) => {
    const params = escrowIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid escrow ID' });
    }
    const view = await config.engine.getEscrowView(params.data.id);
    if (!view) {
      return reply.status(404).send({ error: 'Escrow not found' });
    }
    return view;
  });

  app.post('/api/escrows/:id/condition', async (req, reply) => {
    await requireAuthIfConfigured(req);
    const params = escrowIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid escrow ID' });
    }
    const bodyCheck = conditionalTxConditionSchema.safeParse(req.body);
    if (!bodyCheck.success) {
      return reply.status(400).send({
        error: 'Invalid condition payload',
        issues: bodyCheck.error.issues,
      });
    }
    try {
      const registered = await config.engine.registerCondition(params.data.id, bodyCheck.data);
      return reply.status(200).send(registered);
    } catch (err) {
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : 'Condition registration failed' });
    }
  });

  app.post(
    '/api/escrows/:id/verify',
    {
      config: {
        rateLimit: { max: 15, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      await requireAuthIfConfigured(req);
      const params = escrowIdParamsSchema.safeParse(req.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid escrow ID' });
      }
      const bodyParsed = verifyBodySchema.safeParse(req.body);
      if (!bodyParsed.success) {
        return reply.status(400).send({ error: 'Invalid verify options' });
      }
      try {
        const result = await config.engine.verifyEscrow(params.data.id, {
          ...(bodyParsed.data?.dryRun !== undefined ? { dryRun: bodyParsed.data.dryRun } : {}),
          ...(bodyParsed.data?.force !== undefined ? { force: bodyParsed.data.force } : {}),
        });
        return reply.status(200).send(result);
      } catch (err) {
        return reply
          .status(400)
          .send({ error: err instanceof Error ? err.message : 'Verification failed' });
      }
    },
  );

  app.post('/api/escrows/:id/broadcast-settlement', async (req, reply) => {
    await requireAuthIfConfigured(req);
    const params = escrowIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid escrow ID' });
    }
    try {
      const updated = await config.engine.broadcastVerifiedSettlement(params.data.id);
      return reply.status(200).send(updated);
    } catch (err) {
      return reply
        .status(400)
        .send({ error: err instanceof Error ? err.message : 'Broadcast failed' });
    }
  });

  app.get('/api/evidence/:id', async (req, reply) => {
    const params = escrowIdParamsSchema.safeParse(req.params);
    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid escrow ID' });
    }
    const view = await config.engine.getEscrowView(params.data.id);
    if (!view || !view.verification?.latestEvidence) {
      return reply.status(404).send({ error: 'Evidence not found for escrow' });
    }
    return {
      escrowId: params.data.id,
      status: view.verification.status,
      conditionHash: view.onchain.conditionHash,
      evidence: view.verification.latestEvidence,
      attestation: view.verification.attestation ?? null,
    };
  });

  return app;
}
