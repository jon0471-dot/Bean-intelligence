/**
 * BEAN Intelligence — CODE GIFTZ refactoring intent detection (M25).
 *
 * PURE + DETERMINISTIC. Recognizes multi-file REFACTORING requests in chat
 * and resolves them against the REAL project files — composing with (never
 * hijacking) the M23 file-operation detector, which runs FIRST in the chat
 * route: a plain "move X to Y" stays an M23 file operation, while refactoring
 * verbs ("extract", "consolidate", "service layer", "reorganize", rename a
 * SYMBOL, "move … and update imports") route here.
 *
 * Resolution ladder (conservative):
 *   - rename requests resolve the symbol against the project's symbol index;
 *     zero/ambiguous matches → focused clarification;
 *   - move-module requests require explicit import-update intent ("update
 *     imports", "reorganize", "restructure") to leave M23's simpler move;
 *   - extract/consolidate/service-layer requests resolve a scope from named
 *     files or the unique component/service-shaped candidates; an
 *     unresolvable scope → clarification naming the candidates;
 *   - anything prose-shaped falls through ({ detected: false }) to the normal
 *     model turn — a code-edit request is NEVER hijacked into a refactor.
 */
import { buildProjectGraph, type ProjectGraph } from './graph'
import { FileOpError } from '@/lib/code/file-ops/types'
import { planMoveModule, planRenameSymbol, type RefactorKind, type RefactorPlan } from './plan'

