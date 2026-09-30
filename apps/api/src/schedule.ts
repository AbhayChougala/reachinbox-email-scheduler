import { Prisma } from '@prisma/client';
import { fingerprint, getConfig, normalizeAndValidateRecipients, prisma, scheduleSchema, type ScheduleInput } from '@reachinbox/shared';

export class IdempotencyConflictError extends Error {}

export async function scheduleCampaign(ownerId: string, idempotencyKey: string, rawInput: unknown) {
  const input = scheduleSchema.parse(rawInput);
  const normalized = normalizeAndValidateRecipients(input.recipients);
  if (normalized.invalid > 0) throw new Error('All recipients must be valid email addresses');
  if (normalized.recipients.length > getConfig().MAX_CAMPAIGN_RECIPIENTS) throw new Error('Recipient limit exceeded');
  const canonical: ScheduleInput = { ...input, recipients: normalized.recipients };
  const payloadFingerprint = fingerprint(canonical);

  const existing = await prisma.scheduleRequest.findUnique({
    where: { ownerId_idempotencyKey: { ownerId, idempotencyKey } },
    include: { campaign: true }
  });
  if (existing) {
    if (existing.payloadFingerprint !== payloadFingerprint) throw new IdempotencyConflictError('Idempotency key was already used with different content');
    return { campaign: existing.campaign, replayed: true };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const sender = await tx.sender.findFirst({ where: { id: canonical.senderId, ownerId, enabled: true } });
      if (!sender) throw new Error('Sender not found or not owned by this user');
      const start = new Date(canonical.startAtUtc);
      const campaign = await tx.campaign.create({
        data: {
          ownerId,
          senderId: sender.id,
          subject: canonical.subject,
          body: canonical.body,
          startAt: start,
          timezone: canonical.timezone,
          delayMs: canonical.delaySeconds * 1000,
          hourlyLimit: Math.min(canonical.hourlyLimit, sender.hourlyLimit),
          recipientCount: canonical.recipients.length
        }
      });
      for (let offset = 0; offset < canonical.recipients.length; offset += 250) {
        const batch = canonical.recipients.slice(offset, offset + 250);
        for (const [batchIndex, recipient] of batch.entries()) {
          const order = offset + batchIndex;
          const scheduledAt = new Date(start.getTime() + order * canonical.delaySeconds * 1000);
          const message = await tx.emailMessage.create({
            data: {
              ownerId,
              campaignId: campaign.id,
              senderId: sender.id,
              recipient,
              recipientOrder: order,
              subject: canonical.subject,
              body: canonical.body,
              originalScheduledAt: scheduledAt,
              effectiveScheduledAt: scheduledAt
            }
          });
          await tx.outboxEvent.createMany({ data: [
            { kind: 'EMAIL_ENQUEUE', aggregateId: message.id, payload: { messageId: message.id, scheduledAt: scheduledAt.toISOString() } },
            { kind: 'EMAIL_INDEX', aggregateId: `${message.id}-1`, payload: { messageId: message.id, version: 1 } }
          ] });
        }
      }
      await tx.scheduleRequest.create({
        data: { ownerId, idempotencyKey, payloadFingerprint, campaignId: campaign.id }
      });
      return { campaign, replayed: false };
    }, { timeout: 30_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await prisma.scheduleRequest.findUnique({
        where: { ownerId_idempotencyKey: { ownerId, idempotencyKey } }, include: { campaign: true }
      });
      if (raced?.payloadFingerprint === payloadFingerprint) return { campaign: raced.campaign, replayed: true };
      if (raced) throw new IdempotencyConflictError('Idempotency key was already used with different content');
    }
    throw error;
  }
}
