-- CreateTable
CREATE TABLE "EvidenceKnowledge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "domain" TEXT NOT NULL,
    "knowledgeClass" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "verificationOutcome" TEXT,
    "confidence" TEXT NOT NULL,
    "sourcesJson" TEXT NOT NULL,
    "independenceGroups" INTEGER NOT NULL,
    "freshnessStatus" TEXT NOT NULL,
    "claimKey" TEXT NOT NULL,
    "validFrom" DATETIME,
    "validUntil" DATETIME,
    "supersedesId" TEXT,
    "retractedAt" DATETIME,
    "retractionNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EvidenceKnowledge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentMission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "missionType" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "deliverableTaskId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "planJson" TEXT NOT NULL,
    "detectedJson" TEXT,
    "trustTaskId" TEXT,
    "jobId" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "failureNote" TEXT,
    "outcomeSummary" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    CONSTRAINT "AgentMission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AgentMissionTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "missionId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "paramsJson" TEXT NOT NULL,
    "expectedOutput" TEXT NOT NULL,
    "dependsOnJson" TEXT NOT NULL,
    "authScope" TEXT NOT NULL,
    "verificationJson" TEXT NOT NULL,
    "limitsJson" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "corrections" INTEGER NOT NULL DEFAULT 0,
    "specialistJobId" TEXT,
    "executionJson" TEXT,
    "verificationResultJson" TEXT,
    "failureNote" TEXT,
    "artifactJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AgentMissionTask_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "AgentMission" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExecutionDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "decisionKind" TEXT NOT NULL,
    "decisionJson" TEXT NOT NULL,
    "planDigest" TEXT,
    "planJson" TEXT,
    "recordsJson" TEXT,
    "trustTaskId" TEXT,
    "bindingDigest" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "EvidenceKnowledge_userId_domain_knowledgeClass_idx" ON "EvidenceKnowledge"("userId", "domain", "knowledgeClass");

-- CreateIndex
CREATE INDEX "EvidenceKnowledge_userId_createdAt_idx" ON "EvidenceKnowledge"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "EvidenceKnowledge_claimKey_idx" ON "EvidenceKnowledge"("claimKey");

-- CreateIndex
CREATE INDEX "EvidenceKnowledge_supersedesId_idx" ON "EvidenceKnowledge"("supersedesId");

-- CreateIndex
CREATE INDEX "AgentMission_userId_status_idx" ON "AgentMission"("userId", "status");

-- CreateIndex
CREATE INDEX "AgentMission_jobId_idx" ON "AgentMission"("jobId");

-- CreateIndex
CREATE INDEX "AgentMissionTask_missionId_status_idx" ON "AgentMissionTask"("missionId", "status");

-- CreateIndex
CREATE INDEX "AgentMissionTask_specialistJobId_idx" ON "AgentMissionTask"("specialistJobId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentMissionTask_missionId_taskId_key" ON "AgentMissionTask"("missionId", "taskId");

-- CreateIndex
CREATE INDEX "ExecutionDecision_userId_conversationId_idx" ON "ExecutionDecision"("userId", "conversationId");

-- CreateIndex
CREATE INDEX "ExecutionDecision_userId_status_idx" ON "ExecutionDecision"("userId", "status");

-- CreateIndex
CREATE INDEX "ExecutionDecision_trustTaskId_idx" ON "ExecutionDecision"("trustTaskId");

