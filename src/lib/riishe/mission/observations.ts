/**
 * BEAN Intelligence — M44 Phase 5/7: independent observation adapters
 * (SERVER ONLY with pure helpers).
 *
 * These adapters build the Phase-5 ObservationSet from observations gathered
 * by methods INDEPENDENT of the execution path:
 *
 *   - `observationFromFiles` builds file observations from a FRESH store
 *     read performed AFTER the write (the write's own return value is never
 *     the observation);
 *   - `observationFromResearch` builds provenance observations from the
 *     evidence records themselves (re-derived, not the generator's claim);
 *   - `observationFromArtifacts` / `observationFromHttp` shape external
 *     probes (artifact inspectors, HTTP fetchers) for the lanes that have
 *     real checkers.
 *
 * The independence rule: the runner never passes the executor's success
 * response into these adapters — only re-reads and re-derived records.
 */

import type { ObservationSet, FileObservation, ArtifactObservation, HttpObservation, ResearchObservation } from './outcome-verification'

/** Build file observations from a fresh post-execution store read. */
export function observationFromFiles(
  rows: Array<{ path: string; content: string }>,
  checkedPaths: string[],
): ObservationSet['fileSystem'] {
  const fileSystem: Record<string, FileObservation> = {}
  for (const path of checkedPaths) {
    const row = rows.find((r) => r.path === path)
    fileSystem[path] = row
      ? { exists: true, bytes: row.content.length, text: row.content.slice(0, 4000) }
      : { exists: false, bytes: 0 }
  }
  return fileSystem
}

/** Build research provenance observations from the evidence records. */
export function observationFromResearch(sources: Array<{ url: string; title: string; publishedAt?: string | null }>): ResearchObservation {
  return {
    sources: sources.slice(0, 16).map((s) => ({ url: s.url, title: s.title.slice(0, 200), publishedAt: s.publishedAt ?? null })),
  }
}

/** Shape an external artifact inspection into an observation. */
export function observationFromArtifacts(items: Array<{ ref: string; bytes: number; contentType?: string; integrity?: 'valid' | 'invalid' | 'unknown' }>): ObservationSet['artifacts'] {
  const artifacts: Record<string, ArtifactObservation> = {}
  for (const item of items.slice(0, 8)) {
    artifacts[item.ref] = { ref: item.ref, bytes: item.bytes, contentType: item.contentType, integrity: item.integrity ?? 'unknown' }
  }
  return artifacts
}

/** Shape an external HTTP probe into an observation. */
export function observationFromHttp(probes: Array<{ url: string; status: number | null; bodySnippet?: string; healthy?: boolean }>): ObservationSet['http'] {
  const http: Record<string, HttpObservation> = {}
  for (const probe of probes.slice(0, 8)) {
    http[probe.url] = { status: probe.status, bodySnippet: probe.bodySnippet?.slice(0, 500), healthy: probe.healthy }
  }
  return http
}

/** Shape an idempotency-ledger read into an observation. */
export function observationFromIdempotency(entries: Array<{ key: string; runCount: number }>): ObservationSet['idempotency'] {
  const idempotency: Record<string, { runCount: number }> = {}
  for (const entry of entries.slice(0, 8)) {
    idempotency[entry.key] = { runCount: entry.runCount }
  }
  return idempotency
}
