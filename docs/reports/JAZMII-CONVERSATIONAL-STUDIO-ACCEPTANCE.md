# JAZMII — Conversational Video Studio: Redesign Verification & Live Acceptance

Date: 2026-11-12 · Base: `2bc5558` (LAXII-UNIFIED-1) · Studio commit: `2aed4bb` · This session: gap fixes + re-acceptance on top of `99322b3`

## 1. Scope

The owner's work order: transform JAZMII from the form-based dashboard into ONE ChatGPT-style
conversational video studio — no fragmented prompt form, no permanently visible dropdowns, no
dashboard-style history cards; one workspace, multiple saved conversations, real generation,
honest status. The redesign itself shipped in commit `2aed4bb` earlier on 2026-11-12; this
session audited the shipped implementation against all twelve work-order sections, closed two
genuine gaps, re-ran the acceptance steps that had been blocked by the provider's 429 throttle
window, and produced the final evidence set.

## 2. Files (complete implementation inventory)

Product code (commit `2aed4bb`, unchanged this session unless noted):

- `src/components/bean/jazmii.tsx` — the unified studio UI (1,066 lines): collapsible conversation
  sidebar (desktop rail + mobile Sheet), message thread with embedded video players, compact
  composer (attach + text + settings popover + send), New chat, rename (inline) and delete
  (AlertDialog confirm), welcome examples, honest status lines, verbatim errors, polling only
  while a real job is genuinely inflight. **This session added**: a "Retry generation" +
  "Continue with another prompt" action row on FAILED/REJECTED/CANCELLED job cards (the same
  prompt + settings re-submitted through the real pipeline — no fake retry state).
- `src/app/api/jazmii/chat/route.ts` — one conversational turn: owner-scoped conversation
  create/reuse, EXACT legacy generate-route semantics (same zod bounds 360..1920 / 3..12s /
  speed|quality / audio flag, preflight, dedupeKey guard, paramsJson shape, audit, enqueue,
  poller attach), user + assistant (job-linked) messages persisted.
- `src/app/api/jazmii/conversations/route.ts` — list (+ one-time "Earlier generations" backfill
  from real job rows; jobs never rewritten), create (New chat), inflight poller re-attach.
- `src/app/api/jazmii/conversations/[id]/route.ts` — GET live-merged thread (job state ALWAYS
  read back from GenerationJob; poller re-attach), PATCH rename, DELETE thread-only (job rows,
  media artifacts and provider recovery untouched).
- `src/app/api/jazmii/jobs/[id]/reference/route.ts` — owner-only I2V driver-image re-attach for
  honest regeneration.
- `src/lib/jazmii/chat.ts` — shared serializer: live job merge, ffprobe-measured stream facts,
  legacy status vocabulary preservation, `jazmiiTitleFromText` (titles from the first prompt).
- `prisma/schema.prisma` — additive `JazmiiConversation` + `JazmiiMessage` (LINK GenerationJob
  by `jobId`; `db:push` applied 2026-11-12; existing rows untouched — no destructive migration).

Tooling (this session):

- `scripts/jazmii-chat-acceptance.ts` — BASE URL made env-tunable (`JAZMII_ACCEPT_BASE`),
  keeping the default dev `:3000`.
- `scripts/run-jazmii-acceptance-step.sh` — one-call acceptance runner (server + step + bounded
  poll in a single invocation; background processes do not survive between tool calls here).
- `scripts/jazmii-ui-shots.sh` / `jazmii-ui-shots2.sh` — screenshot harness (dev server +
  agent-browser; the prod standalone build bakes NODE_ENV=production into the edge middleware,
  which compiles out the loopback origin allowance — documented measured constraint).
- `scripts/jazmii-chat-acceptance-out/` — refreshed `acceptance.json` + desktop/mobile/drawer
  screenshots (`run-state.json` remains git-excluded).

## 3. Data integrity & persistence (verified)

- Relationships: User → JazmiiConversation (owner-scoped every route) → JazmiiMessage →
  GenerationJob via `jobId`; settings live authoritatively in `paramsJson`; messages carry
  display-only meta. Job state is never cached or invented — every read merges the live row.
