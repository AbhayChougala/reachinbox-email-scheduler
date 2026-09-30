/* global AbortSignal, fetch */
import process from 'node:process';
import { URL } from 'node:url';
import pg from 'pg';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
const postgres = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await Promise.all([redis.connect(), postgres.connect()]);
  const [redisReply, , elasticsearch] = await Promise.all([
    redis.ping(),
    postgres.query('SELECT 1'),
    fetch(new URL('/_cluster/health', process.env.ELASTICSEARCH_URL), { signal: AbortSignal.timeout(3000) })
  ]);
  if (redisReply !== 'PONG' || !elasticsearch.ok) process.exitCode = 1;
} catch {
  process.exitCode = 1;
} finally {
  redis.disconnect();
  await postgres.end().catch(() => undefined);
}
