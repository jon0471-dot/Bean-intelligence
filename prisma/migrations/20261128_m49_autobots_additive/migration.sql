-- M49.1 — BEAN AUTOBOTS: user-facing AI workforce (additive).
-- Three new tables + indexes only. No existing table is altered, no column
-- is dropped, no data is rewritten: the migration is a pure ADDITION and is
-- safe against every existing deployment (SQLite dev DB and CI copies).
-- The User relation (autobots) is expressed by the FK below; Prisma's
-- generated client picks up the relation from schema.prisma.

-- CreateTable
CREATE TABLE "AutobotAgent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "industry" TEXT,
    "description" TEXT NOT NULL,
    "personality" TEXT,
    "instructions" TEXT,
    "language" TEXT,
    "capabilityKey" TEXT NOT NULL,
    "memoryMode" TEXT NOT NULL DEFAULT 'disabled',
    "templateKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "executionCount" INTEGER NOT NULL DEFAULT 0,
    "lastExecutedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutobotAgent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutobotConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutobotConversation_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AutobotAgent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutobotMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "latencyMs" INTEGER,
    "tokensEstIn" INTEGER,
    "tokensEstOut" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutobotMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AutobotConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AutobotAgent_userId_status_idx" ON "AutobotAgent"("userId", "status");

-- CreateIndex
CREATE INDEX "AutobotAgent_userId_createdAt_idx" ON "AutobotAgent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AutobotConversation_agentId_idx" ON "AutobotConversation"("agentId");

-- CreateIndex
CREATE INDEX "AutobotConversation_userId_idx" ON "AutobotConversation"("userId");

-- CreateIndex
CREATE INDEX "AutobotMessage_conversationId_idx" ON "AutobotMessage"("conversationId");
