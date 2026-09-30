import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import { Prisma } from '@prisma/client';
import { DelayedError, type Job } from 'bullmq';
import nodemailer from 'nodemailer';
import {
  admitSend,
  decryptSecret,
  deterministicMessageId,
  getConfig,
  prisma,
  type EmailJob,
  type IndexJob,
  type SlackJob
} from '@reachinbox/shared';
import type { Redis } from 'ioredis';
import { logger } from './logger.js';

const terminal = new Set(['SENT', 'FAILED', 'AMBIGUOUS', 'CANCELLED']);

async function indexOutbox(tx: Prisma.TransactionClient, messageId: string, version: number) {
  await tx.outboxEvent.create({
    data: { kind: 'EMAIL_INDEX', aggregateId: `${messageId}-${version}`, payload: { messageId, version } }
  });
}

export async function createThresholdNotification(input: {
  ownerId: string; senderId: string; senderName: string; utcHour: Date; cap: number; nextEligibleAt: Date;
}) {
  try {
    await prisma.$transaction(async (tx) => {
      const integration = await tx.slackIntegration.findUnique({ where: { ownerId: input.ownerId }, select: { enabled: true } });
      const notification = await tx.slackNotification.create({
        data: {
          ownerId: input.ownerId,
          senderId: input.senderId,
          utcHour: input.utcHour,
          cap: input.cap,
          nextEligibleAt: input.nextEligibleAt,
          status: integration?.enabled ? 'PENDING' : 'SKIPPED'
        }
      });
      if (integration?.enabled) {
        await tx.outboxEvent.create({ data: { kind: 'SLACK_NOTIFY', aggregateId: notification.id, payload: { notificationId: notification.id, senderName: input.senderName } } });
      }
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
  }
}

export function classifySmtpError(error: any): 'retryable' | 'permanent' | 'ambiguous' {
  const response = Number(error?.responseCode ?? 0);
  if (response >= 500) return 'permanent';
  if ([421, 450, 451, 452].includes(response)) return 'retryable';
  if (['EDNS', 'ECONNREFUSED', 'ENETUNREACH', 'EAI_AGAIN'].includes(String(error?.code))) return 'retryable';
  return 'ambiguous';
}

export function createEmailProcessor(redis: Redis) {
  return async (job: Job<EmailJob>, token?: string) => {
    const message = await prisma.emailMessage.findUnique({
      where: { id: job.data.messageId },
      include: { sender: true, campaign: true }
    });
    if (!message || terminal.has(message.status)) return;

    const admission = await admitSend(redis, {
      senderId: message.senderId,
      campaignId: message.campaignId,
      senderHourlyLimit: message.sender.hourlyLimit,
      campaignHourlyLimit: Math.min(message.campaign.hourlyLimit, message.sender.hourlyLimit),
      minIntervalMs: Math.max(message.sender.minIntervalMs, message.campaign.delayMs)
    });

    if (!admission.allowed) {
      const next = new Date(Math.max(admission.nextEligibleAt, Date.now() + 100));
      await prisma.$transaction(async (tx) => {
        const updated = await tx.emailMessage.update({
          where: { id: message.id },
          data: { status: 'QUEUED', effectiveScheduledAt: next, deferralReason: admission.reason, statusVersion: { increment: 1 } }
        });
        await indexOutbox(tx, message.id, updated.statusVersion);
      });
      if (!token) throw new Error('BullMQ worker token unavailable for delayed move');
      await job.moveToDelayed(next.getTime(), token);
      throw new DelayedError();
    }

    if (admission.senderThresholdReached) {
      await createThresholdNotification({
        ownerId: message.ownerId,
        senderId: message.senderId,
        senderName: `${message.sender.name} <${message.sender.email}>`,
        utcHour: admission.utcHour,
        cap: message.sender.hourlyLimit,
        nextEligibleAt: new Date(admission.utcHour.getTime() + 3_600_000)
      });
    }

    const claimed = await prisma.emailMessage.updateMany({
      where: { id: message.id, status: { in: ['SCHEDULED', 'QUEUED'] }, sendingStartedAt: null },
      data: { status: 'SENDING', sendingStartedAt: new Date(), deferralReason: null, statusVersion: { increment: 1 } }
    });
    if (claimed.count !== 1) return;
    const attemptNumber = await prisma.sendAttempt.count({ where: { messageId: message.id } }).then((count) => count + 1);
    const attempt = await prisma.sendAttempt.create({ data: { messageId: message.id, attemptNumber, outcome: 'STARTED' } });
    const env = getConfig();
    const transport = nodemailer.createTransport({
      host: message.sender.smtpHost,
      port: message.sender.smtpPort,
      secure: message.sender.smtpSecure,
      auth: {
        user: decryptSecret(message.sender.smtpUsernameEnc, env.INTEGRATION_ENCRYPTION_KEY),
        pass: decryptSecret(message.sender.smtpPasswordEnc, env.INTEGRATION_ENCRYPTION_KEY)
      },
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000
    });

    let accepted = false;
    try {
      const info = await transport.sendMail({
        from: { name: message.sender.name, address: message.sender.email },
        to: message.recipient,
        subject: message.subject,
        text: message.body,
        messageId: deterministicMessageId(message.id, message.sender.email)
      });
      accepted = true;
      const previewUrl = nodemailer.getTestMessageUrl(info) || null;
      await prisma.$transaction(async (tx) => {
        const updated = await tx.emailMessage.update({
          where: { id: message.id },
          data: {
            status: 'SENT', sentAt: new Date(), sendingStartedAt: null,
            smtpMessageId: info.messageId, previewUrl: previewUrl || null,
            lastError: null, statusVersion: { increment: 1 }
          }
        });
        await tx.sendAttempt.update({ where: { id: attempt.id }, data: { outcome: 'SENT', smtpResponse: String(info.response ?? ''), finishedAt: new Date() } });
        await indexOutbox(tx, message.id, updated.statusVersion);
      });
      logger.info({ messageId: message.id, recipient: message.recipient }, 'email sent');
    } catch (error: any) {
      const classification = accepted ? 'ambiguous' : classifySmtpError(error);
      const errorMessage = String(error?.message ?? error).slice(0, 1000);
      const attemptsExhausted = job.attemptsMade + 1 >= Number(job.opts.attempts ?? env.SMTP_MAX_ATTEMPTS);
      if (classification === 'retryable' && !attemptsExhausted) {
        await prisma.$transaction(async (tx) => {
          const updated = await tx.emailMessage.update({ where: { id: message.id }, data: { status: 'QUEUED', sendingStartedAt: null, lastError: errorMessage, statusVersion: { increment: 1 } } });
          await tx.sendAttempt.update({ where: { id: attempt.id }, data: { outcome: 'RETRYABLE_FAILURE', errorCode: String(error?.code ?? ''), errorMessage, finishedAt: new Date() } });
          await indexOutbox(tx, message.id, updated.statusVersion);
        });
        throw error;
      }
      const status = classification === 'permanent' || attemptsExhausted ? 'FAILED' : 'AMBIGUOUS';
      await prisma.$transaction(async (tx) => {
        const updated = await tx.emailMessage.update({ where: { id: message.id }, data: { status, sendingStartedAt: null, lastError: errorMessage, statusVersion: { increment: 1 } } });
        await tx.sendAttempt.update({ where: { id: attempt.id }, data: { outcome: status === 'FAILED' ? 'PERMANENT_FAILURE' : 'AMBIGUOUS', errorCode: String(error?.code ?? ''), errorMessage, finishedAt: new Date() } });
        await indexOutbox(tx, message.id, updated.statusVersion);
      });
      logger.warn({ messageId: message.id, classification, err: errorMessage }, 'email delivery ended without confirmed success');
    } finally {
      transport.close();
    }
  };
}

export function createIndexProcessor(elastic: ElasticsearchClient, indexName: string) {
  return async (job: Job<IndexJob>) => {
    const message = await prisma.emailMessage.findUnique({ where: { id: job.data.messageId } });
    if (!message) return;
    await elastic.index({
      index: indexName,
      id: message.id,
      version: message.statusVersion,
      version_type: 'external_gte',
      document: {
        id: message.id, ownerId: message.ownerId, campaignId: message.campaignId, senderId: message.senderId,
        recipient: message.recipient, subject: message.subject, body: message.body, status: message.status,
        originalScheduledAt: message.originalScheduledAt, effectiveScheduledAt: message.effectiveScheduledAt,
        deferralReason: message.deferralReason, sentAt: message.sentAt, previewUrl: message.previewUrl,
        lastError: message.lastError, statusVersion: message.statusVersion, updatedAt: message.updatedAt
      }
    });
  };
}

export function createSlackProcessor() {
  return async (job: Job<SlackJob>) => {
    const notification = await prisma.slackNotification.findUnique({
      where: { id: job.data.notificationId }, include: { owner: { include: { slackIntegration: true } }, sender: true }
    });
    if (!notification || notification.status === 'SENT') return;
    const integration = notification.owner.slackIntegration;
    if (!integration?.enabled) {
      await prisma.slackNotification.update({ where: { id: notification.id }, data: { status: 'SKIPPED' } });
      return;
    }
    const response = await fetch(decryptSecret(integration.webhookUrlEnc, getConfig().INTEGRATION_ENCRYPTION_KEY), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: `ReachInbox hourly limit reached for ${notification.sender.name} <${notification.sender.email}>. Cap: ${notification.cap} attempts in the UTC hour. Next eligible: ${notification.nextEligibleAt.toISOString()}.` })
    });
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      await prisma.slackNotification.update({ where: { id: notification.id }, data: { status: 'FAILED', attempts: { increment: 1 }, lastError: `${response.status} ${body}` } });
      throw new Error(`Slack webhook failed with ${response.status}`);
    }
    await prisma.slackNotification.update({ where: { id: notification.id }, data: { status: 'SENT', attempts: { increment: 1 }, sentAt: new Date(), lastError: null } });
  };
}
