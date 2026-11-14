/**
 * BEAN Intelligence — shared research gateway: prompt-injection defense for
 * retrieved content.
 *
 * Retrieved material is DATA, never instructions. Products already frame
 * every evidence block as untrusted (RIISHE INJECTION_GUARD, GIFTZ techdocs
 * framing); this scanner adds a deterministic second layer:
 *   - control characters are stripped (except newline/tab);
 *   - content that mimics BEAN's internal control syntax (tool-call protocol,
 *     path-tagged code fences, injected system markers) is NEUTERED so it can
 *     never be parsed as protocol if a model echoes it;
 *   - matches are FLAGGED as honest provenance metadata, never silently
 *     dropped (the surrounding text stays intact for citation).
 */

/** Flags returned alongside the sanitized text (observability + UI). */
export interface InjectionScan {
  sanitized: string
  flags: string[]
}

interface InjectionRule {
  id: string
  re: RegExp
}

const INJECTION_RULES: InjectionRule[] = [
  { id: 'instruction-override', re: /\b(?:ignore|disregard|forget)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all)\b[^.\n]{0,20}\b(?:instructions?|prompts?|rules?|directions?)\b/i },
  { id: 'role-hijack', re: /\b(?:you are now|you are actually|act as(?: if)?|from now on,? you are|new instructions?:)\b/i },
  { id: 'system-marker', re: /<\/?(?:system|assistant|developer|tool_result|settings?)>/i },
  { id: 'tool-call-syntax', re: /\bTOOL_CALL\s*:/ },
  { id: 'tool-results-syntax', re: /\bTOOL_RESULTS\b/ },
  { id: 'path-tagged-fence', re: /```[a-zA-Z0-9_+-]*\s+path\s*=/ },
  { id: 'fabricated-citation-directive', re: /\b(?:cite|quote|use)\s+only\s+(?:these|the following|my)\b/i },
  { id: 'credential-solicit', re: /\b(?:api[\s_-]?key|password|secret|token)\b[^.\n]{0,40}\b(?:send|provide|reveal|print|share|paste)\b/i },
]

/** Strip control characters (keep newline + tab) and hard-cap the length. */
export function sanitizeRetrievedText(raw: string, maxChars: number): string {
  const stripped = String(raw ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\r\n/g, '\n')
  return stripped.slice(0, Math.max(1, maxChars))
}

/**
 * Scan + neuter one retrieved text. Idempotent and pure — no network, no I/O.
 * `flags` uses stable rule ids safe for persistence and client display.
 */
export function scanRetrievedText(raw: string, maxChars: number): InjectionScan {
  const sanitizedBase = sanitizeRetrievedText(raw, maxChars)
  // Flags are computed against the ORIGINAL sanitized text (neutering one
  // rule must not hide another rule's match).
  const flags = INJECTION_RULES.filter((rule) => rule.re.test(sanitizedBase)).map((rule) => rule.id)
  if (flags.length === 0) return { sanitized: sanitizedBase, flags }
  // Neuter the MIMICRY, keep the text readable: internal control syntax that
  // could be re-parsed downstream is replaced with an inert variant.
  const neutered = sanitizedBase
    .replace(/\bTOOL_CALL\s*:/gi, '[neutralized tool-call marker]')
    .replace(/\bTOOL_RESULTS\b/gi, '[neutralized tool-results marker]')
    .replace(/```([a-zA-Z0-9_+-]*)\s+path\s*=/g, '```$1 path[neutralized]=')
    .replace(/<\/?(?:system|assistant|developer|tool_result)>/gi, '[neutralized marker]')
  return { sanitized: neutered, flags }
}

/** Compact, client-safe summary for provenance metadata / UI notes. */
export function describeInjectionFlags(flags: string[]): string | null {
  if (flags.length === 0) return null
  return `retrieved content contained ${flags.length} flagged pattern${flags.length === 1 ? '' : 's'} (${flags.join(', ')}); treated as data`
}
