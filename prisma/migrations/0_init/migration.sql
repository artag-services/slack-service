-- CreateMessage
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipients" TEXT[] NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateSlackMessage
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

-- CreateIndex: Message.channel
CREATE INDEX "Message_channel_idx" ON "Message" ("channel");

-- CreateIndex: Message.status
CREATE INDEX "Message_status_idx" ON "Message" ("status");

-- CreateIndex: Message.createdAt
CREATE INDEX "Message_createdAt_idx" ON "Message" ("createdAt");

-- CreateIndex: SlackMessage.messageId
CREATE UNIQUE INDEX "SlackMessage_messageId_key" ON "SlackMessage" ("messageId");

-- CreateEnum: MessageStatus
DO $$ BEGIN
    CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'PARTIAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: SlackMessageStatus
DO $$ BEGIN
    CREATE TYPE "SlackMessageStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;