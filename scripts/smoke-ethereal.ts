import { Worker } from 'bullmq';
import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import { createRedis, EMAIL_QUEUE, getConfig, INDEX_QUEUE, prisma } from '../packages/shared/src/index.ts';
import { scheduleCampaign } from '../apps/api/src/schedule.ts';
import { startOutboxDispatcher } from '../apps/api/src/outbox.ts';
import { createEmailProcessor, createIndexProcessor } from '../apps/worker/src/processors.ts';

process.loadEnvFile?.('.env');
const env = getConfig();
const ownerEmail = process.env.PROVISION_OWNER_EMAIL?.trim().toLowerCase();
if (!ownerEmail) throw new Error('PROVISION_OWNER_EMAIL is required');
const owner = await prisma.user.findUnique({ where: { email: ownerEmail } });
if (!owner) throw new Error('Provision an owner and Ethereal senders first with npm run db:seed:senders');
const sender = await prisma.sender.findFirst({ where: { ownerId: owner.id, enabled: true }, orderBy: { createdAt: 'asc' } });
if (!sender) throw new Error('No enabled sender exists; run npm run db:seed:senders');

const redis = createRedis(env.REDIS_URL);
const elastic = new ElasticsearchClient({ node: env.ELASTICSEARCH_URL });
const stopDispatcher = startOutboxDispatcher(redis);
const worker = new Worker(EMAIL_QUEUE, createEmailProcessor(redis), { connection: redis, concurrency: 1 });
const indexWorker = new Worker(INDEX_QUEUE, createIndexProcessor(elastic, env.ELASTICSEARCH_INDEX), { connection: redis, concurrency: 1 });
const result = await scheduleCampaign(owner.id, `smoke-${crypto.randomUUID()}`, {
  senderId: sender.id,
  subject: `ReachInbox smoke ${new Date().toISOString()}`,
  body: 'This message verifies PostgreSQL outbox, BullMQ delay, Redis admission and real Ethereal SMTP acceptance.',
  recipients: ['safe-demo@example.com'],
  startAtUtc: new Date(Date.now() + 500).toISOString(),
  timezone: 'UTC',
  delaySeconds: 0,
  hourlyLimit: sender.hourlyLimit
});
const message = await prisma.emailMessage.findFirstOrThrow({ where: { campaignId: result.campaign.id } });
let final = message;
for (let attempt = 0; attempt < 40; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  final = await prisma.emailMessage.findUniqueOrThrow({ where: { id: message.id } });
  if (['SENT', 'FAILED', 'AMBIGUOUS'].includes(final.status)) break;
}
let indexedStatus: string | undefined;
for (let attempt = 0; attempt < 20 && final.status === 'SENT'; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    const indexed = await elastic.get<Record<string, unknown>>({ index: env.ELASTICSEARCH_INDEX, id: final.id });
    indexedStatus = String(indexed._source?.status ?? '');
    if (indexedStatus === 'SENT') break;
  } catch (error) { void error; }
}
await Promise.all([worker.close(), indexWorker.close(), stopDispatcher()]);
await redis.quit();
await elastic.close();
await prisma.$disconnect();
if (final.status !== 'SENT' || !final.previewUrl) throw new Error(`Ethereal smoke ended as ${final.status}: ${final.lastError ?? 'no error recorded'}`);
if (indexedStatus !== 'SENT') throw new Error(`Elasticsearch did not reach SENT; last status was ${indexedStatus ?? 'missing'}`);
process.stdout.write(`Ethereal accepted ${final.id}\nPreview: ${final.previewUrl}\n`);
process.stdout.write('Elasticsearch indexed status: SENT\n');
