/**
 * BEAN Intelligence — CODE GIFTZ file-operation intent detection (M23).
 *
 * PURE + DETERMINISTIC. Resolves a natural-language request into a structured
 * file-operation intent AGAINST THE REAL PROJECT FILE LIST — never against
 * model output, never against client input. The resolution ladder is
 * conservative:
 *   - exact path > folder prefix > unique basename > unique basename without
 *     extension > word-overlap candidates (deletion only);
 *   - zero candidates and prose-shaped targets fall through to the normal
 *     model turn (a code-edit request is NOT hijacked);
 *   - ambiguous or unresolvable EXPLICIT operation requests produce a focused
 *     clarification instead of a guess.
 *
 * A message that contains a code fence is a content edit — EXCEPT the
 * explicit-content create shape (one pasted path-tagged fence + a create
 * request naming that same path), which is a real create operation.
 */
import { assertSafeProjectPath, parseFiles } from '@/lib/giftz/workspace'
import type { FileOpKind } from './types'

export type ResolvedTarget = {
  path: string
  isFolder: boolean
}

export type RawIntent = {
  kind: Extract<FileOpKind, 'rename' | 'move' | 'delete' | 'create' | 'batch-move' | 'batch-rename'>
  /** Resolved source targets (batch kinds list every file explicitly). */
  sources: ResolvedTarget[]
  /** Destination token as resolved (folder or full target path). */
  destination?: string
  /** True when a create intent targets a folder (not a file). */
  createIsFolder?: boolean
  /** Explicit content supplied for a create-file intent (path-tagged fence). */
  createContent?: string
  /** Naming convention for batch-rename. */
  convention?: string
  /** Extension filter for batch-rename (e.g. '.ts'). */
  extensionFilter?: string
}

export type Detection =
  | { detected: false }
  | { detected: true; type: 'clarification'; question: string }
  | { detected: true; type: 'explain'; intent: RawIntent }
  | { detected: true; type: 'op'; intent: RawIntent }

// ---- path normalization -----------------------------------------------------

/**
 * Normalize a user/model-provided path token into a project-relative path.
 * Throws FileOpError-shaped errors for traversal-shaped input (the caller
 * re-validates through assertSafeProjectPath as defense in depth).
 */
export function normalizeProjectPath(raw: string): string {
  let p = raw.trim()
  // Strip wrapping quotes / backticks the chat message may carry.
  if (
    (p.startsWith('"') && p.endsWith('"')) ||
    (p.startsWith("'") && p.endsWith("'")) ||
    (p.startsWith('`') && p.endsWith('`'))
  ) {
    p = p.slice(1, -1).trim()
  }
  p = p.replace(/\/+$/, '') // trailing slash → folder token shape, path itself clean
  p = p.replace(/^\.\//, '') // leading './' is project-root relative
  p = p.replace(/\/{2,}/g, '/')
  if (p.length === 0 || p === '.') throw new Error('EMPTY_PATH')
  if (p.includes('..') || p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p)) {
    throw new Error(`Unsafe project file path rejected: ${p.slice(0, 80)}`)
  }
  assertSafeProjectPath(p)
  return p
}

/** All file paths under a folder prefix. */
export function expandFolder(prefix: string, files: Array<{ path: string }>): string[] {
  const withSlash = prefix.endsWith('/') ? prefix : `${prefix}/`
  return files.filter((f) => f.path.startsWith(withSlash)).map((f) => f.path)
}

export function isFolderPath(prefix: string, files: Array<{ path: string }>): boolean {
  const withSlash = prefix.endsWith('/') ? prefix : `${prefix}/`
  return files.some((f) => f.path.startsWith(withSlash))
}

const KNOWN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.css', '.scss', '.json', '.py', '.html', '.md', '.txt', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.yml', '.yaml']

// ---- target resolution ------------------------------------------------------

export type Resolution =
  | { ok: true; target: ResolvedTarget }
  | { ok: false; reason: 'no-match' | 'ambiguous'; candidates: string[] }

/**
 * Resolve one path token against the real file list (the resolution ladder).
 * Pure — the caller decides what a failure means for each operation kind.
 */
