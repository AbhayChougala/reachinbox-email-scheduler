import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export const EMAIL_QUEUE = 'scheduled-email';
export const INDEX_QUEUE = 'email-index';
export const SLACK_QUEUE = 'slack-notification';

export type EmailJob = { messageId: string };
export type IndexJob = { messageId: string };
export type SlackJob = { notificationId: string };

export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

export function createQueues(connection: Redis) {
  return {
    emailQueue: new Queue<EmailJob>(EMAIL_QUEUE, { connection }),
    indexQueue: new Queue<IndexJob>(INDEX_QUEUE, { connection }),
    slackQueue: new Queue<SlackJob>(SLACK_QUEUE, { connection })
  };
}

export const emailJobId = (messageId: string) => `email-${messageId}`;
export const indexJobId = (messageId: string, version: number) => `index-${messageId}-${version}`;
export const slackJobId = (notificationId: string) => `slack-${notificationId}`;
