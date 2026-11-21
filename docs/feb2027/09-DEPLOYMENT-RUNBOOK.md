# 09 — Deployment & Rollback Runbook

Companion to the authoritative `docs/M26_OPERATIONS_RUNBOOK.md` and
`docs/operations/OPERATIONS.md` — this file adds the February-2027 Trust
Engine delta and stays consistent with existing conventions. Do not duplicate
operational detail that those documents own.

## Fresh deployment (verified order)

```bash
bun install
bun run db:generate        # prisma generate (Trust Engine models included)
bunx prisma db push        # additive, non-destructive: creates TrustTask, TrustStep,
                           # TrustEvidence, TrustApproval, TrustCheckpoint (2026-11-20 block)
bun run build              # next build + standalone copy
bun run start              # NODE_ENV=production PORT=3000 DATABASE_URL=file:... bun .next/standalone/server.js
# optional standalone workers: bun run workers   (or `bun run worker --product riishe`)
```

Prerequisites per existing runbooks: Bun, Python (LAXII workers), `ffprobe`
(JAZMII), `tesseract` (poster OCR), Linux user namespaces for the CODE GIFTZ
sandbox. Required env names are listed in `docs/HANDOFF.md` §9 (values never
committed).

**Schema discipline:** there is no `prisma/migrations` directory; every
schema change must ship as an additive block (new tables or
nullable/defaulted columns) so `db push` is a non-destructive ALTER. Never
run `db push --accept-data-loss` in deployment. The 2026-11-20 push was
verified additive (new tables only; existing data untouched).

## Single-instance constraint (unchanged)

Breakers, lane managers and engine pools are per-process. Run ONE server
instance against one SQLite database (`connection_limit=1`). Embedded workers
start automatically (`src/instrumentation.ts`); standalone workers are
optional for dedicated hosts.

## Trust Engine operational notes

- Trust tables grow with task activity; receipts are owner-visible. Rows
  cascade on user deletion (GDPR path exercised 2026-11-20).
- Trust recording is best-effort: `trust.record_failed` warnings in the log
  indicate receipt gaps but never break user turns — alert on a rising rate.
- Approvals: decision endpoints are audited (`trust.approval.grant|deny`).
  Grants expire; consumption is atomic; do not add blanket scopes.
- No cron/sweep is required for trust tables in Phase 1 (bounded per task:
  100 steps / 200 evidence / 50 checkpoints); retention policy decisions are
  deferred to the privacy checklist (07 B7) before public beta.

## Rollback

1. **Application rollback:** redeploy the previous standalone build (builds
   are self-contained under `.next/standalone`). The schema is additive —
   an older build simply ignores the new tables; no destructive step needed.
2. **Database:** SQLite file + `storage/` are backed up together (existing
   runbook). Restore the paired pair; never roll back the DB without the
   matching storage.
3. **Trust ledger:** never hand-edit trust rows to "fix" history — the
   receipt digest is designed to expose tampering. Corrective actions go
   through new ledger rows, not edits.
4. **Incident record:** any incident and rollback action is written to the
   ops log with timestamps (existing OPERATIONS.md convention).

## Publication constraint reminder

Deployment ≠ publication. Running this stack privately or in preview is
unaffected by the Git publication freeze; pushing rewritten/published refs
remains blocked until checklist 07-A is green with owner authorization.
