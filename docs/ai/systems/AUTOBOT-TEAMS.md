# BEAN AUTOBOT TEAMS — Multi-Agent Workforce Collaboration

**Status: implemented (M49.2, November 28, 2026). A user-configured team COMPOSITION layer on the existing M41 mission machinery — no second framework.**

## 1. Purpose and responsibilities

BEAN AUTOBOT TEAMS (inside the BEAN AUTOBOTS product) lets a user assemble
their own agents into teams, give the team a project objective, and watch the
members collaborate through BEAN's REAL mission engine to a verified
deliverable. A team is coordination metadata over compositions of the user's
OWN M49.1 agents — it is never a new execution worker, never an agent-to-agent
chat fabric, and never a user-authored execution plan.

## 2. Actual architecture

One authority chain, reusing every existing system:

1. **Catalogue (pure, shared)** — `src/lib/autobots/teams/catalog.ts`: ten
   verified team templates (compositions of EXISTING agent templates), the
   fixed task-kind → team-capability requirement map, workflow/assignment
   vocabularies and bounded limits.
2. **Assignment engine (pure)** — `src/lib/autobots/teams/assignment.ts`:
   the deterministic task→member mapping (eligibility = the member agent's
   `capabilityKey` + active status ONLY), the bounded untrusted-framed
   persona preference block, and the immutable team execution snapshot.
3. **Team service (server)** — `src/lib/autobots/teams/team-service.ts`:
   owner-scoped team CRUD with bounded normalization, same-owner active-agent
   membership rules, per-account cap, rate limits, audit records and
   active-mission protection (archive/delete refuse while a mission runs).
4. **Team mission bridge (server)** — `src/lib/autobots/teams/team-mission.ts`:
   `planTeamMission` (STRICTLY read-only preview over the REAL deterministic
   M41 planner + assignment), `runTeamMission` (full validation + immutable
   snapshot + mission creation through the EXISTING store), and
   `listTeamMissions` (owner-scoped customer-safe progress views).
5. **M41 (existing, extended additively)** — `createMissionFromPlan` gains an
   optional team context (team reference + snapshot + per-task assignment
   JSON, each written ONCE); the executor gains ONE bounded persona seam
   (see §5). The planner, DAG kernel, executor, durable job queue, specialist
   adapters, verification gates and Trust Engine are untouched.

UI: `src/components/bean/autobots/teams.tsx` (Discover Teams / My Teams /
Create Team / Team Workspace), mounted through the Agents⇄Teams surface
switch inside the existing BEAN AUTOBOTS view (`index.tsx`). No new
navigation item; no unrelated redesign.

## 3. Source-code locations

| Concern | Path |
|---|---|
| Team catalogue + capability map | `src/lib/autobots/teams/catalog.ts` |
| Assignment engine + snapshot | `src/lib/autobots/teams/assignment.ts` |
| Team CRUD service | `src/lib/autobots/teams/team-service.ts` |
| Team mission bridge | `src/lib/autobots/teams/team-mission.ts` |
| Teams CRUD/plan/run/history APIs | `src/app/api/autobots/teams/**` |
| Teams catalogue API | `src/app/api/autobots/teams/catalog/route.ts` |
| Teams UI | `src/components/bean/autobots/teams.tsx` |
| Surface switch (Agents⇄Teams) | `src/components/bean/autobots/index.tsx` |
| Mission store team context | `createMissionFromPlan` in `src/lib/riishe/mission/store.ts` |
| Executor persona seam | `objectiveForMember` in `src/lib/riishe/mission/executor.ts` |
| Persistence | Prisma `AutobotTeam`, `AutobotTeamMember`, additive `AgentMission.teamId`/`teamSnapshotJson`, `AgentMissionTask.assignmentJson` |
| Execution contract | `docs/agents/M49.2-TEAM-EXECUTION-CONTRACT.md` |
| Acceptance record | `docs/agents/M49.2-TEAM-ACCEPTANCE.md` |

## 4. Model and provider integration