- Backfill: users with video jobs but no conversations get ONE "Earlier generations" thread from
  their real job rows (chronological; no job row rewritten).
- Acceptance measures: A4 (3 unique jobs linked in one conversation) PASS; A6 switch-and-return
  PASS; A7 fresh-login reload PASS; A8 new-chat isolation PASS; A9 every conversation job present
  in the owner's job list PASS. A completed background job updates its conversation on read even
  after switching (pollers are re-attached server-side on every list/detail read — recovery
  parity with the legacy route).

## 4. Real generation results (honest)

- **Provider window CLOSED for video**: sustained account-wide HTTP 429 throttle on the video
  class (measured since ~07:49Z; last video-class 429 08:16Z). New attempts in this session:
  - Fresh T2V submission (14:52 local / 09:52Z): the system's OWN bounded throttle logic ran —
    5 authorized submission attempts over ~25 minutes, all refused inside the same window, then
    the job failed with the verbatim message "The video provider kept throttling submissions
    (HTTP 429) … BEAN has exactly one authorized video provider … a resubmitted job is the way
    to try again." `RATE_LIMITED`. No retry loops were added; no provider bypass attempted.
  - No new submissions were made after that (throttle discipline: no doomed jobs).
- Historical REAL completions (earlier healthy window, same job pipeline): **16 completed
  jazmii video jobs exist**; newest: 1280×720 h264, 5.19s, 4,510,267 bytes,
  `storage/jazmii/<user>/cmwd377hy007….mp4` — artifact verified on disk (ftyp isom magic,
  ffprobe-measured stream facts).
- Consequence: A1 (real T2V), A3 (real I2V — the reference upload itself succeeded, the provider
  refused the generation), A5 (follow-up generation), A10 (download of a video completed inside
  THIS acceptance conversation) record FAIL **with the genuine provider error** — 7/11 steps
  PASS. This is the honest state; nothing is fabricated.
- A10 supplementary evidence (same code path, measured this session): unauthenticated media
  fetch → **401**; authenticated as a different user → **404** (owner boundary holds); the real
  completed artifact delivers ffprobe-valid bytes. In-conversation playback/download with real
  bytes was demonstrated in the earlier healthy window (04:38–05:08Z completions through this
  exact pipeline).

## 5. Job recovery (verified)

- The throttled job was left inflight at call end (server stopped); on the next boot the
  recovery/poller re-attach resumed it automatically, honored its scheduled attempt, and recorded
  the honest terminal state — measured live during acceptance.
- A11 PASS: legacy `GET /api/jazmii/generate` answers 200 with job history + product
  availability (auth + recovery parity preserved).

## 6. Gates

- `bun test --isolate tests/`: **1446 pass / 0 fail** (100 files).
- `tsc --noEmit`: **0 errors in src/ + tests/** (145 pre-existing baseline errors confined to
  scripts/ tooling — accepted baseline).
- `eslint` (changed files): **0 problems**.
- `bun run build` (production): **PASS** — all routes compiled.

## 7. Visual verification (screenshots in `scripts/jazmii-chat-acceptance-out/`)

- `jazmii-ui-desktop.png` (1440×900): conversation rail + thread with real failed-job cards
  (verbatim RATE_LIMITED text, metadata chips, new Retry generation action), unified composer
  with settings summary, BEAN black + champagne-gold identity.
- `jazmii-ui-mobile.png` (390×844): compact headers, responsive full-width job card, sticky
  composer with safe-area padding.
- `jazmii-ui-mobile-drawer.png`: conversations Sheet with New chat, history, active highlight.

## 8. Boundaries held

RIISHE / LAXII / CODE GIFTZ untouched; global navigation, auth, billing untouched; no new
provider, no Ollama, no mocked generation; only JAZMII files + the minimum shared tooling
changed; no unrelated database models touched; no destructive migration.

## 9. Open item (external, not a code defect)

The platform gateway's video-class throttle window is provider-side and outside this repo's
control. The studio's behavior when it reopens is exactly per work order: the user re-submits
(via the new Retry action or a fresh prompt), the job runs through the same real pipeline, and
successes render as playable, downloadable results in the conversation — as the 16 existing real
completions prove.