export function resolveTarget(token: string, files: Array<{ path: string }>): Resolution {
  const candidates: string[] = []
  let path: string
  try {
    path = normalizeProjectPath(token)
  } catch {
    return { ok: false, reason: 'no-match', candidates: [] }
  }

  // 1. exact file match
  if (files.some((f) => f.path === path)) return { ok: true, target: { path, isFolder: false } }
  // 2. folder prefix
  if (isFolderPath(path, files)) return { ok: true, target: { path, isFolder: true } }

  const base = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path

  // 2b. unique folder BASENAME ("the components folder" → src/components)
  const folderBaseMatches = allFolderPaths(files).filter(
    (p) => p.slice(p.lastIndexOf('/') + 1) === base,
  )
  if (folderBaseMatches.length === 1) {
    return { ok: true, target: { path: folderBaseMatches[0], isFolder: true } }
  }
  if (folderBaseMatches.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: folderBaseMatches.slice(0, 6) }
  }

  // 3. unique basename match
  const byBase = files.filter((f) => f.path.slice(f.path.lastIndexOf('/') + 1) === base)
  if (byBase.length === 1) return { ok: true, target: { path: byBase[0].path, isFolder: false } }
  if (byBase.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: byBase.map((f) => f.path).slice(0, 6) }
  }

  // 4. unique basename without extension ("rename App to Dashboard")
  const byStem = files.filter((f) => {
    const b = f.path.slice(f.path.lastIndexOf('/') + 1)
    const dot = b.lastIndexOf('.')
    return dot > 0 && b.slice(0, dot) === base
  })
  if (byStem.length === 1) return { ok: true, target: { path: byStem[0].path, isFolder: false } }
  if (byStem.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: byStem.map((f) => f.path).slice(0, 6) }
  }

  // 5. word-overlap candidates (grounded suggestions, never auto-picked)
  const words = base.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3)
  if (words.length > 0) {
    const overlaps = files.filter((f) => {
      const b = f.path.slice(f.path.lastIndexOf('/') + 1).toLowerCase()
      return words.some((w) => b.includes(w))
    })
    candidates.push(...overlaps.map((f) => f.path).slice(0, 6))
  }
  return { ok: false, reason: candidates.length > 0 ? 'ambiguous' : 'no-match', candidates }
}

// ---- naming conventions (batch rename) --------------------------------------

export type NamingConvention = 'kebab-case' | 'snake_case' | 'camelCase' | 'PascalCase'

export function parseConvention(token: string): NamingConvention | null {
  const t = token.trim().toLowerCase().replace(/\s+/g, '-')
  if (t === 'kebab-case' || t === 'kebab') return 'kebab-case'
  if (t === 'snake_case' || t === 'snake') return 'snake_case'
  if (t === 'camelcase' || t === 'camel' || t === 'camel-case') return 'camelCase'
  if (t === 'pascalcase' || t === 'pascal') return 'PascalCase'
  return null
}

/** Split a basename into word tokens across camel/Pascal/separators/digits. */
function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
}

/** Convert a FILE basename (extension preserved) to the convention. */
export function convertBasename(basename: string, convention: NamingConvention): string {
  const dot = basename.lastIndexOf('.')
  const stem = dot > 0 ? basename.slice(0, dot) : basename
  const ext = dot > 0 ? basename.slice(dot) : ''
  const words = splitWords(stem).map((w) => w.toLowerCase())
  if (words.length === 0) return basename
  let out: string
  if (convention === 'kebab-case') out = words.join('-')
  else if (convention === 'snake_case') out = words.join('_')
  else if (convention === 'camelCase') out = words.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join('')
  else out = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('')
  return out + ext.toLowerCase()
}

// ---- message shaping ---------------------------------------------------------

