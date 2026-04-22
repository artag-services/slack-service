-- Slack Service Schema Migration

-- CreateEnum: SlackMessageStatus
DO $$ BEGIN
    CREATE TYPE "SlackMessageStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'DELIVERED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: SlackMessage
CREATE TABLE "SlackMessage" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "status" "SlackMessageStatus" NOT NULL DEFAULT 'PENDING',
    "slackMsgTs" TEXT,
    "channel" TEXT,
    "errorReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SlackMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: SlackMessage.messageId
CREATE UNIQUE INDEX "SlackMessage_messageId_key" ON "SlackMessage" ("messageId");

-- CreateIndex: SlackMessage.recipient
CREATE INDEX "SlackMessage_recipient_idx" ON "SlackMessage" ("recipient");

-- CreateIndex: SlackMessage.status
CREATE INDEX "SlackMessage_status_idx" ON "SlackMessage" ("status");

-- CreateIndex: SlackMessage.createdAt
CREATE INDEX "SlackMessage_createdAt_idx" ON "SlackMessage" ("createdAt");
