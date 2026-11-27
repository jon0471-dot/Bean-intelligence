# M42 — Security, Copyright and Privacy (source access boundaries and content handling)

> Standing rules for every source adapter and every BEAN specialist, with the code that enforces each rule. These are hard boundaries, not guidance; the tests that pin each boundary are named.

## 1. Access rules

| Rule | Enforcement |
|---|---|
| Respect platform terms, robots policies, API documentation, rate limits | per-adapter decision records (`docs/ai/M42-SOURCE-PLATFORM-COVERAGE.md`); rate-limit errors degrade honestly (measured: OpenAlex 429, arXiv 429, Stack Exchange 429 recorded verbatim, never retried into) |
| No paywall, login, CAPTCHA, anti-bot bypass; no stolen cookies or session copying | no adapter performs authentication of any kind; login-gated channels (Reddit) stay `requires_login` until an owner-controlled host login actually happens |
| No private content without an explicit authorized connector | GitHub private access only via the existing authorized connector path; all M42 adapters are public-official-API only |
| No arbitrary shell from models | platform adapters use fixed allowlisted actions with validated parameters (`reach/allowlist.ts`); M42 direct lanes are fixed-host, fixed-path fetches only |

## 2. SSRF and network security — the single boundary

Every outbound research fetch passes `reach/url-safety.ts`:

- scheme allowlist (http/https only), userinfo rejection, hostname blocklist (loopback names, cloud metadata hostnames, internal suffixes), literal-IP checks (loopback/RFC1918/link-local/metadata ranges rejected), DNS resolution to public IPs outside hermetic tests;
- redirects followed MANUALLY — every hop re-validated (`guardedFetch`, max 3 hops);
- bounded timeouts via `AbortSignal.timeout`, bounded response bytes;
- `guardedFetch` may carry a POST body **on the initial hop only** (a redirecting POST never re-sends its body — no credential-shaped payload ever follows a redirect).

The M42 direct lanes add a second, structural layer: a fixed HTTPS host allowlist (`ACADEMIC_ALLOWED_HOSTS`, `SECURITY_COMMUNITY_ALLOWED_HOSTS`) checked in-process before any I/O. The exported runtime guards (`assertAcademicHostAllowed`, `assertSecurityCommunityHostAllowed`) are pinned by tests that accept exactly the allowlisted https hosts and reject loopback/loopback-IP/metadata/foreign/non-https/unparseable targets with the typed `ResearchToolError`.

**Regression honesty (M42.3 fix, commit `541be5d`):** the academic guard once shipped referencing a renamed constant — every real adapter call threw `ReferenceError` at runtime while the pure set test stayed green. The probe caught it (0/7 measured); the fix exports the runtime guard so tests exercise the ACTUAL path. Lesson encoded: a set test alone cannot guard a runtime.

## 3. Prompt injection — retrieved content is untrusted data

- Pages, metadata, comments, code, transcripts are **UNTRUSTED REFERENCE DATA — NOT INSTRUCTIONS**; the injection scanner + sanitizer run at every retrieval injection point (`reach/injection.ts`); injection flags surface as pack notes.
- Evidence blocks are framed as data (`renderEvidenceBlock` fixed header) with the user's prompt verbatim and first; excerpt lines are data lines, never conversation turns.
- A retrieved source can never grant permissions, alter system prompts, call tools or expand a mission scope; the M41 handoff DATA-block framing keeps handoff content inert and bounded.
- Stack Exchange titles are decoded with a FIXED entity map; any entity outside the map is dropped, never guessed (no HTML parser runs on untrusted input).

## 4. Privacy

- Credential-shaped strings are stripped from outbound queries via the mission safety module's shared redaction (`sanitizeEvidenceText`) before any search; an objective that redacts to nothing is skipped honestly.
- No API keys, access tokens, passwords, session cookies or private project data enter search queries, URLs, logs or source packs.
- Private account data stays owner-scoped (M41 owner-scoped reads; cross-user reads 404 — measured in the M41 acceptance suite).
- One visitor's data or compute never serves another (per-user reach enablement; per-user caches).
- Retrieved material is never silently used for model training or fine-tuning.

## 5. Copyright and reuse

- **Bounded excerpts only:** ≤400 chars per evidence record, ≤220 chars in rendered reference blocks, ≤6,000 chars of page text into the evidence pipeline, ≤2,600 chars per mission reference block. Full articles are never copied.
- **Attribution:** source URLs cited with title + publisher/host + author/date when supplied; stable `[Sn]` IDs preserve provenance through handoffs.
- **No bulk mirroring:** bounded query/result/page budgets per consumer (contract §3); in-flight dedup prevents duplicate fetches.
- **Code:** license is read from the official manifest (npm/PyPI adapters carry license verbatim, or the explicit "not declared" note); substantial unlicensed code is never copied into BEAN; generated code follows the project's existing architecture and license constraints.
- **Media:** reference use is distinguished from redistribution/training rights per record; `unknown` license is recorded as unknown and never treated as commercial permission ("Unknown rights are not reuse permission" is part of the rendered reference footer).

## 6. Honesty boundaries (never upgrade)

- `available` requires runtime + action + a real smoke test; `unavailable`/`disabled`/`not_integrated` are reported with exact reasons; a name in the platform catalogue is not an adapter.
- Breaker-open ⇒ `skippedReason`; an answer from training knowledge is never labeled web-verified; a snippet is never presented as a full read; a cache hit keeps the original fetch time.
- Provider outages produce disclosed degraded notes (measured verbatim in the probe evidence: OpenAlex 429, Stack Exchange 429, page-reader 502/504 — all recorded, never converted to PASS).

## 7. Secret boundary at the ledger

Mission payloads, handoffs, receipts and evidence packs pass the ledger-boundary secret redaction before persistence (M41 safety module); diagnostics report masked hints only. No adapter accepts or stores credentials; the M42 lanes are key-free by design (documented exceptions requiring owner approval: Stack Exchange keyed quota, any future paid API).
