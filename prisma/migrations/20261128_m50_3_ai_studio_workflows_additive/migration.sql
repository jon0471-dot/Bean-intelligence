-- M50.3 — BEAN AI STUDIO workflow persistence (additive).
-- Three new tables + indexes only. No existing table is altered, no column
-- is dropped or renamed, no data is rewritten, no destructive operation of
-- any kind: the migration is a pure ADDITION and is safe against every
-- existing deployment (fresh schema and existing M49.2 databases alike).
--   * WorkflowDefinition — owner-scoped workflow container (active | archived)
--   * WorkflowVersion    — immutable-once-published graph snapshots
--                          (draft | published | superseded), monotonic
--                          (definitionId, version)
--   * WorkflowRun        — the THIN future execution-reference model; M50.3
--                          creates NO rows here (execution stays M50.5) and
--                          the M41 AgentMission row remains the lifecycle
--                          authority. missionId is a LOOSE unique reference
--                          (the app's existing cross-aggregate discipline —
--                          AgentMission.trustTaskId/.jobId/
--                          AgentMissionTask.specialistJobId), deliberately
--                          NOT a hard FK: a RESTRICT edge inside the
--                          user-cascade chain would risk account deletion
--                          under SQLite's undefined multi-table cascade
--                          ordering. Mission history is never deleted as a
--                          side effect of workflow deletion.

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowDefinition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "definitionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "graphJson" TEXT NOT NULL,
    "changeNote" TEXT NOT NULL DEFAULT '',
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowVersion_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "compiledPlanJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "failureNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    CONSTRAINT "WorkflowRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowRun_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "WorkflowVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "WorkflowDefinition_userId_status_idx" ON "WorkflowDefinition"("userId", "status");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_userId_createdAt_idx" ON "WorkflowDefinition"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowVersion_definitionId_version_key" ON "WorkflowVersion"("definitionId", "version");

-- CreateIndex
CREATE INDEX "WorkflowVersion_definitionId_status_idx" ON "WorkflowVersion"("definitionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_missionId_key" ON "WorkflowRun"("missionId");

-- CreateIndex
CREATE INDEX "WorkflowRun_userId_status_idx" ON "WorkflowRun"("userId", "status");

-- CreateIndex
CREATE INDEX "WorkflowRun_definitionId_idx" ON "WorkflowRun"("definitionId");

-- CreateIndex
CREATE INDEX "WorkflowRun_versionId_idx" ON "WorkflowRun"("versionId");
