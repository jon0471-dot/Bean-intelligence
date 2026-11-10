# CODE GIFTZ — Conversation Persistence & ChatGPT-Style Sidebar

**Date:** 2026-11-04 · **Commit:** `11a68bc` · **Scope:** the conversation-history system required by §3 of the four-product task.

## 1. What existed before

- **Persistence (already real):** `CodeProject` / `CodeMessage` / `CodeFile` tables (stable IDs, `userId` owner, timestamps, FK cascades, `@@unique([projectId,path])`). Every turn auto-persisted: user row before streaming, assistant row exactly once post-generation (`persistAssistant`), files applied to DB before persist, disconnect-safe completion, `PERSIST_FAILED` honest class when persistence itself fails, failed turns persist no assistant row and the retry collapses the duplicated trailing prompt (`src/lib/giftz/retry.ts`).
- **Restore:** refresh/open rebuilds messages + files from `GET /api/code-giftz/chat/[id]` (owner-checked, 404 on foreign ID).
- **Sidebar (the gap):** a 220px desktop-only "Projects rail" — list, open, hover-delete (instant, no confirmation). No search, no rename, no date grouping, no message counts, no mobile access, no collapse.

## 2. What changed (this task)

**Backend**
- `src/app/api/code-giftz/chat/route.ts` — `GET` now accepts `?q=`: scans the 200 most recent of the user's projects and applies the **shared** `filterConversationsByTitle` (JS lowercase — SQLite `LIKE` is ASCII-only; a search missing non-ASCII titles would be a correctness bug), capped at 50; recent list raised 30 → 50 to feed grouped sections. Same shape + `query` echo.
- `src/app/api/code-giftz/chat/[id]/route.ts` — new `PATCH` rename: `requireUser` → owner check (404 foreign) → `sanitizeConversationTitle` (same pure helper RIISHE uses: trim, collapse whitespace, cap 120, never blank) → update. Renaming bumps `updatedAt`, so the conversation rises in recents (expected ChatGPT-style behavior). No schema migration needed — `CodeProject.title` already exists.

**Frontend**
- New `src/components/bean/code-giftz-sidebar.tsx`: `GiftzSidebarBody` (shared by desktop rail and mobile drawer), `GiftzSidebarCollapsedRail`, `GiftzSidebarMobile` (Sheet), `GiftzSidebarMobileTrigger`.
  - **New conversation** button; **search** input (250ms debounce → server `?q=`; clear restores recents; honest "No conversations match …" empty state).
  - **Date-grouped history** via the shared `conversationSidebarSections` (Today / Yesterday / Previous 7 days / Previous 30 days / Older — local-calendar buckets).
  - **Rows**: title (truncate + tooltip), `N messages · N files · timeAgo`, active highlight, keyboard-operable (`role="button"`, Enter/Space, focus ring).
  - **Rename**: options menu + Dialog with Save/Cancel, honest failure text, Enter-to-submit.
  - **Delete with confirmation**: hover trash (desktop) and menu path (always visible on touch) both open an AlertDialog naming the conversation and its cascade ("…and all of its messages and workspace files will be permanently removed"); a failed delete keeps the dialog open with the error — it never silently lies.
  - `stopPropagation` on every row action; dialogs render inside the drawer body so closing the Sheet can never unmount a dialog mid-interaction.
  - **Desktop collapse** (48px icon strip with expand + new-conversation), **mobile Sheet drawer** (`<lg`) that closes only after a successful action.
- `src/components/bean/code-giftz.tsx`: debounced search state, `renameProject`/`deleteProject` returning `Promise<SidebarActionResult>` (honest `{ok,error}`), grid column switches `220px ↔ 48px`, header trigger for the mobile drawer. Workspace, editor, diffs, sandbox, preview untouched.

## 3. Acceptance tests (§3 list) — results

| # | Test | Result |
|---|---|---|
| 1 | Create a conversation | PASS — real turn created project (sidebar showed "1 message · 0 files · just now") |
| 2 | Multiple messages / streamed response | PASS for transport & persistence mechanics (unit: `giftz-chat-stream.test.ts`, `giftz-streaming.test.ts`); **real streamed answer this session: BLOCKED by upstream 429** (see acceptance report) |
| 3 | Refresh → reopen → exact ordering | PASS — `openProject` restores full history; unit-pinned; verified live after reload |
| 4 | Rename | PASS — live: renamed → list updated; API 200 |
| 5 | Search | PASS — live: "greeting" matched; no-match state rendered; clear restored recents |
| 6 | Delete | PASS — live: Cancel kept the conversation; confirmed delete removed it ("No conversations yet") |
| 7 | Cross-user isolation | PASS — intruder `GET /api/code-giftz/chat/[id]` → 404 (acceptance run); ownership re-checked on every route |

## 4. Tests added & executed

`tests/unit/giftz-sidebar.test.ts` — 24 tests (source pins for the routes' shared-filter/sanitizer/owner checks, dialog/confirmation/search pins, SSR renders of grouped sections + empty state, collapse/mobile drawer wiring, honest result contract). Full suite after change: **1018 pass / 0 fail / 64 files**. eslint 0 on all changed files; tsc: no new errors.

## 5. Known limitations / follow-ups

- Title remains the first-prompt slice until renamed (no LLM auto-titling — deliberately out of scope; rename covers the need).
- Sandbox runs JS/TS only; process-level isolation (documented, not a VM).
- Search matches titles only (not message bodies) — same as RIISHE.
- No per-message regenerate/branch (RIISHE has it; GIFTZ retry re-sends the last prompt).

## 6. Rollback

Revert commit `11a68bc` (single commit; no DB migration → no data risk). The PATCH endpoint and search parameter simply disappear; existing `CodeProject` data is untouched.
