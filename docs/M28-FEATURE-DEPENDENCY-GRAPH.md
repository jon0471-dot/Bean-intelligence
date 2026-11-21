# M28-SLM — Feature Dependency Graph and Migration Order

Milestone: **M28-SLM** · Date: 2026-11-21

All edges below were extracted from actual `import` statements in the M28-tip tree (`88fa9b3`), not inferred from milestone names. The graph defines the migration order; product boundaries (RIISHE / LAXII / CODE GIFTZ / JAZMII / GANGZII) are preserved — every edge stays inside an existing product lane or the shared Trust/runtime layer.

## 1. Verified dependency edges (evidence: `git show 88fa9b3:<file>`)

Trust Engine core (created by G1 `826bf8c`, extended by G3 `2a9b4cb`):

- `trust/receipt` → `./digest`, `./types`, `@/lib/db`
- `trust/checkpoints` → `./types`, `@/lib/db`
- `trust/tasks`, `trust/resume` → `@/lib/db`
- `trust/adapters/audio` → `@/lib/db`, `@/lib/observability/logger`, `@/lib/trust/tasks`, `@/lib/trust/types`

Trust wiring into execution paths (G3 `2a9b4cb` touches `image-worker`, `video-worker`, `riishe-chat-handler`, code-giftz execute route; G5 `e983c41` adds `director-worker`, `giftz-coding-handler`, `giftz/workspace`, `laxii/jobs` receipt settlement):

- `jobs/director-worker` → `ai-engine/events`, `db`, `jazmii/director/composition(+types)`, `jazmii/director/media`, `jazmii/director/schema`, `jobs/video-worker`, `media/ffprobe`, `observability/logger+metering`, `trust/checkpoints`, `trust/digest`, `trust/resume`, `trust/tasks`
- `jobs/audio-worker` → `adapters/hosted-audio`, `ai-engine/events+types`, `db`, `gangzii/audio-upload`, `gangzii/ducking`, `gangzii/tts-engine`, `observability/logger+metering`, `registry/gangzii-presets`, `trust/adapters/audio`

GANGZII audio (M27 `ae41561`; M28 extends `ducking`, `timing`, `model-integrity`):

- `gangzii/narration-service` → `adapters/hosted-audio`, `api/errors`, `db`, `gangzii/audio-upload`, `gangzii/text-normalize`, `gangzii/timing`, `jobs/queue`, `observability/logger`, `registry/gangzii-presets`
- `gangzii/tts-engine`, `gangzii/ducking`, `gangzii/timing`, `gangzii/model-integrity`, `gangzii/text-normalize`, `media/loudness` → no internal imports (self-contained leaf modules; `tts-engine` shells out via `execFile`, loads `kokoro-js`)

JAZMII Auto Director (G4, `3a28bfe8`→`8de0144`):

- `jazmii/director/service` → `ai-engine/queue`, `api/errors`, `db`, **`gangzii/timing`** (M28-F audio timeline sync point), `jazmii/reference-image`, `jobs/queue`, `jobs/video-worker`, `observability/logger`
- `jazmii/director/composition/hyperframes-engine` → `media/ffprobe`, `observability/logger`
- `jazmii/director/planner`, `composition/*` → intra-module

UI layer: `components/bean/gangzii-narration.tsx`, `gangzii-soundtrack.tsx`, `jazmii-director.tsx` → `components/bean/shared` + the API routes under `src/app/api/gangzii/*` and `src/app/api/jazmii/director/*`.

Infrastructure carried by individual commits: `prisma/schema.prisma` (G1 trust models, G4 director models, G6 M27 audio models), `package.json` + `bun.lock` (G4 `hyperframes@0.9.72`, G6 `kokoro-js@1.2.1`).

## 2. Dependency graph (transplanted content)

```
                    ┌──────────────────────────────────────────────┐
                    │ SANITIZED BASE e96d83a (M21–M26.3 + PR4 rec) │
                    └──────────────────────────────────────────────┘
                                      │
        ┌─────────────────────────────┼───────────────────────────────┐
        ▼                             ▼                               ▼
  G2 feb2027 docs               G1 Trust Engine core            G8 recovery records
  (docs/feb2027 ×10,            (prisma+trust/*+routes+UI)      (docs+scripts, parallel)
   independent)                        │                               │
        │                     ┌────────┴─────────┐                     │
        │                     ▼                  ▼                     │
        │              G3 Trust Phase 1   (adapters + resume)         │
        │                     │                                        │
        │                     ▼                                        │
        │              G4 JAZMII Auto Director ──(prisma, hyperframes)─┘
        │                     │
        │                     ▼
        │              G5 Trust specialist coverage
        │                     │
        │                     ▼
        └────────────► G6 M27 GANGZII audio ──(prisma, kokoro-js, audio-worker adaptation)
                              │
                              ▼
                       G7 M28 audio reliability ──(audio-worker/ffprobe adaptation)

  G9 WIP snapshots, G10 credential-forensics docs ── owner-decision gated, independent
```

## 3. Migration order and grouping

