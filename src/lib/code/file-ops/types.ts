/**
 * BEAN Intelligence — CODE GIFTZ file-operation contracts (M23).
 *
 * A file operation is a STRUCTURED, SERVER-VALIDATED plan — never a free-form
 * model instruction. The user's chat message is resolved deterministically
 * against the real project file list into one of these plans; destructive
 * plans require an explicit confirmation that is cryptographically bound to
 * the exact plan (planHash) the user was shown.
 *
 * SERVER-ONLY.
 */

export type FileOpKind =
  | 'rename' // one file or folder, same parent or different name
  | 'move' // one file or folder into a different directory
  | 'delete' // one file or folder (recursive)
  | 'create' // one file or folder (empty / explicit content only)
  | 'batch-move' // multiple explicitly named files into one directory
  | 'batch-rename' // all files in a folder matching a convention
  | 'repair' // separately-approved reference repair after rename/move

export type PathTarget = {
  path: string
  /** 'folder' targets operate on every file under the path prefix. */
  isFolder: boolean
}

export type PlannedMove = {
  from: string
  to: string
  isFolder: boolean
}

export type ReferenceImpact = {
  /** Project file that references an affected path. */
  path: string
  /** 1-based line numbers carrying the reference. */
  lines: number[]
  /** One honest sample of the matched reference text. */
  sample: string
}

export type RepairEdit = {
  /** The file whose content changes. */
  path: string
  /** The exact old specifier text (replaced only at real reference sites). */
  find: string
  /** The recomputed specifier pointing at the new path. */
  replaceWith: string
}

export type FileOpPlan = {
  kind: FileOpKind
  /** Resolved source targets (every affected path is listed for batches). */
  targets: PathTarget[]
  /** Destination directory or full path (rename/move/create/batch kinds). */
  destination?: string
  /** The exact per-file mutations this plan will perform. */
  moves: PlannedMove[]
  /** Files that would be created (create / batch kinds). */
  creates?: Array<{ path: string; withContent: boolean }>
  /** Explicit content for a create-file plan (user-supplied, used verbatim). */
  createContent?: string
  /** Exact text replacements for repair plans (each reviewed before approval). */
  edits?: RepairEdit[]
  /** Paths that would be deleted (delete kind, expanded for folders). */
  deletes?: string[]
  /** Destination collisions that make the plan unexecutable as proposed. */
  conflicts: string[]
  /** Files referencing affected paths whose imports may break. */
  referenceImpact: ReferenceImpact[]
  /** Deletion requires explicit confirmation; reference repairs too. */
  requiresConfirmation: boolean
  /** Human-readable consequence summary (shown before execution). */
  consequence: string
  /** Naming convention for batch-rename (kebab-case | snake_case | camelCase | PascalCase). */
  convention?: string
}

/** Staleness binding: the plan is only valid while the recorded file states hold. */
export type StalenessEntry = { path: string; contentHash: string }

export type FileOpRecord = {
  opId: string
  kind: FileOpKind
  status: 'awaiting_confirmation' | 'executed' | 'cancelled' | 'failed' | 'stale'
  plan: FileOpPlan
  planHash: string
  createdAt: string
}

export type FileOpFailure = {
  path: string
  action: string
  reason: string
}

export type FileOpResult = {
  opId: string
  kind: FileOpKind
  /** Truthful per-mutation outcome (order matches the plan's moves/creates/deletes). */
  applied: Array<{ from?: string; to?: string; path?: string; action: string }>
  failed: FileOpFailure[]
  versionSeq: number | null
  /** Post-execution verification (content preservation, remaining references). */
  verification: {
    contentsPreserved: boolean
    remainingReferences: number
    detail: string
  }
  /** When true the result was replayed from the recorded ledger (duplicate submit / retry). */
  replayed?: boolean
  /** Offered follow-up: a separately reviewable reference-repair plan. */
  repairOffered?: {
    opId: string
    planHash: string
    affectedFiles: ReferenceImpact[]
    consequence: string
  } | null
}

/** The chat-surface payload (additive `fileOp` field on the turn response). */
export type FileOpTurnPayload = {
  status: 'executed' | 'awaiting_confirmation' | 'clarification' | 'rejected' | 'explained' | 'failed'
  kind?: FileOpKind
  opId?: string
  planHash?: string
  /** Source path(s) as resolved (or attempted). */
  source?: string[]
  destination?: string
  /** Every affected path (the full list, never a sample, for batches). */
  affectedFiles?: string[]
  conflicts?: string[]
  referenceImpact?: ReferenceImpact[]
  /** Focused clarification question (status 'clarification'). */
  question?: string
  /** Honest rejection reason (status 'rejected'). */
  reason?: string
  /** Truthful execution result (status 'executed' | 'failed'). */
  result?: FileOpResult
  versionSeq?: number | null
  /** Consequence explanation (status 'explained' or shown before confirmation). */
  consequence?: string
}

export class FileOpError extends Error {
  code: 'NOT_FOUND' | 'CONFLICT' | 'STALE' | 'INVALID' | 'PROTECTED' | 'LIMIT'
  constructor(code: FileOpError['code'], message: string) {
    super(message)
    this.code = code
  }
}
