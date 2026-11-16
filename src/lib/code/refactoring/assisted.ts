/**
 * BEAN Intelligence — CODE GIFTZ provider-assisted refactoring drafting (M25).
 *
 * Semantic refactors (component/module extraction, service-layer split,
 * consolidation, restructuring, repair) cannot be resolved deterministically.
 * The provider's role is STRICTLY bounded:
 *   1. it receives the affected dependency scope (graph-bounded, budgeted —
 *      never the unbounded whole project) plus a sharp refactoring contract;
 *   2. it answers with path-tagged fences (the EXISTING M22 response contract)
 *      for the files it changes/creates — never a plan it executes itself;
 *   3. the SERVER assembles a RefactorPlan from that draft and validates it:
 *      path safety, protected paths, scope enforcement (no file outside the
 *      declared scope may be touched), no-op elimination, symbol-collision
 *      and export-surface checks, staleness hashes.
 *
 * The draft NEVER touches project files. Execution happens only through the
 * approval-bound atomic executor (execute.ts) after the user confirms the
 * exact plan. Provider failure → honest typed error, zero mutation.
 *
 * SERVER-ONLY (imports the DB-free adapter surface only).
 */
import { solveWithContinuation, MAX_SOLVE_CONTINUATIONS } from '@/lib/riishe/continuation'
import type { TaskAdapter } from '@/lib/adapters/types'
import { UpstreamTruncatedError } from '@/lib/adapters/hosted-llm'
import { parseFiles } from '@/lib/giftz/workspace'
import { assertSafeProjectPath } from '@/lib/giftz/workspace'
import { FileOpError } from '@/lib/code/file-ops/types'
import { dependencyCone, extractSymbols, type ProjectGraph } from './graph'
import {
  REFACTOR_ENGINE,
  sha256,
  specifierForTarget,
  validateRefactorPlan,
  type RefactorEdit,
  type RefactorKind,
  type RefactorPlan,
} from './plan'

/** Files a refactoring draft must never rewrite (attribution / build integrity). */
const PROTECTED_FROM_REFACTOR = [
  'package.json',
  'package-lock.json',
  'bun.lock',
  'bun.lockb',
  'pnpm-lock.yaml',
  'yarn.lock',
  'notices.md',
]

const KIND_INSTRUCTION: Record<RefactorKind, string> = {
  'extract-component':
    'Extract the requested UI portion into its own reusable component file. Your draft MUST include one fence that CREATES the new component file (its OWN new component name) — a draft that only edits existing files is auto-rejected. Import the new component at the usage site, and keep the rendered output IDENTICAL. Do NOT move, rename or re-export any existing exported symbol — the new file declares only the new component.',
  'extract-module':
    'Move the requested functions/logic into their own module file. Your draft MUST include one fence that CREATES the new module file — a draft that only edits existing files is auto-rejected. Export the moved symbols there, REMOVE those declarations from the source file (a move, never a copy), and import them at every usage site. Do not change the moved logic.',
  'service-layer':
    'Separate API/data-access calls from UI code: your draft MUST include one fence that CREATES the new service module under services/ (exactly like ```ts path=services/dashboard-data.ts) — a draft without a NEW services/ file is auto-rejected. MOVE the fetch/API logic there (the original module must no longer declare or re-export the moved functions — duplicates across files are rejected), export typed functions from the service module, and update every UI file to import from the services. UI components must no longer perform raw API calls.',
  consolidate:
    'Consolidate the repeated UI/logic structures into ONE shared component/module. Your draft MUST include one fence that CREATES the new shared file (its OWN new component name — do not move or re-export existing exported symbols) — a draft that only edits existing files is auto-rejected. Replace each repetition with usage of the shared implementation, and keep behavior identical.',
  restructure:
    'Reorganize the named modules into the cleaner folder structure requested. Preserve every file\'s content semantics; update ALL import specifiers (relative or @/ alias) that point at moved files.',
  'rename-symbol': 'Not used by the deterministic engine.',
  'move-module': 'Not used by the deterministic engine.',
  repair:
    'Produce a TARGETED repair for the reported failure only. Change the minimum set of files; never regenerate the project; keep every other file byte-identical.',
}

