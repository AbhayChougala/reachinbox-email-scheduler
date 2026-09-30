import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import { Worker } from 'bullmq';
import { createRedis, EMAIL_QUEUE, getConfig, INDEX_QUEUE, prisma, SLACK_QUEUE } from '@reachinbox/shared';
import { logger } from './logger.js';
import { createEmailProcessor, createIndexProcessor, createSlackProcessor } from './processors.js';

try { process.loadEnvFile?.(process.env.ENV_FILE ?? '../../.env'); } catch (error) { void error; }
const env = getConfig();
const redis = createRedis(env.REDIS_URL);
const elastic = new ElasticsearchClient({ node: env.ELASTICSEARCH_URL });

async function recoverAmbiguous() {
  const stale = await prisma.emailMessage.findMany({
    where: { status: 'SENDING', sendingStartedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
    select: { id: true }
  });
  for (const message of stale) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.emailMessage.update({ where: { id: message.id }, data: { status: 'AMBIGUOUS', sendingStartedAt: null, lastError: 'Worker stopped during SMTP attempt; delivery outcome requires review', statusVersion: { increment: 1 } } });
      await tx.outboxEvent.create({ data: { kind: 'EMAIL_INDEX', aggregateId: `${message.id}-${updated.statusVersion}`, payload: { messageId: message.id, version: updated.statusVersion } } });
    });
  }
  if (stale.length) logger.warn({ count: stale.length }, 'marked stale SMTP claims ambiguous');
}

await recoverAmbiguous();
const emailWorker = new Worker(EMAIL_QUEUE, createEmailProcessor(redis), { connection: redis, concurrency: env.WORKER_CONCURRENCY });
const indexWorker = new Worker(INDEX_QUEUE, createIndexProcessor(elastic, env.ELASTICSEARCH_INDEX), { connection: redis, concurrency: Math.min(5, env.WORKER_CONCURRENCY) });
const slackWorker = new Worker(SLACK_QUEUE, createSlackProcessor(), { connection: redis, concurrency: 3 });

for (const worker of [emailWorker, indexWorker, slackWorker]) {
  worker.on('failed', (job, error) => logger.warn({ queue: worker.name, jobId: job?.id, err: error.message }, 'job failed'));
  worker.on('error', (error) => logger.error({ queue: worker.name, err: error.message }, 'worker error'));
}
logger.info({ concurrency: env.WORKER_CONCURRENCY }, 'workers started');

async function shutdown(signal: string) {
  logger.info({ signal }, 'worker shutting down');
  await Promise.all([emailWorker.close(), indexWorker.close(), slackWorker.close()]);
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