No new model/provider surface. Team missions ride the SAME execution
substrate as every M41 mission: the deterministic planner (`planMission`),
the durable `mission-run` GenerationJob on the riishe pool (claim, lease,
heartbeat, crash recovery), the existing specialist delegation paths
(CODE GIFTZ / LAXII / JAZMII / GANGZII with every preflight gate), the real
retrieval lanes, and the Trust Engine. There is NO team job queue.

## 5. Input/output contracts

- Team create/update: name ≤80, description ≤600, workflowPreference ∈
  {auto, research-first, build-first, review-heavy} (DESCRIPTIVE ONLY),
  assignmentPreference ∈ {team-order, leader-first} (a pure deterministic
  ordering), members 2..8 (same-owner ACTIVE agents, unique per team,
  responsibility ≤300 — user data, never authorization), leader = a member.
- Plan preview (`POST /api/autobots/teams/[id]/plan`): READ-ONLY. Returns the
  deterministic M41 plan with per-task assigned members, platform-gate
  markers, dependency waves, and — when the roster cannot cover a required
  capability — exact honest gap messages (never a substitute).
- Run (`POST /api/autobots/teams/[id]/run`): validates team (owner, active),
  members, plan, complete assignment and the one-active-mission guard, then
  records the immutable snapshot and submits the REAL mission. 201 with
  missionId/jobId.
- History (`GET /api/autobots/teams/[id]/missions`): owner-scoped mission
  progress views with per-task states, verification outcomes, assigned
  member (from the immutable assignment snapshot) and REAL admitted artifact
  references (project ids / asset URLs) for follow-up in existing products.
- The persona seam: ONLY delegated `code-build`/`document-draft` objectives
  receive the ≤700-char bounded member-preference block, framed UNTRUSTED
  with a never-truncated security framing and a stable idempotency marker.
  Media (image/video/audio), research, knowledge and verify-deliverable
  tasks carry ATTRIBUTION ONLY — no persona text (those lanes have no safe
  model seam; documented honestly in
  `docs/agents/M49.2-TEAM-EXECUTION-CONTRACT.md` §4).

## 6. Tools and permissions — the security boundary

- Eligibility and selection are pure orderings over the SAVED roster:
  capabilityKey + active status decide eligibility; saved order / leader
  preference / agentId decide ties. Member names, responsibilities,
  descriptions and instructions are NEVER consulted.
- The QUALITY verification gate (`verify-deliverable`) maps to the PLATFORM
  execution path — no member, team leader or persona text can take it over,
  disable it or replace it.
- Persona preferences ride as untrusted user data; the executor derives all
  authorization exclusively from the fixed M41 task kind (scopes, delegated
  permissions, verification criteria, resource limits are unchanged).
- Leadership is coordination copy: the leader gains zero extra tools.
- Every consequential operation rides the existing Trust Engine contracts;
  team missions cannot bypass approvals, quotas, cost guards or dedupe.

## 7. Data and memory handling

