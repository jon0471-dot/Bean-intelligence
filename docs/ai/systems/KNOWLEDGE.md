# KNOWLEDGE — Research & Retrieval

**Status: implemented. BEAN's research substrate: live retrieval lanes, evidence pipeline and the Knowledge Atlas.**

## 1. Purpose and responsibilities

KNOWLEDGE is the specialist name for BEAN's research and retrieval machinery:
the automatic research pipeline behind RIISHE and agent turns, the bounded
retrieval tools, and the curated Knowledge Atlas. The M41 mission planner
routes `research` and `knowledge` tasks to this capability.

## 2. Actual architecture

- **Research pipeline** — `src/lib/research/pipeline.ts`: multi-query planning,
  execution, dedupe, ranking (`rank.ts`), freshness (`freshness.ts`),
  contradiction reasoning, claim verification, and an evidence pack with
  numbered sources; never-throwing by contract (failures land in degraded
  notes).
- **Live lanes** — `web_search` / `read_url` tools with the shared research
  gateway; the Agent Reach lane (`src/lib/research/reach/`) adds
  rate-limited, audited retrieval channels.
- **Knowledge Atlas** — deterministic section search + paged reads over the
  license-registered library in `docs/knowledge-atlas/` via
  `search_atlas` / `read_atlas_doc` (a local, instant complement to live
  search — never a replacement).
- **Document retrieval** — `search_document` (pinned local ONNX embedding +
  rerank lanes with honest-unavailable fallback to paging), `read_document`.

## 3. Source-code locations

| Concern | Path |
|---|---|
| Pipeline + policy | `src/lib/research/{pipeline,policy,provider,direct}.ts` |
| Ranking/freshness/claims | `src/lib/research/{rank,freshness,claim-verification,contradiction-reasoning}.ts` |
| Reach channels | `src/lib/research/reach/` |
| Atlas tools | `src/lib/riishe/tools/` (`search_atlas`, `read_atlas_doc`), library in `docs/knowledge-atlas/` |
| Evidence memory | `src/lib/riishe/evidence-memory.ts`, Prisma `EvidenceKnowledge` |
| Mission integration | `src/lib/riishe/mission/planner.ts` (`research`/`knowledge` kinds) |

## 4. Model and provider integration

Search/page reads run through the configured gateway channels; embeddings and
reranking use pinned local ONNX lanes when installed (honest unavailable
otherwise). No hidden paid search fallback.

## 5. Input/output contracts

Pipeline output: an `EvidencePack` (numbered sources with titles/hosts/dates,
degraded notes, staleness). Tool outputs feed the citation universe with
allocated source ids — the answer's citations can only cite real, numbered
sources.

## 6. Tools and permissions

`web_search` / `read_url` / `search_atlas` / `read_atlas_doc` /
`search_document` / `read_document` are standard-permission tools gated by
the per-turn tool-selection policy; Reach channels apply per-user rate
limits and audit records.

## 7. Data and memory handling

No conversation data leaves the owner scope; retrieved sources are cited, not
persisted as user data unless stored as evidence knowledge
(`EvidenceKnowledge`, owner-scoped, with independence groups + freshness
status).

## 8. Execution workflow

warrant decision (`policy.ts`) → optional semantic confirm → query set →
parallel lane execution → dedupe/rank/freshness → contradiction checks →
evidence pack → prompt grounding with the injection guard.

## 9. Existing tests and verification

`tests/unit/auto-grounding.test.ts` (injected transport), `riishe-retrieval-
lanes.test.ts`, `claim-grounding.test.ts`, `riishe-atlas-tools.test.ts`,
`research-quality-integration.test.ts`, `files-pipeline.test.ts`, plus the
quota-free health probes (`chat-recovery-quota.test.ts`).

## 10. Failure handling and fallback behavior

Every tool failure lands in the pack's degraded notes; an out-of-contract
explosion cannot abort core chat generation (P0 R4 isolation); authoritative
zero-results is distinguished from outage; breakers open on repeated
failures with real reset timing.

## 11. Current implemented capabilities

Automatic multi-source research with citations; freshness reasoning;
contradiction surfacing; claim verification; Atlas consultation; document
embedding retrieval; mission research tasks; Agent Reach audited channels.

## 12. Partial capabilities and known limitations

Semantic auto-routing needs its runtime assets for live measurement (unit
tests pin the seam); local embedding lanes require pinned ONNX assets;
paywalled/private sources are unreachable and stated as such.

## 13. Planned capabilities (NOT implemented)

Deeper multi-hop research planning; user-curated private knowledge bases —
roadmap only.