| Order | Group | Commits | Can be grouped safely? | Independent? |
|---|---|---|---|---|
| 1 | G1 Trust foundation | `826bf8c` | — | No (root of trust subtree) |
| 2 | G2 feb2027 docs | `b1a21c2` ≡ `2bf9f7b` (once) + `6145578` + `7a64e18c` | Yes — one docs commit acceptable | Yes (parallel lane) |
| 3 | G3 Trust Phase 1 | `2a9b4cb` | — | Needs G1 |
| 4 | G4 JAZMII Auto Director | `3a28bfe8`, `d2d6a4a3`, `91fb59cf`, `f91096e1`, `4ab7f036`, `8de0144` | Cherry-pick in order; schema/lock merges inside | Needs G1+G3 (director-worker imports trust/*) |
| 5 | G5 Trust specialist coverage | `e983c41` | — | Needs G1+G3+G4 (wires director-worker receipts) |
| 6 | G6 M27 GANGZII audio | `ae41561` | — | Needs G1+G3+G4+G5 (audio-worker imports trust/adapters/audio) |
| 7 | G7 M28 reliability | `9a0a9f0d`→`88fa9b3` (11 commits in message order) | Sequential; small adaptations | Needs G6 |
| P | G8 recovery records | `e0254951`, `28e034d`, `9fc1591`, `77230c5` | Yes — one commit acceptable | Yes (any time after base) |
| P | G9 WIP snapshots | `f9d0e33`, `d15b3af`, `4accc6d`, `c472668`, `6d72f15`, `6f0a2b0` | Per-file selection | Yes (owner decision) |
| P | G10 credential-forensics docs | `b85ba9c`, `d2e2dbd` | Pair | Yes (owner sign-off) |

Cannot be transplanted independently: any single commit inside G4 (the six JAZMII commits are a buildable chain: foundation → orchestration → API/UI → verification suite → OOM fix → timeouts), and the M28 priority chain (`A`→`G`+UI+docs — later commits modify earlier modules, e.g. G modifies what A built).

Commits that require adaptation rather than plain cherry-pick:

1. **`826bf8c`** — `prisma/schema.prisma` must be merged with the sanitized M26.2 schema (`99b2470` changed it on the base). Technique D.
2. **`d2d6a4a3`** — director prisma models merge. Technique D.
3. **`f91096e1`** — `package.json` + `bun.lock`: add `hyperframes@0.9.72` onto the sanitized lock (base has M26.2-era deps). Technique D.
4. **`ae41561`** — kokoro-js dep + lock, prisma merge, and **base-file adaptations**: `src/lib/jobs/audio-worker.ts` (contains sanitized hosted-audio-lane code that M27 reworks), `src/lib/adapters/hosted-audio.ts`, `src/components/bean/gangzii.tsx`, `shell.tsx`, `page.tsx`. Technique D.
5. **`2a9b4cb`, `e983c41`, `735ab853`, `ba93dc73`** — touch `audio-worker.ts`/`ffprobe.ts`/`hosted-audio.ts` regions that differ from the old-line base; expect hunk drift. Technique A with fallback B/D.
6. **G2 docs** — reference old-line SHA values (`4114371`, `aba5d4b`, `19a04e9`, `4d134c5`); keep as historical record (recommended) — see owner decisions.

## 4. Required compatibility changes (summary)

- Prisma schema: union of trust models (G1), director models (G4), audio models (G6) with the sanitized M26.2 schema; `prisma validate` + client regen after each schema-bearing group.
- `bun.lock`/`package.json`: three incremental merges (`hyperframes`, `kokoro-js`, plus any transitive drift); re-run install + lockfile check after G4 and G6.
- Worker registration: `director-worker` must be registered in the same registry surface that M26-era `image-worker`/`video-worker` use on the sanitized base (verify at G4 integration; registration surface is part of the shared base).
- `audio-worker.ts` triple-touch: G6 rewrites the GANGZII lane, G5/G7 modify surrounding receipt and loudness code — schedule a dedicated merge review at G6 and G7.
- Navigation/UI: `shell.tsx`/`page.tsx` merges carry the Gangzii Narration Studio + JAZMII Director entries; verify all five product views render (G6/G7 verification).

## 5. Verification after each integration group

| Group | Required verification (from manifest) |
|---|---|
| G1 | `prisma validate` + client regen; trust unit suite (approvals, lifecycle, receipt); tsc/eslint |
| G2 | docs presence; no path collisions |
| G3 | trust resume/checkpoint unit tests; worker registration smoke (image/video/riishe) |
| G4 | director unit suite; HyperFrames pinned-render composition test — real render on CPU |
| G5 | full receipt unit suite incl. director-worker receipts |
| G6 | M27 acceptance re-run: real local Kokoro TTS narration, ffprobe-decoded artifacts, EBU R128 loudness measure |
| G7 | M28 evidence suite: provenance verifier, deterministic ducking, loudness parser, speech-eval corpus run |
| G8–G10 | docs presence; script syntax; fixture-class scan re-run |

Full-application regression is intentionally **not** required per small step (per the milestone's verification policy); the E2E battery runs when the merged tree is verified as a block, and it must use real audio output (mocks are not accepted as the only proof).

## 6. What is explicitly excluded from this milestone

No content is transplanted yet. This milestone only prepares the workspace (`reconcile/sanitized-m27-m28-migration` at `e96d83a`) and the plan. The old-lineage history is never merged into the planning branch; no merge commit is cherry-picked (`ea1e074d`, `e96d83a` excluded from transplant lists).
