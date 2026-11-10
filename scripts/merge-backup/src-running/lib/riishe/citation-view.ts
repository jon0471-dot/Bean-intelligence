/**
 * BEAN Intelligence — RIISHE citation rendering (pure, unit-testable).
 *
 * Turns [n] markers whose source actually exists in the retrieved set into
 * in-page citation links. Markers with no matching source are left untouched
 * — the UI never fabricates a working citation out of a dangling number.
 */

export interface CitableSourceView {
  id: number
}

export function linkifyCitations(content: string, sources?: CitableSourceView[]): string {
  if (!sources?.length) return content
  return content.replace(/\[(\d{1,2})\]/g, (m, n: string) => {
    const id = Number(n)
    return sources.some((s) => s.id === id) ? `[${n}](#bean-src-${id})` : m
  })
}