`AutobotTeam` / `AutobotTeamMember` are owner-scoped (cascade-contained;
member rows reference the user's own agents only). Team missions add three
nullable additive columns: `AgentMission.teamId` (SetNull on team deletion —
history survives), `AgentMission.teamSnapshotJson` (the IMMUTABLE execution
snapshot: team identity, membership, agent identities, capability keys,
roles, bounded persona preferences, task assignments) and
`AgentMissionTask.assignmentJson` (the per-task member snapshot). Editing a
team or agent after a mission starts can never change the running mission's
execution context (pinned by tests). Agent conversation histories are NOT
merged by teams. No sensitive prompt internals or credentials appear in
customer-visible receipts.

## 8. Execution workflow

objective → `planTeamMission` (read-only: deterministic M41 plan +
assignment preview + honest gaps) → user confirms → `runTeamMission`
(re-validate → snapshot → `createMissionFromPlan` with team context →
durable `mission-run` job) → the EXISTING executor drives the DAG with
dependency-aware bounded-parallel scheduling → per-task verified outputs →
structured verified handoffs (research packs, artifact digests — unchanged
M41 contracts) → platform QUALITY gate → honest settlement
(completed / completed_partial / failed / cancelled) → the team workspace
polls the real mission ledger and renders true states only.

## 9. Existing tests and verification

- `tests/unit/m49-2-team-catalog.test.ts` (12): template integrity (real
  agent-template references, honest limitations, no invented capabilities,
  no planned-product claims), full task-kind coverage, gate ownership.
- `tests/unit/m49-2-assignment.test.ts` (16): deterministic selection and
  tie-breaks, archived-member exclusion, exact missing-capability refusals,
  gate non-capture, hostile-persona non-widening, bounded untrusted-framed
  persona block (framing survives truncation), defensive assignment parsing,
  snapshot bounds and clipping.
- `tests/unit/m49-2-team-service.test.ts` (17): bounded normalization,
  vocabulary 422s, size boundaries (2..8, duplicates), owner-scoped CRUD
  with honest 404s, same-owner/active membership enforcement, leader-must-
  be-member, per-account cap, active-mission archive/delete protection,
  honest derived stats, duplicate semantics, template instantiation with
  agent reuse, custom-team honesty.
- `tests/unit/m49-2-team-mission.test.ts` (13): plan preview creates ZERO
  rows and enqueues ZERO work; run creates a REAL M41 mission with exactly
  ONE durable `mission-run` job (product `riishe`, existing enqueue seam);
  snapshot/assignment immutability across later edits; one-active-mission
  duplicate protection; missing-capability refusal creates nothing;
  archived-team refusal; cross-user 404 isolation; honest history states;
  executor persona seam (only engineering lanes, idempotent, framing intact).

## 10. Failure handling and fallback behavior

Inherited from M41: dependency-aware scheduling with bounded parallelism,
durable task persistence, cancellation propagation, bounded retries and
corrections, verification before success, honest partial completion, failed-
dependency skip propagation and safe artifact handoff. Team-specific
refusals are honest and exact: an unavailable specialist backend fails its
task truthfully (never simulated); a missing member capability refuses the
run naming the exact requirement; an archived team/member is excluded; a
team with an active mission refuses a second submission.

## 11. Current implemented capabilities

- Discover Teams: 10 verified templates (9 compositions + custom start),
  each stating its real capability requirements and honest limitations.
- My Teams: open/edit/duplicate/archive/restore/delete with real derived
  mission stats (delivered count, last run, active mission).
- Create Team: bounded roster builder over My Agents with responsibilities,
  leader, order, deterministic assignment rule, and inline agent creation
  that never loses the team-building workflow.
- Team Workspace: read-only plan preview (who handles what, dependencies,
  parallel waves, honest gaps) → confirmed run → real mission progress with
  verification outcomes and deliverable follow-up links into the existing
  product surfaces.
- Real team collaboration: coordinated execution + structured verified
  handoffs through the M41 kernel — NOT unrestricted agent-to-agent chat.

## 12. Partial capabilities and known limitations

- Persona influence is real ONLY on delegated engineering/document tasks;
  media/retrieval/verification tasks carry truthful attribution without
  persona injection (no safe seam exists — documented, not faked).
- `advisory`/`review` members receive no mission-task assignments in M49.2
  (no M41 task kind maps to them); they remain conversation-capable
  personas in individual agent workspaces and are never the verification
  gate.
- Workflow preferences are descriptive coordination copy — they do not alter
  the deterministic planner, the DAG scheduler or authorization.
- Team missions require the underlying specialist backends for media/
  engineering lanes; unconfigured backends produce honest failures.
- Team-template instantiation reuses existing agents created from the same
  template or creates fresh ones (bounded by the 50-agent account cap).

## 13. Planned capabilities (NOT implemented)

- Team-level memory/context sharing (consented, owner-scoped).
- Team templates with user-authored task-shape hints (still planner-gated).
- Cross-team orchestration (M52 UNIFIED ECOSYSTEM direction).
Nothing in this list is claimed by the running product today.
