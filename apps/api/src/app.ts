import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { createBullBoard } from '@bull-board/api';
import { ExpressAdapter } from '@bull-board/express';
import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import connectPgSimple from 'connect-pg-simple';
import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import path from 'node:path';
import { Pool } from 'pg';
import { pinoHttp } from 'pino-http';
import { createQueues, getConfig, paginationSchema, prisma } from '@reachinbox/shared';
import type { Redis } from 'ioredis';
import { beginGoogle, finishGoogle, requireAdmin, requireUser } from './auth.js';
import { logger } from './logger.js';
import { IdempotencyConflictError, scheduleCampaign } from './schedule.js';
import { buildEmailSearch } from './search.js';
import { beginSlack, finishSlack } from './slack.js';

export function createApp(redis: Redis, elastic: ElasticsearchClient) {
  const env = getConfig();
  const app = express();
  if (env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
  app.use(pinoHttp({ logger }));
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  const PgSession = connectPgSimple(session);
  app.use(session({
    store: new PgSession({ pool: new Pool({ connectionString: env.DATABASE_URL }), createTableIfMissing: true }),
    name: 'reachinbox.sid',
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: new URL(env.PUBLIC_ORIGIN).protocol === 'https:', maxAge: 7 * 24 * 60 * 60_000 }
  }));

  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (_req, res) => {
    const status: Record<string, boolean> = { postgres: false, redis: false, elasticsearch: false };
    try { await prisma.$queryRaw`SELECT 1`; status.postgres = true; } catch (error) { void error; }
    try { status.redis = (await redis.ping()) === 'PONG'; } catch (error) { void error; }
    try { status.elasticsearch = Boolean((await elastic.cluster.health()).status); } catch (error) { void error; }
    res.status(Object.values(status).every(Boolean) ? 200 : 503).json(status);
  });

  app.get('/api/auth/google', (req, res, next) => void beginGoogle(req, res).catch(next));
  app.get('/api/auth/google/callback', (req, res, next) => void finishGoogle(req, res).catch(next));
  app.post('/api/auth/logout', requireUser, (req, res, next) => req.session.destroy((error) => error ? next(error) : res.status(204).end()));

  app.use('/api', (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) { next(); return; }
    const origin = req.get('origin');
    if (origin && origin !== env.WEB_ORIGIN && origin !== env.PUBLIC_ORIGIN) { res.status(403).json({ error: 'Origin not allowed' }); return; }
    next();
  });

  app.get('/api/me', requireUser, async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.session.userId }, select: { id: true, email: true, name: true, avatarUrl: true } });
    res.json({ ...user, isAdmin: env.adminEmails.has(user.email.toLowerCase()) });
  });
  app.get('/api/senders', requireUser, async (req, res) => {
    const senders = await prisma.sender.findMany({ where: { ownerId: req.session.userId, enabled: true }, select: { id: true, name: true, email: true, minIntervalMs: true, hourlyLimit: true }, orderBy: { createdAt: 'asc' } });
    res.json({ senders });
  });
  app.post('/api/campaigns/schedule', requireUser, async (req, res, next) => {
    const key = req.get('Idempotency-Key');
    if (!key || key.length > 100) { res.status(400).json({ error: 'A valid Idempotency-Key header is required' }); return; }
    try {
      const result = await scheduleCampaign(req.session.userId!, key, req.body);
      res.status(result.replayed ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof IdempotencyConflictError) { res.status(409).json({ error: error.message }); return; }
      next(error);
    }
  });
  app.get('/api/emails', requireUser, async (req, res, next) => {
    try {
      const input = paginationSchema.parse(req.query);
      const result = await elastic.search({
        index: env.ELASTICSEARCH_INDEX,
        ...buildEmailSearch({ ownerId: req.session.userId!, ...input })
      });
      const total = typeof result.hits.total === 'number' ? result.hits.total : (result.hits.total?.value ?? 0);
      res.json({ items: result.hits.hits.map((hit) => hit._source), total, page: input.page, pageSize: input.pageSize });
    } catch (error) {
      if ((error as any)?.meta) { res.status(503).json({ error: 'Elasticsearch search is temporarily unavailable' }); return; }
      next(error);
    }
  });

  app.get('/api/integrations/slack', requireUser, async (req, res) => {
    const integration = await prisma.slackIntegration.findUnique({ where: { ownerId: req.session.userId }, select: { enabled: true, teamName: true, channelName: true } });
    res.json({ integration });
  });
  app.get('/api/integrations/slack/connect', requireUser, (req, res, next) => void beginSlack(req, res).catch(next));
  app.get('/api/integrations/slack/callback', (req, res, next) => void finishSlack(req, res).catch(next));
  app.delete('/api/integrations/slack', requireUser, async (req, res) => {
    await prisma.slackIntegration.updateMany({ where: { ownerId: req.session.userId }, data: { enabled: false } });
    res.status(204).end();
  });

  const board = new ExpressAdapter();
  board.setBasePath('/admin/queues');
  const queues = createQueues(redis);
  createBullBoard({ queues: [new BullMQAdapter(queues.emailQueue), new BullMQAdapter(queues.indexQueue), new BullMQAdapter(queues.slackQueue)], serverAdapter: board });
  app.use('/admin/queues', requireAdmin, board.getRouter());

  if (env.NODE_ENV === 'production') {
    const webRoot = path.resolve(process.cwd(), 'apps/web/dist');
    app.use(express.static(webRoot, { index: false, maxAge: '1h' }));
    app.get('/{*splat}', (_req, res) => res.sendFile(path.join(webRoot, 'index.html')));
  }

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    logger.error({ err: error instanceof Error ? error.message : String(error) }, 'request failed');
    const message = error instanceof Error ? error.message : 'Unexpected error';
    const validation = error && typeof error === 'object' && 'issues' in error;
    res.status(validation ? 400 : 500).json({ error: validation ? message : 'Request failed' });
  };
  app.use(errorHandler);
  return app;
}