/** A message containing a code fence is a content edit — never a file op. */
export function hasCodeFence(message: string): boolean {
  return /```/.test(message)
}

const INTERROGATIVE =
  /^(what (?:would |will |)?happens?|what(?:'s| is) the (?:result|effect|impact)|could you explain|explain what would happen)\b/i

const CLEAN_PREFIX =
  /^(?:hey|hi|ok|okay|now|then|after that|also|please|can you|could you|would you|i want to|i'd like to|i need to|let's|lets|we need to|help me|go ahead and)\s+/gi

function cleanMessage(message: string): string {
  return message.replace(CLEAN_PREFIX, '').trim()
}

/** Strip trailing punctuation for token capture. */
function stripTail(s: string): string {
  return s.replace(/[.!?]+$/, '').trim()
}

// ---- intent patterns ---------------------------------------------------------

const RENAME_RE = /^rename\s+(.+?)\s+(?:to|as|into)\s+(.+)$/i
const MOVE_RE = /^move\s+(.+?)\s+(?:to|into|under|in)\s+(.+)$/i
const DELETE_RE = /^(?:delete|remove)\s+(.+)$/i
const CREATE_FOLDER_RE =
  /^(?:create|make|add)\s+(?:a\s+)?(?:new\s+)?(?:([\w.-]+)\s+)?(?:folder|directory|dir)\s*(?:called\s+|named\s+)?(.*)$/i

/** Every ancestor folder path that actually contains files. */
export function allFolderPaths(files: Array<{ path: string }>): string[] {
  const set = new Set<string>()
  for (const f of files) {
    const segs = f.path.split('/')
    for (let i = 1; i < segs.length; i += 1) set.add(segs.slice(0, i).join('/'))
  }
  return [...set]
}
const BATCH_RENAME_RE =
  /^rename\s+(?:all\s+)?(?:the\s+)?(?:(\.\w{1,8})\s+)?files?\s+(?:in|inside|under)\s+(.+?)\s+to\s+(.+)$/i
const RENAME_ALL_IN_RE = /^rename\s+(?:all\s+)?(?:the\s+)?files?\s+(?:in|inside|under)\s+(.+)$/i

function looksPathLike(token: string): boolean {
  const t = token.trim().replace(/^["'`]|["'`]$/g, '')
  return /\/|\.\w{1,8}$/.test(t)
}

function folderWord(token: string): boolean {
  return /(^|\b)(folder|directory|dir)(\b|$)/i.test(token)
}

/** Destination tokens: drop articles/possessives and a trailing folder word. */
function cleanDestination(token: string): string {
  return token
    .replace(/^(?:the|a|an|my|our|this)\s+/i, '')
    .replace(/\s+(?:folder|directory|dir)$/i, '')
    .trim()
}

/** Source tokens: same cleanup — "the components folder" → "components". */
function cleanSourceToken(token: string): string {
  return token
    .replace(/^(?:the|a|an|my|our|this)\s+/i, '')
    .replace(/\s+(?:folder|directory|dir|file)$/i, '')
    .trim()
}

/** A multi-word rename/move destination is prose, not a name — never guessed. */
function isNameLike(token: string): boolean {
  return !/\s/.test(token)
}

/**
 * CREATE WITH EXPLICIT CONTENT: the user pasted exactly one path-tagged fence
 * and asked to create that file. The content is EXPLICIT user input — used
 * verbatim. Any other fenced message is a normal content edit (model turn).
 */
function matchCreateWithFence(message: string, files: Array<{ path: string }>): Detection | null {
  if (!hasCodeFence(message)) return null
  const fenced = parseFiles(message)
  if (fenced.length !== 1) return null
  const prose = message.replace(/```[\s\S]*?```/g, ' ').replace(CLEAN_PREFIX, ' ').trim()
  if (!/\b(create|make|add)\b/i.test(prose)) return null
  const target = fenced[0].path
  // The prose must name the SAME target (exact path, basename, or stem).
  const base = target.slice(target.lastIndexOf('/') + 1)
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base
  const namesTarget = new RegExp(`(?:^|\\s|\`)${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s|\`|\.)`, 'i')
  if (!namesTarget.test(prose) && !new RegExp(`(?:^|\\s|\`)${stem}(?:$|\\s|\`|\.)`, 'i').test(prose)) {
    return null
  }
  try {
    normalizeProjectPath(target)
  } catch {
    return null
  }
  if (files.some((f) => f.path === target)) return null // exists → edit turn, not create
  return {
    detected: true,
    type: 'op',
    intent: { kind: 'create', sources: [], destination: target, createIsFolder: false, createContent: fenced[0].content },
  }
}

