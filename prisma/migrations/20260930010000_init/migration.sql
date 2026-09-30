CREATE TYPE "MessageStatus" AS ENUM ('SCHEDULED', 'QUEUED', 'SENDING', 'SENT', 'FAILED', 'AMBIGUOUS', 'CANCELLED');
CREATE TYPE "AttemptOutcome" AS ENUM ('STARTED', 'SENT', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'AMBIGUOUS');
CREATE TYPE "OutboxKind" AS ENUM ('EMAIL_ENQUEUE', 'EMAIL_INDEX', 'SLACK_NOTIFY');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'SKIPPED', 'FAILED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL, "googleSubject" TEXT, "email" TEXT NOT NULL, "name" TEXT NOT NULL, "avatarUrl" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Sender" (
  "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "name" TEXT NOT NULL, "email" TEXT NOT NULL,
  "smtpHost" TEXT NOT NULL, "smtpPort" INTEGER NOT NULL, "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
  "smtpUsernameEnc" TEXT NOT NULL, "smtpPasswordEnc" TEXT NOT NULL, "minIntervalMs" INTEGER NOT NULL DEFAULT 1000,
  "hourlyLimit" INTEGER NOT NULL DEFAULT 100, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Sender_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Campaign" (
  "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "senderId" TEXT NOT NULL, "subject" TEXT NOT NULL, "body" TEXT NOT NULL,
  "startAt" TIMESTAMP(3) NOT NULL, "timezone" TEXT NOT NULL, "delayMs" INTEGER NOT NULL, "hourlyLimit" INTEGER NOT NULL,
  "recipientCount" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "EmailMessage" (
  "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "campaignId" TEXT NOT NULL, "senderId" TEXT NOT NULL,
  "recipient" TEXT NOT NULL, "recipientOrder" INTEGER NOT NULL, "subject" TEXT NOT NULL, "body" TEXT NOT NULL,
  "originalScheduledAt" TIMESTAMP(3) NOT NULL, "effectiveScheduledAt" TIMESTAMP(3) NOT NULL, "deferralReason" TEXT,
  "status" "MessageStatus" NOT NULL DEFAULT 'SCHEDULED', "statusVersion" INTEGER NOT NULL DEFAULT 1,
  "sendingStartedAt" TIMESTAMP(3), "sentAt" TIMESTAMP(3), "smtpMessageId" TEXT, "previewUrl" TEXT, "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SendAttempt" (
  "id" TEXT NOT NULL, "messageId" TEXT NOT NULL, "attemptNumber" INTEGER NOT NULL, "outcome" "AttemptOutcome" NOT NULL,
  "errorCode" TEXT, "errorMessage" TEXT, "smtpResponse" TEXT, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3), CONSTRAINT "SendAttempt_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ScheduleRequest" (
  "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "idempotencyKey" TEXT NOT NULL, "payloadFingerprint" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduleRequest_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "OutboxEvent" (
  "id" TEXT NOT NULL, "kind" "OutboxKind" NOT NULL, "aggregateId" TEXT NOT NULL, "payload" JSONB NOT NULL,
  "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "claimedAt" TIMESTAMP(3), "publishedAt" TIMESTAMP(3),
  "lastError" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SlackIntegration" (
  "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "teamId" TEXT NOT NULL, "teamName" TEXT NOT NULL,
  "channelId" TEXT NOT NULL, "channelName" TEXT NOT NULL, "webhookUrlEnc" TEXT NOT NULL, "botTokenEnc" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SlackIntegration_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SlackNotification" (
  "id" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "senderId" TEXT NOT NULL, "utcHour" TIMESTAMP(3) NOT NULL,
  "cap" INTEGER NOT NULL, "nextEligibleAt" TIMESTAMP(3) NOT NULL, "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0, "lastError" TEXT, "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "SlackNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_googleSubject_key" ON "User"("googleSubject");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "Sender_ownerId_idx" ON "Sender"("ownerId");
CREATE UNIQUE INDEX "Sender_ownerId_email_key" ON "Sender"("ownerId", "email");
CREATE INDEX "Campaign_ownerId_createdAt_idx" ON "Campaign"("ownerId", "createdAt");
CREATE INDEX "EmailMessage_ownerId_status_effectiveScheduledAt_idx" ON "EmailMessage"("ownerId", "status", "effectiveScheduledAt");
CREATE INDEX "EmailMessage_senderId_status_idx" ON "EmailMessage"("senderId", "status");
CREATE UNIQUE INDEX "EmailMessage_campaignId_recipientOrder_key" ON "EmailMessage"("campaignId", "recipientOrder");
CREATE INDEX "SendAttempt_messageId_idx" ON "SendAttempt"("messageId");
CREATE UNIQUE INDEX "SendAttempt_messageId_attemptNumber_key" ON "SendAttempt"("messageId", "attemptNumber");
CREATE UNIQUE INDEX "ScheduleRequest_campaignId_key" ON "ScheduleRequest"("campaignId");
CREATE UNIQUE INDEX "ScheduleRequest_ownerId_idempotencyKey_key" ON "ScheduleRequest"("ownerId", "idempotencyKey");
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");
CREATE UNIQUE INDEX "OutboxEvent_kind_aggregateId_key" ON "OutboxEvent"("kind", "aggregateId");
CREATE UNIQUE INDEX "SlackIntegration_ownerId_key" ON "SlackIntegration"("ownerId");
CREATE INDEX "SlackNotification_status_createdAt_idx" ON "SlackNotification"("status", "createdAt");
CREATE UNIQUE INDEX "SlackNotification_ownerId_senderId_utcHour_key" ON "SlackNotification"("ownerId", "senderId", "utcHour");

ALTER TABLE "Sender" ADD CONSTRAINT "Sender_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Sender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Sender"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SendAttempt" ADD CONSTRAINT "SendAttempt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "EmailMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleRequest" ADD CONSTRAINT "ScheduleRequest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleRequest" ADD CONSTRAINT "ScheduleRequest_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SlackIntegration" ADD CONSTRAINT "SlackIntegration_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SlackNotification" ADD CONSTRAINT "SlackNotification_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SlackNotification" ADD CONSTRAINT "SlackNotification_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Sender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