export type RefactorDetection =
  | { detected: false }
  | { detected: true; type: 'clarification'; question: string }
  | {
      detected: true
      type: 'op'
      kind: RefactorKind
      /** Deterministic parameters (rename symbol/new name; move sources/destination). */
      symbol?: string
      newName?: string
      sources?: string[]
      destination?: string
      /** Scope roots for assisted drafting. */
      scopeRoots?: string[]
      /** The user's raw request text (passed to the drafting prompt). */
      request: string
    }

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Token candidate → project paths whose basename/stem matches it. */
function matchPathToken(token: string, files: Array<{ path: string }>): string[] {
  const clean = token.replace(/[`'"]/g, '').trim().replace(/\/+$/, '')
  if (!clean) return []
  const exact = files.filter((f) => f.path === clean || f.path === `${clean}.ts` || f.path === `${clean}.tsx` || f.path === `${clean}.js` || f.path === `${clean}.jsx`)
  if (exact.length > 0) return exact.map((f) => f.path)
  const byFolder = files.filter((f) => f.path.startsWith(`${clean}/`))
  if (byFolder.length > 0) return byFolder.map((f) => f.path)
  const base = basenameOf(clean)
  const byBase = files.filter((f) => basenameOf(f.path) === base || basenameOf(f.path).replace(/\.[a-z]+$/i, '') === base)
  return byBase.map((f) => f.path)
}

const RENAME_RE =
  /rename\s+(?:the\s+|this\s+)?(?:function\s+|method\s+|const(?:ant)?\s+|variable\s+|class\s+|component\s+|symbol\s+|type\s+|interface\s+|hook\s+)?[`'"]?([A-Za-z_$][\w$]*)[`'"]?(?:\s+(?:function|method|const(?:ant)?|variable|class|component|symbol|type|interface|hook))?\s+(?:to|into|as)\s+[`'"]?([A-Za-z_$][\w$]*)[`'"]?/i
const RENAME_RE_FRONT =
  /(?:let's\s+|please\s+)?rename\s+[`'"]?([A-Za-z_$][\w$]*)[`'"]?\s+(?:to|into|as)\s+[`'"]?([A-Za-z_$][\w$]*)[`'"]?/i

const MOVE_IMPORTS_RE =
  /(?:move|moving)\s+(?:all\s+|the\s+|these\s+)?(?:the\s+)?[`'"]?([\w./-]+)[`'"]?(?:\s+file|\s+module|\s+folder|\s+modules)?[^.\n]{0,80}?(?:to|into|under)\s+(?:the\s+|a\s+|an\s+|my\s+)?[`'"]?([\w./-]+)[`'"]?[^.\n]{0,80}?import|update\s+(?:all\s+|the\s+)?(?:affected\s+)?imports?\s+(?:after\s+)?(?:moving|moved|to\s+move)/i
// M26 (audit R-3): restructure/consolidate detection previously matched ANY
// message containing the stem ("help me restructure this function") — an
// ordinary PROSE-shaped edit request was hijacked into a multi-file plan.
// Folder/project-shaped intent is now required (structure of FILES, not of
// a function's code).
const RESTRUCTURE_RE = /(?:reorganiz|restructur|rearrang)\w*\s+(?:the\s+|this\s+|my\s+|our\s+)?(?:project|folder|directory|codebase|repo(?:sitory)?|file\s+structure|folder\s+structure|directory\s+structure|components?\s+structure|src\b)|clean(?:er)?\s+(?:folder|project|directory)\s+structure|restructure\s+the\s+project/i
const EXTRACT_COMPONENT_RE = /extract\s+(?:the\s+|this\s+|that\s+)?(?:(?:reusable|shared|entire|whole)\s+)?(?:[\w-]+\s+){0,2}(?:component|section|markup|card|widget|panel|modal|header|footer|sidebar|form)/i
const EXTRACT_MODULE_RE = /extract\s+(?:the\s+|this\s+|that\s+)?(?:[\w-]+\s+){0,2}(?:function|logic|module|helpers?|utils?|hook|class)/i
const SERVICE_RE = /service\s+layer|move\s+all\s+(?:the\s+)?api\s+calls|separate\s+(?:the\s+)?(?:business\s+)?logic\s+from\s+(?:the\s+)?(?:presentation|ui)|extract\s+(?:the\s+)?api\s+(?:calls?|logic)|api\s+layer|data\s+access\s+layer/i
// M26 (audit R-3b): the bare `consolidat`/`deduplicat` stems hijacked
// function-level prose ("consolidate these two functions") into a multi-file
// plan. Detection now requires the structural object phrasing (shared
// components/modules, duplicated UI blocks, folder-scoped consolidation).
const CONSOLIDATE_RE = /consolidat\w*\s+(?:the\s+|these\s+|all\s+)?(?:duplicate[ds]?(?:\s+\w+){0,3}\s+(?:components?|modules?|files|utils?|helpers?|hooks?|pages?|routes?)|shared\s+\w+|(?:ui\s+)?(?:elements?|components?|blocks?|sections?|markup)\s+(?:into|to))|deduplicat\w*\s+(?:the\s+|these\s+|all\s+)?(?:components?|modules?|files|utils?|helpers?|hooks?|pages?|routes?|code\s+across)|(?:convert|turn|combine|merge)\s+(?:these\s+|the\s+)?(?:repeated|duplicate|similar|common)\s+(?:[\w-]+\s+){0,2}(?:ui\s+)?(?:elements?|components?|blocks?|sections?|markup)\s+(?:into|to)\s+(?:a\s+)?shared|(?:create|make)\s+(?:a\s+)?(?:shared|common|single)\s+(?:component|module)\s+(?:for|out of)/i

const INTO_FILE_RE = /(?:into|in|as|to)\s+(?:its\s+own|a\s+|an?\s+)?(?:separate\s+|new\s+|dedicated\s+|own\s+)?(?:file|module|component|service|folder|directory)/i

/**
 * Detect a refactoring intent. `graph` may be provided by the caller
 * (incremental reuse); otherwise it is built from the files.
 */
export function detectRefactoringRequest(message: string, files: Array<{ path: string; content: string }>, graph?: ProjectGraph): RefactorDetection {
  if (files.length === 0) return { detected: false }
  const text = message.trim()
  if (text.length < 8) return { detected: false }
  const g = graph ?? buildProjectGraph(files)

  // ---- rename-symbol ---------------------------------------------------------
  const renameMatch = RENAME_RE.exec(text) ?? RENAME_RE_FRONT.exec(text)
  if (renameMatch) {
    const [, symbol, newName] = renameMatch
    // Resolve the symbol against the REAL symbol index.
    const holders = [...g.nodes.values()].filter((n) => n.symbols.some((s) => s.name === symbol))
    if (holders.length === 0) {
      // A file-op rename (M23) handles file renames; a symbol that does not
      // exist falls through to the model turn (maybe the user means a file).
      return { detected: false }
    }
    if (holders.length > 1) {
      return {
        detected: true,
        type: 'clarification',
        question: `"${symbol}" is declared in ${holders.map((h) => h.path).join(', ')} — which one should be renamed to "${newName}"?`,
      }
    }
    return { detected: true, type: 'op', kind: 'rename-symbol', symbol, newName, request: text }
  }

  // ---- service-layer ----------------------------------------------------------
  if (SERVICE_RE.test(text)) {
    const named = matchPathToken(/(?:from|in)\s+[`'"]?([\w./-]+)[`'"]?/i.exec(text)?.[1] ?? '', files)
    const scopeRoots = named.length > 0 ? named : [...g.nodes.values()].filter((n) => n.kind === 'service' || n.kind === 'component' || n.kind === 'page').map((n) => n.path).slice(0, 12)
    if (scopeRoots.length === 0) {
      return { detected: true, type: 'clarification', question: 'Which files contain the API calls / business logic you want moved into a service layer?' }
    }
    return { detected: true, type: 'op', kind: 'service-layer', scopeRoots, request: text }
  }

  // ---- consolidate --------------------------------------------------------------
  if (CONSOLIDATE_RE.test(text)) {
    const named = matchPathToken(/(?:in|from)\s+[`'"]?([\w./-]+)[`'"]?/i.exec(text)?.[1] ?? '', files)
    if (named.length > 0) {
      return { detected: true, type: 'op', kind: 'consolidate', scopeRoots: named, request: text }
    }
    // Fall through to the drafting stage with the whole component surface —
    // the provider draft is validated against scope, and the plan card shows
    // exactly what changes.
    const candidates = [...g.nodes.values()].filter((n) => n.kind === 'component' || n.kind === 'page').map((n) => n.path)
    if (candidates.length === 0) {
      return { detected: true, type: 'clarification', question: 'I could not find component files to consolidate — which files contain the repeated structures?' }
    }
    return { detected: true, type: 'op', kind: 'consolidate', scopeRoots: candidates.slice(0, 12), request: text }
  }

  // ---- extract-component / extract-module -----------------------------------------
  const extractComponent = EXTRACT_COMPONENT_RE.test(text)
  const extractModule = !extractComponent && EXTRACT_MODULE_RE.test(text) && INTO_FILE_RE.test(text)
  if (extractComponent || extractModule) {
    const kind: RefactorKind = extractComponent ? 'extract-component' : 'extract-module'
    // Scope resolution order: an explicit `from <path>` clause (path-shaped
    // token) wins; then the generic token after the verb; then candidates.
    const STOP_WORDS = /^(the|a|an|this|that|its|it|own|every|each|all|their|them)$/i
    let named: string[] = []
    const fromMatch = /from\s+[`'"]?([\w./@-]+)[`'"]?/i.exec(text)
    if (fromMatch && !STOP_WORDS.test(fromMatch[1])) named = matchPathToken(fromMatch[1], files)
    if (named.length === 0) {
      const tokenMatch = /(?:extract|from)\s+(?:the\s+|this\s+|that\s+)?(?:component|section|markup|card|widget|panel|modal|header|footer|sidebar|form|function|logic|helpers?|hook)?\s*[`'"]?([\w./-]+)[`'"]?/i.exec(text)
      if (tokenMatch && !STOP_WORDS.test(tokenMatch[1])) named = matchPathToken(tokenMatch[1], files)
    }
    if (named.length === 1) {
      return { detected: true, type: 'op', kind, scopeRoots: named, request: text }
    }
    if (named.length > 1) {
      return {
        detected: true,
        type: 'clarification',
        question: `Several files match — which one should I extract from: ${named.slice(0, 6).join(', ')}?`,
      }
    }
    const candidates = [...g.nodes.values()]
      .filter((n) => (extractComponent ? n.kind === 'component' : n.kind === 'service' || n.kind === 'util'))
      .sort((a, b) => b.importedByCount - a.importedByCount)
    if (candidates.length === 0) {
      return { detected: true, type: 'clarification', question: 'Which file contains the code you want extracted?' }
    }
    return { detected: true, type: 'op', kind, scopeRoots: candidates.slice(0, 6).map((n) => n.path), request: text }
  }

  // ---- restructure -----------------------------------------------------------------
  if (RESTRUCTURE_RE.test(text)) {
    const candidates = [...g.nodes.values()].map((n) => n.path)
    return { detected: true, type: 'op', kind: 'restructure', scopeRoots: candidates.slice(0, 20), request: text }
  }

  // ---- move-module (only when import-update intent is explicit) ---------------------
  if (MOVE_IMPORTS_RE.test(text)) {
    const m = /(?:move|moving)\s+(?:all\s+|the\s+|these\s+)?(?:the\s+)?[`'"]?([\w./-]+)[`'"]?[^.\n]{0,80}?(?:to|into|under)\s+(?:the\s+|a\s+|an\s+|my\s+)?[`'"]?([\w./-]+)[`'"]?/i.exec(text)
    if (m) {
      const token = m[1].replace(/[`'"]/g, '').trim().replace(/\/+$/, '')
      // M26 (audit R-2): a bare token matching MULTIPLE file basenames (two
      // `hero.tsx` in different folders) previously collected ALL of them as
      // move sources — one plan silently moved both. The plan card's
      // "never guesses" contract requires a clarification instead.
      const exact = files.filter((f) => f.path === token || f.path === `${token}.ts` || f.path === `${token}.tsx` || f.path === `${token}.js` || f.path === `${token}.jsx`)
      const byFolder = exact.length === 0 ? files.filter((f) => f.path.startsWith(`${token}/`)) : []
      if (exact.length === 0 && byFolder.length === 0) {
        const base = basenameOf(token)
        const byBase = files.filter((f) => basenameOf(f.path) === base || basenameOf(f.path).replace(/\.[a-z]+$/i, '') === base)
        if (byBase.length > 1) {
          const list = byBase.slice(0, 6).map((f) => f.path).join('\n')
          return {
            detected: true,
            type: 'clarification',
            question: `"${m[1]}" matches ${byBase.length} files:
${list}
Which one should move into ${m[2]}?`,
          }
        }
      }
      const sources = matchPathToken(m[1], files)
      if (sources.length === 0) {
        return { detected: true, type: 'clarification', question: `I could not find "${m[1]}" in this project — which file(s) or folder should move into ${m[2]}?` }
      }
      return { detected: true, type: 'op', kind: 'move-module', sources, destination: m[2].replace(/[`'"]/g, ''), request: text }
    }
  }

  return { detected: false }
}

/** Build the deterministic plan for a detected refactoring op (no provider). */
export function buildDeterministicRefactorPlan(
  detection: Extract<RefactorDetection, { type: 'op' }>,
  files: Array<{ path: string; content: string }>,
): RefactorPlan {
  if (detection.kind === 'rename-symbol') {
    return planRenameSymbol(files, { symbol: detection.symbol as string, newName: detection.newName as string })
  }
  if (detection.kind === 'move-module') {
    return planMoveModule(files, { sources: detection.sources as string[], destination: detection.destination as string })
  }
  throw new FileOpError('INVALID', `${detection.kind} is a provider-assisted operation and has no deterministic builder.`)
}