const REFACTORING_CONTRACT = [
  'REFACTORING DRAFT MODE — you are drafting a multi-file refactoring plan. You will NOT execute anything; the server validates your draft and the user reviews and approves an exact diff.',
  'Respond ONLY with:',
  '1. One path-tagged fence per file you change or create, tagged like ```tsx path=src/components/NewThing.tsx, containing the COMPLETE new content of that file.',
  '2. NEVER re-emit a file whose content stays the same.',
  '3. NEVER rewrite package.json, lockfiles, NOTICES.md, or any file outside the stated scope.',
  '4. Preserve unrelated content byte-for-byte; preserve formatting; do not rename unrelated symbols; do not change public APIs unless the request requires it.',
  '4b. PRESERVE TYPES: keep every existing TypeScript type annotation exactly as it is; never remove annotations, never introduce untyped/implicit-any callback parameters, never weaken types. The refactored project must keep compiling cleanly under strict TypeScript.',
  '5. A MOVE means the source file STOPS declaring the moved symbol: the same export must never exist in two files (duplicate exports are rejected server-side). When a file keeps re-exporting a moved symbol, remove that re-export.',
  '   Worked example of a move — the API helper `getUser` moves from the UI module into a service module:',
  '   ```ts path=src/lib/ui.ts',
  '   import { getUser } from \'../services/api\'   // the declaration is GONE from this file; only the import remains',
  '   export async function renderProfile(id: string) {',
  '     const user = await getUser(id)',
  '     return `<p>${user.name}</p>`',
  '   }',
  '   ```',
  '   ```ts path=src/services/api.ts',
  '   export async function getUser(id: string) {   // the declaration now lives ONLY here',
  '     const res = await fetch(`/api/users/${id}`)',
  '     return res.json()',
  '   }',
  '   ```',
  '6. After the fences, one short paragraph stating exactly which files changed and why (this becomes the plan summary).',
  'If the request is too ambiguous to draft safely, respond with ONE clarifying question and no fences.',
].join('\n')

/** Scope-bound, budgeted project context for the drafting pass (mirrors the
 *  M24 hardening: smallest-first, whole-file omission over partial dumps). */
export function buildScopeContext(files: Array<{ path: string; content: string }>, budget = 24_000): string {
  if (files.length === 0) return ''
  const parts: string[] = ['AFFECTED PROJECT FILES (the refactoring scope — change nothing outside it):']
  let remaining = budget
  for (const f of files) {
    if (remaining <= 0 || f.content.length > remaining) {
      parts.push(`- ${f.path} (omitted from context: scope budget reached — do NOT modify, re-emit or delete it)`)
      continue
    }
    remaining -= f.content.length
    parts.push(`--- ${f.path} ---\n${f.content}`)
  }
  return parts.join('\n\n')
}

export type AssistedDraftArgs = {
  adapter: TaskAdapter
  backendRequestMs: number
  maxPromptChars: number
  kind: RefactorKind
  request: string
  scopeFiles: Array<{ path: string; content: string }>
  /** Extra context lines (e.g. validation-failure report for repair drafts). */
  extraContext?: string
}

/**
 * One bounded provider pass producing a parsed draft (path → content).
 * Continuations follow the shared bound; the concatenated answer is the
 * honest full draft. Resilience is BOUNDED and honest:
 *   - a truncated answer whose partial still contains COMPLETE path-tagged
 *     fences is accepted (an unterminated fence never parses; the server
 *     validates every fence's content anyway) — recorded via `truncated`;
 *   - any other one-pass failure is retried exactly ONCE (bounded, no retry
 *     storm, no repeated metered spam) before failing honestly.
 * Throws typed errors on empty/unusable drafts.
 */
