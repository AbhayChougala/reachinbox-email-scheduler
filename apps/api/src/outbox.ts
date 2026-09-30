import { Prisma } from '@prisma/client';
import { createQueues, emailJobId, getConfig, indexJobId, prisma, slackJobId } from '@reachinbox/shared';
import type { Redis } from 'ioredis';
import { logger } from './logger.js';

type ClaimedEvent = { id: string; kind: 'EMAIL_ENQUEUE' | 'EMAIL_INDEX' | 'SLACK_NOTIFY'; aggregateId: string; payload: Prisma.JsonValue };

export function startOutboxDispatcher(redis: Redis) {
  const env = getConfig();
  const queues = createQueues(redis);
  let stopping = false;
  let running = false;

  const dispatch = async () => {
    if (running || stopping) return;
    running = true;
    try {
      await prisma.outboxEvent.updateMany({
        where: { status: 'PROCESSING', claimedAt: { lt: new Date(Date.now() - 60_000) } },
        data: { status: 'PENDING', claimedAt: null }
      });
      const events = await prisma.$transaction(async (tx) => {
        const ids = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "OutboxEvent"
          WHERE status = 'PENDING' AND "availableAt" <= NOW()
          ORDER BY "createdAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${env.OUTBOX_BATCH_SIZE}
        `;
        if (ids.length === 0) return [];
        const selected = ids.map(({ id }) => id);
        await tx.outboxEvent.updateMany({ where: { id: { in: selected } }, data: { status: 'PROCESSING', claimedAt: new Date(), attempts: { increment: 1 } } });
        return tx.outboxEvent.findMany({ where: { id: { in: selected } } }) as Promise<ClaimedEvent[]>;
      });
      for (const event of events) {
        try {
          const payload = event.payload as Record<string, string | number>;
          if (event.kind === 'EMAIL_ENQUEUE') {
            const messageId = String(payload.messageId);
            const scheduledAt = new Date(String(payload.scheduledAt));
            await queues.emailQueue.add('send', { messageId }, {
              jobId: emailJobId(messageId),
              delay: Math.max(0, scheduledAt.getTime() - Date.now()),
              attempts: env.SMTP_MAX_ATTEMPTS,
              backoff: { type: 'exponential', delay: 5_000 },
              removeOnComplete: 1000,
              removeOnFail: 5000
            });
            const changed = await prisma.emailMessage.updateMany({ where: { id: messageId, status: 'SCHEDULED' }, data: { status: 'QUEUED', statusVersion: { increment: 1 } } });
            if (changed.count === 1) {
              const current = await prisma.emailMessage.findUniqueOrThrow({ where: { id: messageId }, select: { statusVersion: true } });
              await prisma.outboxEvent.createMany({
                data: [{ kind: 'EMAIL_INDEX', aggregateId: `${messageId}-${current.statusVersion}`, payload: { messageId, version: current.statusVersion } }],
                skipDuplicates: true
              });
            }
          } else if (event.kind === 'EMAIL_INDEX') {
            const messageId = String(payload.messageId);
            const version = Number(payload.version);
            await queues.indexQueue.add('index', { messageId }, { jobId: indexJobId(messageId, version), attempts: 8, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: 1000 });
          } else {
            const notificationId = String(payload.notificationId);
            await queues.slackQueue.add('notify', { notificationId }, { jobId: slackJobId(notificationId), attempts: 6, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 1000 });
          }
          await prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), lastError: null } });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await prisma.outboxEvent.update({ where: { id: event.id }, data: { status: 'PENDING', claimedAt: null, availableAt: new Date(Date.now() + 5_000), lastError: message.slice(0, 1000) } });
          logger.warn({ eventId: event.id, err: message }, 'outbox publish failed');
        }
      }
    } finally { running = false; }
  };
  void dispatch();
  const timer = setInterval(() => void dispatch(), env.OUTBOX_POLL_MS);
  timer.unref();
  return async () => {
    stopping = true;
    clearInterval(timer);
    while (running) await new Promise((resolve) => setTimeout(resolve, 25));
    await Promise.all(Object.values(queues).map((queue) => queue.close()));
  };
}
