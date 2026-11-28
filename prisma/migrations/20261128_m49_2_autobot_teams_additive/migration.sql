-- M49.2 — BEAN AUTOBOT TEAMS: user-configured team compositions (additive).
-- Two new tables + three nullable columns + indexes only. No existing table
-- is altered destructively, no column is dropped or renamed, no data is
-- rewritten: the migration is a pure ADDITION and is safe against every
-- existing deployment (SQLite dev DB and CI copies).
--   * AgentMission.teamId            — nullable; the team that ran the mission
--   * AgentMission.teamSnapshotJson  — nullable; the IMMUTABLE execution snapshot
--   * AgentMissionTask.assignmentJson — nullable; the per-task member snapshot
-- The team relation on AgentMission is ON DELETE SET NULL (mission history —
-- including its snapshot JSON — survives team deletion).

-- CreateTable
CREATE TABLE "AutobotTeam" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "leaderMemberId" TEXT,
    "workflowPreference" TEXT NOT NULL DEFAULT 'auto',
    "templateKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AutobotTeam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AutobotTeamMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "teamId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "responsibility" TEXT NOT NULL DEFAULT '',
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AutobotTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "AutobotTeam" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AutobotTeamMember_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "AutobotAgent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AutobotTeam_userId_status_idx" ON "AutobotTeam"("userId", "status");

-- CreateIndex
CREATE INDEX "AutobotTeam_userId_createdAt_idx" ON "AutobotTeam"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AutobotTeamMember_teamId_orderIndex_idx" ON "AutobotTeamMember"("teamId", "orderIndex");

-- CreateIndex
CREATE UNIQUE INDEX "AutobotTeamMember_teamId_agentId_key" ON "AutobotTeamMember"("teamId", "agentId");

-- AddForeignKey (M49.2 team reference on missions — SET NULL keeps history)
ALTER TABLE "AgentMission" ADD COLUMN "teamId" TEXT;
ALTER TABLE "AgentMission" ADD COLUMN "teamSnapshotJson" TEXT;
CREATE INDEX "AgentMission_teamId_idx" ON "AgentMission"("teamId");
ALTER TABLE "AgentMission" ADD CONSTRAINT "AgentMission_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "AutobotTeam" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable (M49.2 per-task member assignment snapshot — nullable, additive)
ALTER TABLE "AgentMissionTask" ADD COLUMN "assignmentJson" TEXT;

-- AlterTable (M49.2 deterministic assignment rule on the team)
ALTER TABLE "AutobotTeam" ADD COLUMN "assignmentPreference" TEXT NOT NULL DEFAULT 'team-order';
