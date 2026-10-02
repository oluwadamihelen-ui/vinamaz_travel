-- CreateEnum
CREATE TYPE "MessageSender" AS ENUM ('CLIENT', 'STAFF');

-- CreateEnum
CREATE TYPE "UploadKind" AS ENUM ('DOCUMENT', 'PAYMENT_PROOF', 'MESSAGE_ATTACHMENT');

-- AlterTable
ALTER TABLE "PaymentMethodSetting" ADD COLUMN     "currencies" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "VisaApplication" ADD COLUMN     "configSnapshot" JSONB;

-- CreateTable
CREATE TABLE "ApplicationMessage" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "senderId" TEXT,
    "senderRole" "MessageSender" NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationMessageAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationMessageAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "applicationId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingUpload" (
    "id" TEXT NOT NULL,
    "kind" "UploadKind" NOT NULL,
    "userId" TEXT NOT NULL,
    "applicationId" TEXT,
    "paymentId" TEXT,
    "requirementKey" TEXT,
    "storageKey" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "declaredSize" INTEGER NOT NULL,
    "maxBytes" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingUpload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "ApplicationMessage_applicationId_createdAt_idx" ON "ApplicationMessage"("applicationId", "createdAt");

-- CreateIndex
CREATE INDEX "ApplicationMessage_applicationId_senderRole_readAt_idx" ON "ApplicationMessage"("applicationId", "senderRole", "readAt");

-- CreateIndex
CREATE INDEX "ApplicationMessage_senderRole_readAt_createdAt_idx" ON "ApplicationMessage"("senderRole", "readAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationMessageAttachment_storageKey_key" ON "ApplicationMessageAttachment"("storageKey");

-- CreateIndex
CREATE INDEX "ApplicationMessageAttachment_messageId_idx" ON "ApplicationMessageAttachment"("messageId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PendingUpload_storageKey_key" ON "PendingUpload"("storageKey");

-- CreateIndex
CREATE INDEX "PendingUpload_userId_createdAt_idx" ON "PendingUpload"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PendingUpload_expiresAt_idx" ON "PendingUpload"("expiresAt");

-- CreateIndex
CREATE INDEX "RateLimitBucket_updatedAt_idx" ON "RateLimitBucket"("updatedAt");

-- AddForeignKey
ALTER TABLE "ApplicationMessage" ADD CONSTRAINT "ApplicationMessage_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "VisaApplication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationMessageAttachment" ADD CONSTRAINT "ApplicationMessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ApplicationMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
