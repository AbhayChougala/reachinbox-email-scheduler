import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DelayedError, Queue } from 'bullmq';
import {
  admitSend, createRedis, decryptSecret, emailJobId, encryptSecret, EMAIL_QUEUE, getConfig, prisma
} from '../../packages/shared/src/index.ts';
import { scheduleCampaign, IdempotencyConflictError } from '../../apps/api/src/schedule.ts';
import { startOutboxDispatcher } from '../../apps/api/src/outbox.ts';
import { createEmailProcessor, createThresholdNotification } from '../../apps/worker/src/processors.ts';

const integration = describe.runIf(process.env.RUN_INTEGRATION === '1');

integration('persistent scheduling and concurrency', () => {
  const redis = createRedis(process.env.REDIS_URL!);
  const ids: string[] = [];
  let ownerId: string;
  let otherOwnerId: string;
  let senderId: string;

  beforeAll(async () => {
    await redis.flushdb();
    const owner = await prisma.user.create({ data: { email: `owner-${crypto.randomUUID()}@example.com`, name: 'Owner' } });
    const other = await prisma.user.create({ data: { email: `other-${crypto.randomUUID()}@example.com`, name: 'Other' } });
    ids.push(owner.id, other.id); ownerId = owner.id; otherOwnerId = other.id;
    const encrypted = encryptSecret('unused', getConfig().INTEGRATION_ENCRYPTION_KEY);
    const sender = await prisma.sender.create({ data: { ownerId, name: 'Test sender', email: `sender-${crypto.randomUUID()}@ethereal.email`, smtpHost: 'localhost', smtpPort: 1, smtpUsernameEnc: encrypted, smtpPasswordEnc: encrypted, minIntervalMs: 200, hourlyLimit: 2 } });
    senderId = sender.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await redis.quit();
  });

  it('deduplicates identical requests and rejects conflicting key reuse', async () => {
    const input = { senderId, subject: 'Idempotent', body: 'Body', recipients: ['a@example.com'], startAtUtc: new Date(Date.now() + 60_000).toISOString(), timezone: 'UTC', delaySeconds: 0, hourlyLimit: 2 };
    const first = await scheduleCampaign(ownerId, 'same-key', input);
    const replay = await scheduleCampaign(ownerId, 'same-key', input);
    expect(replay.replayed).toBe(true);
    expect(replay.campaign.id).toBe(first.campaign.id);
    await expect(scheduleCampaign(ownerId, 'same-key', { ...input, subject: 'Changed' })).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('denies cross-owner sender scheduling', async () => {
    await expect(scheduleCampaign(otherOwnerId, 'cross-owner', { senderId, subject: 'No', body: 'No', recipients: ['a@example.com'], startAtUtc: new Date().toISOString(), timezone: 'UTC', delaySeconds: 0, hourlyLimit: 1 })).rejects.toThrow(/not owned/);
  });

  it('atomically gives one racing worker the sender last slot across campaigns', async () => {
    await redis.flushdb();
    const common = { senderId: `race-${crypto.randomUUID()}`, senderHourlyLimit: 1, campaignHourlyLimit: 10, minIntervalMs: 0 };
    const [a, b] = await Promise.all([
      admitSend(redis, { ...common, campaignId: 'campaign-a' }),
      admitSend(redis, { ...common, campaignId: 'campaign-b' })
    ]);
    expect([a.allowed, b.allowed].sort()).toEqual([false, true]);
  });

  it('enforces minimum spacing and sender-wide quota across campaigns', async () => {
    await redis.flushdb();
    const testSender = `limit-${crypto.randomUUID()}`;
    const one = await admitSend(redis, { senderId: testSender, campaignId: 'a', senderHourlyLimit: 2, campaignHourlyLimit: 2, minIntervalMs: 500 });
    const spaced = await admitSend(redis, { senderId: testSender, campaignId: 'b', senderHourlyLimit: 2, campaignHourlyLimit: 2, minIntervalMs: 500 });
    expect(one.allowed).toBe(true); expect(spaced.reason).toBe('sender-minimum-spacing');
    await new Promise((resolve) => setTimeout(resolve, 550));
    const two = await admitSend(redis, { senderId: testSender, campaignId: 'b', senderHourlyLimit: 2, campaignHourlyLimit: 2, minIntervalMs: 500 });
    const capped = await admitSend(redis, { senderId: testSender, campaignId: 'c', senderHourlyLimit: 2, campaignHourlyLimit: 2, minIntervalMs: 0 });
    expect(two.senderThresholdReached).toBe(true); expect(capped.reason).toBe('sender-hourly-limit');
  });

  it('recovers stale outbox claims and preserves a delayed job across queue restart', async () => {
    const message = await prisma.emailMessage.findFirstOrThrow({ where: { ownerId } });
    await prisma.outboxEvent.updateMany({ where: { kind: 'EMAIL_ENQUEUE', aggregateId: message.id }, data: { status: 'PROCESSING', claimedAt: new Date(Date.now() - 120_000) } });
    const stop = startOutboxDispatcher(redis);
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await stop();
    const queueA = new Queue(EMAIL_QUEUE, { connection: redis });
    expect(await queueA.getJob(emailJobId(message.id))).toBeTruthy();
    await queueA.close();
    const queueB = new Queue(EMAIL_QUEUE, { connection: redis });
    expect(await queueB.getJob(emailJobId(message.id))).toBeTruthy();
    await queueB.close();
  });

  it('delays rate-limited work without creating an SMTP attempt', async () => {
    await redis.flushdb();
    const scheduled = await scheduleCampaign(ownerId, `delayed-${crypto.randomUUID()}`, { senderId, subject: 'Delay me', body: 'Body', recipients: ['delay@example.com'], startAtUtc: new Date().toISOString(), timezone: 'UTC', delaySeconds: 0, hourlyLimit: 1 });
    const message = await prisma.emailMessage.findFirstOrThrow({ where: { campaignId: scheduled.campaign.id } });
    await admitSend(redis, { senderId, campaignId: scheduled.campaign.id, senderHourlyLimit: 1, campaignHourlyLimit: 1, minIntervalMs: 0 });
    let moved = 0;
    const fakeJob = { data: { messageId: message.id }, moveToDelayed: async () => { moved += 1; } } as any;
    await expect(createEmailProcessor(redis)(fakeJob, 'token')).rejects.toBeInstanceOf(DelayedError);
    expect(moved).toBe(1);
    expect(await prisma.sendAttempt.count({ where: { messageId: message.id } })).toBe(0);
  });

  it('does not send a terminal already-sent message again', async () => {
    const campaign = await scheduleCampaign(ownerId, `sent-${crypto.randomUUID()}`, { senderId, subject: 'Done', body: 'Body', recipients: ['done@example.com'], startAtUtc: new Date().toISOString(), timezone: 'UTC', delaySeconds: 0, hourlyLimit: 2 });
    const message = await prisma.emailMessage.findFirstOrThrow({ where: { campaignId: campaign.campaign.id } });
    await prisma.emailMessage.update({ where: { id: message.id }, data: { status: 'SENT', sentAt: new Date() } });
    await createEmailProcessor(redis)({ data: { messageId: message.id } } as any, 'token');
    expect(await prisma.sendAttempt.count({ where: { messageId: message.id } })).toBe(0);
  });

  it('deduplicates one Slack threshold event and honors disconnect/reconnect state', async () => {
    const key = getConfig().INTEGRATION_ENCRYPTION_KEY;
    await prisma.slackIntegration.create({ data: { ownerId, teamId: 'T', teamName: 'Team', channelId: 'C', channelName: 'alerts', webhookUrlEnc: encryptSecret('https://hooks.slack.invalid/test', key), enabled: true } });
    const utcHour = new Date(); utcHour.setUTCMinutes(0, 0, 0);
    const input = { ownerId, senderId, senderName: 'Test', utcHour, cap: 2, nextEligibleAt: new Date(utcHour.getTime() + 3_600_000) };
    await Promise.all([createThresholdNotification(input), createThresholdNotification(input)]);
    expect(await prisma.slackNotification.count({ where: { ownerId, senderId, utcHour } })).toBe(1);
    await prisma.slackIntegration.update({ where: { ownerId }, data: { enabled: false } });
    await prisma.slackIntegration.update({ where: { ownerId }, data: { enabled: true, webhookUrlEnc: encryptSecret('https://hooks.slack.invalid/new', key) } });
    const reconnected = await prisma.slackIntegration.findUniqueOrThrow({ where: { ownerId } });
    expect(decryptSecret(reconnected.webhookUrlEnc, key)).toContain('/new');
  });
});
