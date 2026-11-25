/**
 * BEAN Intelligence — M41 cross-agent artifact handoff (pure).
 *
 * The deterministic contract that turns one agent's VERIFIED output into
 * another agent's input. Handoffs are data, never conversation: there is no
 * agent-to-agent chat loop. Each handoff is a bounded, customer-safe digest
 * of the producer's real artifacts, appended to the consumer's objective by
 * the executor (so the specialist genuinely works from the upstream result).
 *
 * Honesty rules:
 *  - only VERIFIED outputs are handed off (a failed producer's artifacts
 *    never reach a consumer);
 *  - handoffs are size-bounded and sanitized (URLs/titles/snippets only —
 *    no secrets, no backend identities, no local paths);
 *  - the digest is DETERMINISTIC (same inputs → same handoff), so resumes
 *    and retries replay identical instructions.
 *
 * PURE module. SERVER-ONLY consumers.
 */

import type { MissionArtifact } from './types'

export const HANDOFF_SNIPPET_CHARS = 280
export const HANDOFF_MAX_SOURCES = 8
export const HANDOFF_MAX_CHARS = 3800

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`
}

/** Customer-safe URL: strips query strings that may carry ids/tokens. */
export function safeSourceUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return ''
  }
}

export interface HandoffBlock {
  /** The exact text appended to the consumer's objective (bounded). */
  text: string
  /** Number of real sources included (research packs). */
  sourceCount: number
}

/** Research-pack handoff: the consumer (document specialist) works from the
 *  ACTUAL retrieved sources. Deterministic digest, bounded. */
export function researchPackHandoff(artifacts: readonly MissionArtifact[], sources: readonly { url: string; title: string; snippet: string }[]): HandoffBlock {
  const usable = artifacts.filter((a) => a.artifact === 'research-pack')
  if (usable.length === 0) return { text: '', sourceCount: 0 }
  const lines: string[] = ['', 'VERIFIED RESEARCH SOURCES (use only these for factual claims; cite each as [n] with its URL in a Sources section):']
  let count = 0
  const seen = new Set<string>()
  for (const s of sources) {
    if (count >= HANDOFF_MAX_SOURCES) break
    const url = safeSourceUrl(s.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    count += 1
    lines.push(`[${count}] ${clip(s.title, 120)} — ${url}`)
    if (s.snippet) lines.push(`    excerpt: ${clip(s.snippet, HANDOFF_SNIPPET_CHARS)}`)
  }
  if (count === 0) return { text: '', sourceCount: 0 }
  let text = lines.join('\n')
  if (text.length > HANDOFF_MAX_CHARS) {
    text = text.slice(0, HANDOFF_MAX_CHARS - 1) + '…'
  }
  return { text, sourceCount: count }
}

/** Asset-list handoff: names the real artifacts a mission produced (used by
 *  the verification gate and by consumers that reference delivered assets). */
export function assetHandoff(artifacts: readonly MissionArtifact[]): HandoffBlock {
  const usable = artifacts.filter((a) => ['image-asset', 'video-asset', 'audio-asset', 'code-project'].includes(a.artifact))
  if (usable.length === 0) return { text: '', sourceCount: 0 }
  const lines: string[] = ['', 'DELIVERED ARTIFACTS (real outputs of this mission):']
  for (const a of usable.slice(0, 12)) {
    lines.push(`- ${a.artifact}: ${clip(a.label, 160)}`)
  }
  const text = lines.join('\n')
  return { text: text.length > HANDOFF_MAX_CHARS ? text.slice(0, HANDOFF_MAX_CHARS - 1) + '…' : text, sourceCount: 0 }
}

/** Correction handoff: the deterministic "what failed and why" digest a
 *  retry consumer receives (the bounded correction loop's contract). */
export function correctionHandoff(failedReasons: readonly string[]): HandoffBlock {
  if (failedReasons.length === 0) return { text: '', sourceCount: 0 }
  const lines: string[] = ['', 'CORRECTION ROUND — the previous attempt failed verification for concrete reasons; fix exactly these and change nothing else:']
  for (const r of failedReasons.slice(0, 5)) lines.push(`- ${clip(r, 240)}`)
  const text = lines.join('\n')
  return { text: text.length > 1600 ? text.slice(0, 1599) + '…' : text, sourceCount: 0 }
}

/** Enrich a consumer objective with its handoff blocks (bounded to the
 *  mission objective cap). Deterministic. */
export function enrichObjective(objective: string, blocks: readonly HandoffBlock[]): string {
  const parts = blocks.map((b) => b.text).filter((t) => t.length > 0)
  if (parts.length === 0) return objective
  const joined = `${objective}\n${parts.join('\n')}`
  return joined.length <= 8000 ? joined : `${joined.slice(0, 7999)}…`
}
