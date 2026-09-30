import { Client } from '@elastic/elasticsearch';
import { getConfig } from '../packages/shared/src/index.ts';

try { process.loadEnvFile?.('.env'); } catch (error) { void error; }
const env = getConfig();
const client = new Client({ node: env.ELASTICSEARCH_URL });
if (!(await client.indices.exists({ index: env.ELASTICSEARCH_INDEX }))) {
  await client.indices.create({
    index: env.ELASTICSEARCH_INDEX,
    mappings: {
      dynamic: 'strict',
      properties: {
        id: { type: 'keyword' }, ownerId: { type: 'keyword' }, campaignId: { type: 'keyword' }, senderId: { type: 'keyword' },
        recipient: { type: 'text', fields: { keyword: { type: 'keyword' } } },
        subject: { type: 'text', fields: { keyword: { type: 'keyword' } } }, body: { type: 'text' },
        status: { type: 'keyword' }, originalScheduledAt: { type: 'date' }, effectiveScheduledAt: { type: 'date' },
        deferralReason: { type: 'keyword' }, sentAt: { type: 'date' }, previewUrl: { type: 'keyword', index: false },
        lastError: { type: 'text', index: false }, statusVersion: { type: 'integer' }, updatedAt: { type: 'date' }
      }
    }
  });
  process.stdout.write(`Created ${env.ELASTICSEARCH_INDEX}\n`);
} else process.stdout.write(`${env.ELASTICSEARCH_INDEX} already exists\n`);
await client.close();