export async function draftRefactoringPatch(args: AssistedDraftArgs): Promise<{ draft: Array<{ path: string; content: string }>; rawContent: string; tokensInEst: number; tokensOutEst: number; truncated: boolean }> {
  if (REFACTOR_ENGINE[args.kind] !== 'provider-assisted') {
    throw new FileOpError('INVALID', `${args.kind} is a deterministic operation and does not use the provider.`)
  }
  let attempt = 0
  let lastError: unknown = null
  while (attempt < 2) {
    attempt += 1
    try {
      const outcome = await draftOnce(args)
      return outcome
    } catch (e) {
      lastError = e
      // A truncated answer with usable complete fences is accepted (see above).
      if (e instanceof UpstreamTruncatedError && e.partialText && parseFiles(e.partialText).length > 0) {
        const draft = parseFiles(e.partialText)
        return {
          draft,
          rawContent: e.partialText,
          tokensInEst: Math.ceil(args.scopeFiles.reduce((a, f) => a + f.content.length, 0) / 4),
          tokensOutEst: Math.ceil(e.partialText.length / 4),
          truncated: true,
        }
      }
      // Anything else: exactly one retry, then honest failure.
    }
  }
  if (lastError instanceof FileOpError) throw lastError
  throw new FileOpError('INVALID', `The provider drafting pass failed after ${attempt} bounded attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

/**
 * Character budget for the corrective pass's previous-draft slice: the slice
 * must leave room for the instruction, request, contract AND a minimum scope
 * context inside the adapter's per-message maxPromptChars — an oversized slice
 * pushes the contract past the truncation point and the corrected answer
 * arrives without the contract at all (measured live-acceptance failure).
 */
export function correctiveDraftCharBudget(maxPromptChars: number): number {
  return Math.max(4_000, maxPromptChars - 5_500)
}

async function draftOnce(args: AssistedDraftArgs): Promise<{ draft: Array<{ path: string; content: string }>; rawContent: string; tokensInEst: number; tokensOutEst: number; truncated: boolean }> {
  // Instruction + contract ride FIRST: the adapter slices each message to
  // maxPromptChars, so content past the cap is silently lost (measured s6
  // failure class: the contract sat at the TAIL and a wide scope context
  // pushed it past the limit — the model then answered with no create-fence
  // at all). The scope context is the omittable part and sits LAST under an
  // explicit character budget.
  const instructionBlock = [
    `REFACTORING TYPE: ${args.kind}`,
    KIND_INSTRUCTION[args.kind],
    `REQUEST: ${args.request}`,
    REFACTORING_CONTRACT,
  ].join('\n\n')
  const reserved = instructionBlock.length + (args.extraContext?.length ?? 0) + 600
  const scopeBudget = Math.max(2_000, args.maxPromptChars - reserved)
  const userContent = [
    instructionBlock,
    args.extraContext ?? '',
    buildScopeContext(args.scopeFiles, scopeBudget),
  ]
    .filter((s) => s.length > 0)
    .join('\n\n')

  const messages = [
    { role: 'assistant' as const, content: REFACTORING_CONTRACT },
    { role: 'user' as const, content: userContent },
  ]
  const outcome = await solveWithContinuation({
    baseMessages: messages,
    maxContinuations: MAX_SOLVE_CONTINUATIONS,
    solvePass: async (passMessages) => {
      const result = await args.adapter.codeTask!({
        mode: 'generate',
        messages: passMessages,
        maxPromptChars: args.maxPromptChars,
        timeoutMs: args.backendRequestMs,
      })
      return result.content
    },
  })
  if (!outcome.content.trim()) {
    throw new FileOpError('INVALID', 'The provider returned an empty refactoring draft — nothing was planned.')
  }
  const draft = parseFiles(outcome.content)
  if (draft.length === 0) {
    // A clarification answer is legitimate; everything else is an unusable draft.
    throw new FileOpError('INVALID', 'The provider draft contained no path-tagged files — it cannot be validated into a refactoring plan. Rephrase the request with the specific files/behavior.')
  }
  return {
    draft,
    rawContent: outcome.content,
    tokensInEst: Math.ceil(userContent.length / 4),
    tokensOutEst: Math.ceil(outcome.content.length / 4),
    truncated: false,
  }
}

export type AssembleAssistedArgs = {
  kind: RefactorKind
  title: string
  reason: string
  request: string
  /** The full current file set. */
  files: Array<{ path: string; content: string }>
  graph: ProjectGraph
  /** Files the request was resolved to (the declared scope roots). */
  scopeRoots: string[]
  draft: Array<{ path: string; content: string }>
}

/**
 * Assemble + validate a RefactorPlan from a provider draft. This is the
 * server-side validation gate: a draft that touches protected paths, paths
 * outside the declared scope, or introduces symbol collisions is REJECTED —
 * never silently repaired into a different plan.
 */
export function assembleAssistedPlan(args: AssembleAssistedArgs): { plan: RefactorPlan; warnings: string[] } {
  const { kind, files, graph, draft } = args
  const byPath = new Map(files.map((f) => [f.path, f.content]))

  // Declared scope: the request's dependency cone (downward — what imports the
  // roots — plus the roots and their own imports), bounded like the graph.
  const scopeRoots = args.scopeRoots.filter((p) => byPath.has(p))
  if (scopeRoots.length === 0) {
    throw new FileOpError('NOT_FOUND', 'The refactoring scope resolved to zero project files — nothing can be planned.')
  }
  const cone = new Set<string>([...dependencyCone(graph, scopeRoots, 'down'), ...dependencyCone(graph, scopeRoots, 'up'), ...scopeRoots])

  const edits: RefactorEdit[] = []
  const warnings: string[] = []
  const createdPaths: string[] = []
  const notes: string[] = [
    'The provider draft was validated server-side; nothing reached the workspace without your approval.',
    'Compilation success alone does not prove behavioral equivalence — review the diff.',
  ]

  for (const d of draft) {
    let path: string
    try {
      path = d.path.replace(/^\.\//, '')
      assertSafeProjectPath(path)
    } catch {
      throw new FileOpError('INVALID', `The draft contains an unsafe path (${d.path.slice(0, 80)}) and was rejected.`)
    }
    const lower = path.toLowerCase()
    if (PROTECTED_FROM_REFACTOR.some((p) => lower === p || lower.endsWith(`/${p}`))) {
      throw new FileOpError('PROTECTED', `The draft rewrites ${path}, which is protected (build/attribution integrity). Refactoring must not touch it.`)
    }
    // Path-prefix drift correction (measured failure class, M25 live
    // acceptance s4): the drafting contract's worked examples tag fences
    // `src/...`, and a model can copy that prefix for a project whose files
    // are stored WITHOUT it — every such fence then looks like a NEW file and
    // the real importers are never edited. When the draft path does not exist
    // but the same path under a conventional source prefix DOES, the fence is
    // resolved to the existing file (recorded in the plan notes, never silent).
    const PREFIX_DRIFT = ['src/', 'source/', 'project/']
    let resolvedPath = path
    let driftCorrected = false
    if (!byPath.has(path)) {
      for (const prefix of PREFIX_DRIFT) {
        if (path.startsWith(prefix) && byPath.has(path.slice(prefix.length))) {
          resolvedPath = path.slice(prefix.length)
          driftCorrected = true
          break
        }
      }
    }
    if (driftCorrected) {
      notes.push(`Draft path ${path} resolved to the existing ${resolvedPath} (source-prefix drift corrected server-side).`)
    }
    path = resolvedPath
    const existing = byPath.get(path)
    if (existing === undefined) {
      // Created file — normalize source-prefix drift for NEW paths too: when
      // the project stores NO file under the prefix, a drifted create would
      // plant the module outside the project's convention and break the
      // drift-corrected importers (measured s4 class).
      if (!driftCorrected) {
        for (const prefix of PREFIX_DRIFT) {
          if (path.startsWith(prefix) && ![...byPath.keys()].some((p) => p.startsWith(prefix))) {
            notes.push(`Created-file path ${path} normalized to ${path.slice(prefix.length)} (the project stores no files under ${prefix}).`)
            path = path.slice(prefix.length)
            break
          }
        }
      }
      // Created file — must be a code/doc/style asset inside the project root.
      if (!/\.(ts|tsx|js|jsx|mjs|cjs|css|scss|json|md|html)$/i.test(path)) {
        throw new FileOpError('INVALID', `The draft creates ${path} with an unsupported extension — rejected.`)
      }
      if (d.content.trim().length === 0) {
        throw new FileOpError('INVALID', `The draft creates ${path} with empty content — rejected.`)
      }
      edits.push({ path, before: null, after: d.content, changeType: 'create' })
      createdPaths.push(path)
      continue
    }
    if (d.content === existing) continue // honest no-op — the draft re-emitted an unchanged file
    const inScope = cone.has(path)
    if (!inScope) {
      throw new FileOpError(
        'INVALID',
        `The draft modifies ${path}, which is OUTSIDE the declared refactoring scope (${[...scopeRoots].join(', ')} and their dependency cone). Scope discipline violated — rejected.`,
      )
    }
    edits.push({ path, before: existing, after: d.content, changeType: 'modify' })
  }

  if (edits.length === 0) {
    throw new FileOpError('INVALID', 'The draft produced no actual changes (every file was byte-identical) — nothing to plan.')
  }

  // Kind-specific completeness gate: the drafting instructions REQUIRE a new
  // module for the relocation kinds. A draft that only edits existing files
  // (the measured s4 failure: importers rewritten, service module never
  // created) is INCOMPLETE, not valid — rejected here so the chat flow's ONE
  // bounded corrective pass can demand the missing module, instead of
  // executing a plan that cannot satisfy the request. The check tolerates the
  // measured source-prefix drift (src/services/… counts as services/).
  const stripDrift = (p: string) => p.replace(/^(src|source|project)\//i, '')
  if (kind === 'service-layer' && !createdPaths.some((p) => /^services\//i.test(stripDrift(p)))) {
    throw new FileOpError('INVALID', 'The draft created no service module under services/ — a service-layer extraction must relocate the data-access logic into a NEW services/ module. Re-emit the complete draft including the new service file.')
  }
  if ((kind === 'extract-component' || kind === 'extract-module' || kind === 'consolidate') && createdPaths.length === 0) {
    throw new FileOpError('INVALID', `The draft created no new file — a ${kind} must introduce the new ${kind === 'consolidate' ? 'shared' : 'extracted'} module. Re-emit the complete draft including the new file.`)
  }

  // Deterministic importer completion (measured s4 failure class): a
  // relocation that guts the source module must not DEPEND on the provider
  // having seen every importer — the drafting prompt's character budget can
  // legitimately omit a far importer. For VERIFIED importers of a removed
  // export whose file the draft did NOT touch, the plan appends the mechanical
  // import rewrite itself (bindings re-pointed at the created module that now
  // declares the symbol; specifier math REUSED from the deterministic
  // move-module engine). Disclosed in the plan notes — never silent. Files the
  // draft DID touch are left to the completeness gate below (overwriting model
  // output with regex surgery could fight a deliberate usage-site edit).
  {
    const editByPath = new Map(edits.map((e) => [e.path, e] as const))
    const createdContentOf = new Map(createdPaths.map((p) => [p, editByPath.get(p)!.after as string]))
    for (const e of [...edits]) {
      if (e.changeType !== 'modify' || e.before === null) continue
      const beforeNames = new Set(extractSymbols(e.before).filter((s) => s.exported).map((s) => s.name))
      const afterNames = new Set(extractSymbols(e.after).filter((s) => s.exported).map((s) => s.name))
      const removed = [...beforeNames].filter((n) => !afterNames.has(n))
      if (removed.length === 0) continue
      for (const node of graph.nodes.values()) {
        if (node.path === e.path) continue
        if (editByPath.has(node.path)) continue // draft already plans this file — the gate judges it
        const original = byPath.get(node.path)
        if (original === undefined) continue
        for (const edge of node.imports) {
          if (!edge.verified || edge.resolvedPath !== e.path) continue
          const movedBindings = edge.bindingNames.filter((b) => removed.includes(b))
          if (movedBindings.length === 0) continue
          // Where does each moved symbol now live? A created file that declares it.
          const nameToTarget = new Map<string, string>()
          for (const name of movedBindings) {
            const target = createdPaths.find((p) =>
              extractSymbols(createdContentOf.get(p) ?? '').some((s) => s.exported && s.name === name),
            )
            if (target) nameToTarget.set(name, target)
          }
          if (nameToTarget.size === 0) continue // relocation target unknown — the gate/risk path reports it honestly
          const rewritten = rePointBindings(original, edge.specifier, nameToTarget, (targetPath) =>
            specifierForTarget(dirOf(node.path), targetPath, !/\.[a-z]+$/i.test(edge.specifier)),
          )
          if (rewritten === original) continue
          const edit: RefactorEdit = { path: node.path, before: original, after: rewritten, changeType: 'modify' }
          edits.push(edit)
          editByPath.set(node.path, edit)
          notes.push(
            `Importer ${node.path} was re-pointed to ${[...new Set(nameToTarget.values())].join(', ')} by the server from the verified import graph (the provider draft did not include this file).`,
          )
        }
      }
    }
  }

  // Incomplete-relocation gate (measured s4 follow-up): a modify-edit that
  // REMOVES exports must be accompanied by importer updates — executing an
  // incomplete move leaves the workspace broken (lib/sample.ts gutted while
  // App.tsx / header / table still imported the removed symbols). Every
  // VERIFIED importer that still binds a removed name, and whose own content
  // the plan does not fix, makes the draft INCOMPLETE — rejected with the
  // exact importer list so the bounded corrective pass can target it.
  {
    const editByPath = new Map(edits.map((e) => [e.path, e] as const))
    const brokenImporters: Array<{ importer: string; from: string; names: string[] }> = []
    for (const e of edits) {
      if (e.changeType !== 'modify' || e.before === null) continue
      const beforeNames = new Set(extractSymbols(e.before).filter((s) => s.exported).map((s) => s.name))
      const afterNames = new Set(extractSymbols(e.after).filter((s) => s.exported).map((s) => s.name))
      const removed = [...beforeNames].filter((n) => !afterNames.has(n))
      if (removed.length === 0) continue
      for (const node of graph.nodes.values()) {
        if (node.path === e.path) continue
        for (const edge of node.imports) {
          if (!edge.verified || edge.resolvedPath !== e.path) continue
          const bound = edge.bindingNames.filter((b) => removed.includes(b))
          if (bound.length === 0) continue
          const planned = editByPath.get(node.path)
          const stillImportsOld =
            planned && planned.changeType === 'modify' && planned.after !== null
              ? // Precise check: does the planned content still BIND a moved name
                // from the old specifier? (Keeping OTHER names on the old module
                // is legitimate — the measured s4 heuristic rejected mixed
                // importers that had been correctly split.)
                stillBindsNames(planned.after, edge.specifier, bound)
              : true // not planned at all — the file stays as it is
          if (stillImportsOld) {
            brokenImporters.push({ importer: node.path, from: e.path, names: bound })
          }
        }
      }
    }
    if (brokenImporters.length > 0) {
      const listed = brokenImporters.slice(0, 8).map((b) => `${b.importer} (still imports ${b.names.join(', ')} from ${b.from})`).join('; ')
      throw new FileOpError('INVALID', `The draft removed exported symbol(s) but left ${brokenImporters.length} importer(s) unupdated — the relocation is incomplete: ${listed}. Re-emit the complete draft updating EVERY importer of the moved symbols.`)
    }
  }

  const sourceHashes: Record<string, string> = {}
  for (const e of edits) if (e.before !== null) sourceHashes[e.path] = sha256(e.before)

  const plan: RefactorPlan = {
    planVersion: 1,
    kind,
    title: args.title,
    reason: args.reason,
    engine: 'provider-assisted',
    steps: [
      `Provider drafted a ${kind} patch for ${scopeRoots.length} scope file(s) — server-validated (paths, scope, collisions, export surface).`,
      `The validated plan touches ${edits.length} file(s)${createdPaths.length > 0 ? ` (creates ${createdPaths.join(', ')})` : ''}.`,
      'You review the exact per-file diff and approve; execution is atomic and records ONE version.',
    ],
    edits,
    moves: [],
    createdPaths,
    scopeFiles: [...cone].sort(),
    risks: [],
    unresolved: [],
    notes,
    sourceHashes,
    affectedTests: planAffectedTests(edits, files),
    requiresConfirmation: true,
  }

  // Full semantic-safety validation (same gate used at execution time).
  const safety = validateRefactorPlan(plan, files)
  if (!safety.ok) {
    const first = [...safety.stale, ...safety.conflicts, ...safety.errors][0]
    throw new FileOpError('INVALID', `The provider draft failed server-side validation: ${first}`)
  }
  // Cross-file duplicate exports: legal ES modules, typically relocation
  // residue from the draft — surfaced as reviewable RISKS, never silently
  // accepted (the user sees them before approving; post-execution
  // verification re-counts them honestly).
  for (const collision of safety.symbolCollisions) {
    plan.risks.push(`${collision} This is usually relocation residue — remove the stale declaration manually (or ask for a targeted edit) after approving.`)
  }
  for (const ec of safety.exportChanges) {
    if (ec.lost.length > 0) {
      plan.risks.push(`${ec.path}: exports removed (${ec.lost.join(', ')}) — importers of those symbols will break unless the draft updated them.`)
    }
    if (ec.gained.length > 0) warnings.push(`${ec.path}: new exports introduced (${ec.gained.join(', ')}).`)
  }
  if (safety.cycles.length > 0) {
    plan.risks.push(`The planned file set contains ${safety.cycles.length} import cycle(s) (e.g. ${safety.cycles[0].join(' → ')}) — flagged for review.`)
  }
  return { plan, warnings }
}

function dirOf(p: string): string {
  const i = p.lastIndexOf('/')
  return i === -1 ? '' : p.slice(0, i)
}

interface ParsedBinding {
  raw: string
  name: string
}

function parseBindings(raw: string): ParsedBinding[] {
  return raw
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => ({ raw: b, name: b.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim() }))
}

/**
 * Re-point the bindings of import/export-from statements that reference
 * `specifier` so the moved names import from their new modules. Mechanical,
 * exact-statement surgery (mirrors rewriteOwnSpecifier's discipline — never a
 * content-wide replace); returns the content unchanged when nothing matches.
 */
export function rePointBindings(
  content: string,
  specifier: string,
  nameToTarget: Map<string, string>,
  specifierFor: (targetPath: string) => string,
): string {
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let changed = false
  const statementRe = new RegExp(`(import|export)(\\s+type)?\\s*\\{([^}]*)\\}\\s*from\\s*(['"])${escaped}\\4`, 'g')
  let out = content.replace(statementRe, (full, kw, typeMark, bindingsRaw, quote) => {
    const bindings = parseBindings(bindingsRaw)
    const groups = new Map<string, string[]>()
    const rest: string[] = []
    for (const b of bindings) {
      const target = nameToTarget.get(b.name)
      if (target) {
        const arr = groups.get(target) ?? []
        arr.push(b.raw)
        groups.set(target, arr)
      } else rest.push(b.raw)
    }
    if (groups.size === 0) return full
    changed = true
    const statements: string[] = []
    if (rest.length > 0) statements.push(`${kw}${typeMark ?? ''} { ${rest.join(', ')} } from ${quote}${specifier}${quote}`)
    for (const [target, names] of groups) {
      statements.push(`${kw}${typeMark ?? ''} { ${names.join(', ')} } from ${quote}${specifierFor(target)}${quote}`)
    }
    return statements.join('\n')
  })
  const defaultRe = new RegExp(`import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s*(['"])${escaped}\\2`, 'g')
  out = out.replace(defaultRe, (full, name, quote) => {
    const target = nameToTarget.get(name)
    if (!target) return full
    changed = true
    return `import ${name} from ${quote}${specifierFor(target)}${quote}`
  })
  return changed ? out : content
}

/**
 * Does `after` still BIND any of `names` from `specifier`? Precise form of the
 * relocation-completeness question: a file that legitimately keeps importing
 * OTHER names from the old module is NOT broken (the measured s4 heuristic —
 * any mention of the old specifier — falsely rejected mixed importers).
 */
function stillBindsNames(after: string, specifier: string, names: string[]): boolean {
  if (names.length === 0) return false
  const escaped = specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const namedRe = new RegExp(`(?:import|export)(?:\\s+type)?\\s*\\{([^}]*)\\}\\s*from\\s*['"]${escaped}['"]`, 'g')
  for (const m of after.matchAll(namedRe)) {
    if (parseBindings(m[1]).some((b) => names.includes(b.name))) return true
  }
  const defaultMatch = new RegExp(`import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s*['"]${escaped}['"]`).exec(after)
  if (defaultMatch && names.includes(defaultMatch[1])) return true
  return false
}

function planAffectedTests(edits: RefactorEdit[], files: Array<{ path: string; content: string }>): string[] {
  const touched = new Set(edits.map((e) => e.path))
  const tests: string[] = []
  for (const f of files) {
    if (!/(^|\/)(tests?|__tests__)(\/|\.|\b)|\.(test|spec)\.[a-z]+$/i.test(f.path)) continue
    if (touched.has(f.path)) {
      tests.push(f.path)
      continue
    }
    // Tests importing any touched module are affected too.
    const importsTouched = [...f.content.matchAll(/from\s+['"]([^'"]+)['"]/g)].some((m) => {
      const spec = m[1]
      if (!spec.startsWith('.')) return false
      const base = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''
      const segments = [...base.split('/').filter(Boolean), ...spec.split('/')]
      const out: string[] = []
      for (const seg of segments) {
        if (seg === '' || seg === '.') continue
        if (seg === '..') out.pop()
        else out.push(seg)
      }
      const resolved = out.join('/')
      return [...touched].some((t) => resolved === t || `${resolved}.ts` === t || `${resolved}.tsx` === t || `${resolved}.js` === t || `${resolved}/index.ts` === t)
    })
    if (importsTouched) tests.push(f.path)
  }
  return tests
}
