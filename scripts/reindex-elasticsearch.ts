import { Client } from '@elastic/elasticsearch';
import { getConfig, prisma } from '../packages/shared/src/index.ts';

try { process.loadEnvFile?.('.env'); } catch (error) { void error; }
const env = getConfig();
const client = new Client({ node: env.ELASTICSEARCH_URL });
let cursor: string | undefined;
let indexed = 0;
for (;;) {
  const rows = await prisma.emailMessage.findMany({
    take: 500,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { id: 'asc' }
  });
  if (!rows.length) break;
  const operations = rows.flatMap((message) => [
    { index: { _index: env.ELASTICSEARCH_INDEX, _id: message.id, version: message.statusVersion, version_type: 'external_gte' } },
    {
      id: message.id, ownerId: message.ownerId, campaignId: message.campaignId, senderId: message.senderId,
      recipient: message.recipient, subject: message.subject, body: message.body, status: message.status,
      originalScheduledAt: message.originalScheduledAt, effectiveScheduledAt: message.effectiveScheduledAt,
      deferralReason: message.deferralReason, sentAt: message.sentAt, previewUrl: message.previewUrl,
      lastError: message.lastError, statusVersion: message.statusVersion, updatedAt: message.updatedAt
    }
  ]);
  const result = await client.bulk({ operations, refresh: false });
  if (result.errors) throw new Error('Elasticsearch bulk reindex reported item errors');
  indexed += rows.length;
  cursor = rows.at(-1)!.id;
  process.stdout.write(`Indexed ${indexed}\n`);
}
await client.indices.refresh({ index: env.ELASTICSEARCH_INDEX });
await Promise.all([client.close(), prisma.$disconnect()]);
