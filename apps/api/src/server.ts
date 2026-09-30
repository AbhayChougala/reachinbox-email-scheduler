import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import { createRedis, getConfig, prisma } from '@reachinbox/shared';
import { createApp } from './app.js';
import { logger } from './logger.js';
import { startOutboxDispatcher } from './outbox.js';

try { process.loadEnvFile?.(process.env.ENV_FILE ?? '../../.env'); } catch (error) { void error; }
const env = getConfig();
const redis = createRedis(env.REDIS_URL);
const elastic = new ElasticsearchClient({ node: env.ELASTICSEARCH_URL });
const app = createApp(redis, elastic);
const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'api listening'));
const stopDispatcher = startOutboxDispatcher(redis);

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  server.close();
  await stopDispatcher();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