/**
 * Split a multi-source token: "a.ts, b.ts and c.ts" → ['a.ts','b.ts','c.ts'].
 * Only commas / ' and ' / ' & ' split — never spaces inside a token.
 */
function splitSources(token: string): string[] {
  return token
    .split(/\s*,\s*|\s+and\s+|\s+&\s+/i)
    .map((s) => stripTail(s).trim())
    .filter(Boolean)
}

function clarifyMultiple(kind: string, candidates: string[]): string {
  return (
    `Which file or folder should I ${kind}? Several match: ` +
    candidates.map((c) => `\`${c}\``).join(', ') +
    '. Reply with the exact path.'
  )
}

function clarifyNone(kind: string, token: string, candidates: string[]): string {
  if (candidates.length > 0) {
    return (
      `I could not find \`${token}\`. Did you mean one of these? ` +
      candidates.map((c) => `\`${c}\``).join(', ') +
      ' — reply with the exact path, or rephrase.'
    )
  }
  return `Which file or folder should I ${kind}? Nothing in this project matches \`${token}\`. Name the exact path (for example \`src/App.tsx\`).`
}

/**
 * Detect a file operation in a chat message. `files` is the REAL current
 * project file list. Deterministic: same message + same file set → same
 * detection, every time.
 */
export function detectFileOperation(
  message: string,
  files: Array<{ path: string }>,
): Detection {
  const fencedCreate = matchCreateWithFence(message, files)
  if (fencedCreate) return fencedCreate
  if (hasCodeFence(message)) return { detected: false }
  const cleaned = cleanMessage(message)
  if (cleaned.length === 0 || cleaned.length > 400) return { detected: false }

  const explain = INTERROGATIVE.test(cleaned)
  const body = cleaned.replace(INTERROGATIVE, '').replace(/^\s*(?:if i|if we|i)\s+/i, '').trim()

  // ---- batch rename (convention-driven) ------------------------------------
  const batchRename = body.match(BATCH_RENAME_RE)
  if (batchRename) {
    const convention = parseConvention(stripTail(batchRename[3]))
    if (!convention) {
      return {
        detected: true,
        type: 'clarification',
        question:
          'Which naming convention should I apply? I support kebab-case, snake_case, camelCase and PascalCase.',
      }
    }
    const scopeToken = stripTail(batchRename[2])
    const scope = resolveTarget(scopeToken, files)
    if (!scope.ok) {
      return {
        detected: true,
        type: 'clarification',
        question: clarifyNone('rename', scopeToken, scope.candidates),
      }
    }
    if (!scope.target.isFolder) {
      return {
        detected: true,
        type: 'clarification',
        question: `\`${scope.target.path}\` is a single file — should I rename it directly, or did you mean the folder it lives in?`,
      }
    }
    return {
      detected: true,
      type: explain ? 'explain' : 'op',
      intent: {
        kind: 'batch-rename',
        sources: [scope.target],
        convention,
        extensionFilter: batchRename[1]?.toLowerCase(),
      },
    }
  }
  const renameAll = body.match(RENAME_ALL_IN_RE)
  if (renameAll) {
    return {
      detected: true,
      type: 'clarification',
      question:
        'Which naming convention should I apply? I support kebab-case, snake_case, camelCase and PascalCase — for example: “rename all files in src/components to kebab-case”.',
    }
  }

  // ---- rename ---------------------------------------------------------------
  const rename = body.match(RENAME_RE)
  if (rename) {
    const sourceToken = stripTail(rename[1])
    const destToken = stripTail(rename[2])
    // "rename the X in Y to Z" / "rename the function ..." are code edits.
    if (/\s(?:in|inside|from)\s/i.test(sourceToken) || !isNameLike(cleanDestination(destToken))) {
      return { detected: false }
    }
    const source = resolveTarget(cleanSourceToken(sourceToken), files)
    if (!source.ok) {
      return {
        detected: true,
        type: 'clarification',
        question:
          source.reason === 'ambiguous'
            ? clarifyMultiple('rename', source.candidates)
            : clarifyNone('rename', sourceToken, source.candidates),
      }
    }
    let destination: string
    try {
      destination = normalizeProjectPath(destToken)
    } catch {
      return { detected: false }
    }
    return { detected: true, type: explain ? 'explain' : 'op', intent: { kind: 'rename', sources: [source.target], destination } }
  }

  // ---- move (single or explicit batch) ---------------------------------------
  const move = body.match(MOVE_RE)
  if (move) {
    const sourceTokens = splitSources(stripTail(move[1]))
    const destToken = cleanDestination(stripTail(move[2]))
    // A multi-word destination is prose ("move on to the next step"); a
    // single-word destination is accepted — the SOURCE resolution, the
    // existing-file probe below and normalization are the real guards.
    if (!isNameLike(destToken)) return { detected: false }
    let destination: string
    try {
      destination = normalizeProjectPath(destToken)
    } catch {
      return { detected: false }
    }
    // A move destination that resolves to an EXISTING FILE means the request
    // was prose about that file ("move the hero section in App.tsx") — a code
    // edit, not a file operation.
    const destProbe = resolveTarget(destToken, files)
    if (destProbe.ok && !destProbe.target.isFolder) return { detected: false }
    const resolved: ResolvedTarget[] = []
    for (const rawToken of sourceTokens) {
      const token = cleanSourceToken(rawToken)
      const r = resolveTarget(token, files)
      if (!r.ok) {
        return {
          detected: true,
          type: 'clarification',
          question:
            r.reason === 'ambiguous'
              ? clarifyMultiple('move', r.candidates)
              : clarifyNone('move', token, r.candidates),
        }
      }
      resolved.push(r.target)
    }
    if (resolved.length > 1) {
      return {
        detected: true,
        type: explain ? 'explain' : 'op',
        intent: { kind: 'batch-move', sources: resolved, destination },
      }
    }
    return {
      detected: true,
      type: explain ? 'explain' : 'op',
      intent: { kind: 'move', sources: resolved, destination },
    }
  }

  // ---- delete ----------------------------------------------------------------
  const del = body.match(DELETE_RE)
  if (del) {
    const token = cleanSourceToken(stripTail(del[1]))
    if (!looksPathLike(token) && !folderWord(stripTail(del[1]))) {
      // Prose object ("remove the background animation"): a code-edit request
      // unless the word-overlap ladder finds grounded candidates.
      const r = resolveTarget(token, files)
      if (!r.ok && r.candidates.length > 0) {
        return {
          detected: true,
          type: 'clarification',
          question: clarifyMultiple('delete', r.candidates),
        }
      }
      return { detected: false }
    }
    const r = resolveTarget(token, files)
    if (!r.ok) {
      return {
        detected: true,
        type: 'clarification',
        question:
          r.reason === 'ambiguous'
            ? clarifyMultiple('delete', r.candidates)
            : clarifyNone('delete', token, r.candidates),
      }
    }
    return { detected: true, type: explain ? 'explain' : 'op', intent: { kind: 'delete', sources: [r.target] } }
  }

  // ---- create ----------------------------------------------------------------
  // Folder/directory creation is a deterministic operation (a .gitkeep marker
  // per directory — honest, conventional, no invented source code).
  // BARE create-file requests ("create utils.ts", "add a file called notes.md")
  // are deliberately NOT detected: real file CONTENT is generated through the
  // existing targeted-edit pipeline (the normal model turn), never an empty
  // placeholder. Explicit-content creates are handled by matchCreateWithFence.
  const createFolder = body.match(CREATE_FOLDER_RE)
  if (createFolder) {
    const descriptor = createFolder[1]?.trim()
    const named = stripTail((createFolder[2] ?? '').trim())
    const token = named.length > 0 ? named : descriptor
    if (!token) {
      return {
        detected: true,
        type: 'clarification',
        question: 'What should the new folder be called? Give the path, for example `src/components`.',
      }
    }
    let path: string
    try {
      path = normalizeProjectPath(cleanDestination(token))
    } catch {
      return { detected: false }
    }
    return {
      detected: true,
      type: explain ? 'explain' : 'op',
      intent: { kind: 'create', sources: [], destination: path, createIsFolder: true },
    }
  }

  return { detected: false }
}

export { KNOWN_EXTENSIONS }
