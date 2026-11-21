'use client'

/**
 * BEAN Intelligence — CODE GIFTZ workspace (chat-first coding assistant).
 *
 * ONE conversational input (no Generate/Explain/Review/Plan tabs, no target
 * language selector). Generated code opens a real workspace: file explorer,
 * tabbed editor with syntax highlighting, editable files with Save, line
 * diffs for model changes, sandbox terminal output, and an isolated Preview
 * panel for index.html projects. Panels are resizable; the chat stays
 * available before and after code exists.
 *
 * Honesty: the workspace shows exactly what the model produced (persisted
 * server-side), diffs render real changes only, the terminal shows real
 * sandbox output, and the preview renders the real files in a sandboxed
 * iframe. Nothing claims to have run or passed unless it actually did.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Markdown, Spinner, beanFetch, timeAgo } from './shared'
import { consumeRiisheStream, streamFailureMessage, type StreamFailureInfo } from '@/lib/riishe/sse-client'
import {
  GiftzSidebarBody,
  GiftzSidebarCollapsedRail,
  GiftzSidebarMobile,
  GiftzSidebarMobileTrigger,
  type ProjectSummary,
  type SidebarActionResult,
} from './code-giftz-sidebar'
import { cn } from '@/lib/utils'
import { ResearchStatusStrip } from './research-status'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  Code2,
  Send,
  Square,
  FileCode2,
  FilePlus2,
  Pencil,
  Eye,
  GitCompareArrows,
  Terminal as TerminalIcon,
  MonitorPlay,
  CircleCheck,
  CircleX,
  Paperclip,
  X,
  MessageSquareCode,
  Save,
  BadgeCheck,
  ExternalLink,
  History,
  Download,
  AlertTriangle,
  Undo2,
  Smartphone,
  Monitor,
  RefreshCw,
  Wrench,
  MinusCircle,
  PlusCircle,
  FileMinus2,
  Copy as CopyIcon,
} from 'lucide-react'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  changes: Array<{ path: string; change: string }>
  /** Set when the turn did NOT complete: the text is the provider's partial
   *  output, honestly labeled instead of silently shown as a full answer. */
  incomplete?: boolean
  incompleteReason?: 'stopped' | 'interrupted'
  /** Self-verification summary (public fields only — no internal trace). */
  verification?: {
    status: 'verified' | 'corrected' | 'corrected-unverified' | 'unverified'
    attempts: number
    corrections: number
    issuesFound: number
  } | null
  /** ADDITIVE (shared research gateway): honest research provenance. */
  research?: {
    sources: Array<{ host: string; url: string; title: string; channel: string; backend?: string | null; engine?: string }>
    degraded: string[]
  }
  /** M23 ADDITIVE: structured file-operation payload (rename/move/delete/
   *  create/repair executed or proposed server-side — never simulated). */
  fileOp?: FileOpView
  /** M25 ADDITIVE: structured refactoring payload (planned server-side,
   *  awaiting explicit approval — never auto-executed). */
  refactor?: RefactorView
}

/** M23 — file-operation card payload (mirrors the server contract). */
interface FileOpView {
  status: 'executed' | 'awaiting_confirmation' | 'clarification' | 'rejected' | 'explained' | 'failed'
  kind?: string
  opId?: string
  planHash?: string
  source?: string[]
  destination?: string
  affectedFiles?: string[]
  conflicts?: string[]
  referenceImpact?: Array<{ path: string; lines: number[]; sample: string }>
  question?: string
  reason?: string
  consequence?: string
  versionSeq?: number | null
  result?: FileOpResultView
}
interface FileOpResultView {
  opId: string
  kind: string
  applied: Array<{ from?: string; to?: string; path?: string; action: string }>
  failed: Array<{ path: string; action: string; reason: string }>
  versionSeq: number | null
  verification: { contentsPreserved: boolean; remainingReferences: number; detail: string }
  replayed?: boolean
  repairOffered?: { opId: string; planHash: string; affectedFiles: Array<{ path: string; lines: number[]; sample: string }>; consequence: string } | null
}

/** M25 — refactoring card payload (mirrors the server contract). */
interface RefactorView {
  status: 'awaiting_confirmation' | 'executed' | 'rejected' | 'clarification' | 'failed'
  kind?: string
  opId?: string
  planHash?: string
  title?: string
  engine?: 'deterministic' | 'provider-assisted'
  reason?: string
  steps?: string[]
  affectedFiles?: string[]
  createdPaths?: string[]
  editsPreview?: Array<{ path: string; changeType: string; addedLines: number; removedLines: number }>
  risks?: string[]
  unresolved?: Array<{ path: string; specifier: string; note: string }>
  conflicts?: string[]
  question?: string
  consequence?: string
  versionSeq?: number | null
  result?: RefactorResultView
}
interface RefactorResultView {
  opId: string
  kind: string
  status: string
  applied: Array<{ path: string; action: string }>
  failed: Array<{ path: string; reason: string }>
  versionSeq: number | null
  verification: { contentsPreserved: boolean; unresolvedImports: number; duplicateExports: Array<{ name: string; paths: string[] }>; integrityDetail: string }
  replayed?: boolean
}
interface ProjectFile { path: string; content: string; origin: 'generated' | 'modified'; updatedAt?: string }
interface FileChange {
  path: string
  change: 'added' | 'modified'
  diff: Array<{ type: 'add' | 'del' | 'ctx'; text: string }>
}
interface RunResult {
  runId: string
  entry: string | null
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
}
interface FileMeta { id: string; name: string; kind: string; size: number; status: 'ready' | 'unsupported' | 'failed'; note?: string }

/** M22 — project version summary from /versions. */
interface VersionSummary {
  id: string
  seq: number
  kind: 'initial' | 'turn' | 'manual' | 'rollback' | 'file-save' | 'file-delete' | 'file-op' | 'repair' | 'refactor'
  summary: string | null
  fileCount: number
  changedFiles: Array<{ path: string; change: 'added' | 'modified' | 'deleted' | 'renamed'; previousPath?: string }>
  createdAt: string
}
/** M22 — comparison payload from /versions/<seq>/compare. */
interface VersionComparison {
  from: { seq: number | null; label: string }
  to: { seq: number | null; label: string }
  added: string[]
  deleted: string[]
  renamed: Array<{ path: string; previousPath: string }>
  modified: Array<{ path: string; added: number; removed: number }>
  diffs: Record<string, Array<{ type: 'add' | 'del' | 'ctx'; text: string }>>
  truncated: boolean
}
/** M22 — preview audit payload from /preview-check. */
interface PreviewAuditData {
  entry: string | null
  missingAssets: Array<{ file: string; reference: string; resolved: string }>
  brokenInternalLinks: Array<{ file: string; target: string }>
  externalReferences: Array<{ file: string; url: string }>
  notes: string[]
  scope: string[]
}
/** A REAL console/runtime observation collected from the preview iframe. */
interface PreviewObservation {
  type: 'console-error' | 'console-warn' | 'pageerror' | 'unhandledrejection'
  message: string
  detail: string
  at: number
}

const WELCOME =
  "Hi! I'm CODE GIFTZ, your coding assistant. Describe what you want to build, debug, refactor or review — I'll write the files, and you can run them in the sandbox or open a live preview."

const FILE_OP_KIND_LABEL: Record<string, string> = {
  rename: 'Rename',
  move: 'Move',
  delete: 'Delete',
  create: 'Create',
  'batch-move': 'Batch move',
  'batch-rename': 'Batch rename',
  repair: 'Reference repair',
}

const FILE_OP_STATUS_STYLE: Record<FileOpView['status'], string> = {
  executed: 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  awaiting_confirmation: 'border border-amber-500/40 bg-amber-500/10 text-amber-300',
  clarification: 'border border-white/12 bg-white/5 text-white/50',
  rejected: 'border border-red-500/30 bg-red-500/10 text-red-300',
  explained: 'border border-white/12 bg-white/5 text-white/50',
  failed: 'border border-red-500/30 bg-red-500/10 text-red-300',
}

const REFACTOR_KIND_LABEL: Record<string, string> = {
  'rename-symbol': 'Rename symbol',
  'move-module': 'Move modules + update imports',
  'extract-component': 'Extract component',
  'extract-module': 'Extract module',
  'service-layer': 'Service-layer extraction',
  consolidate: 'Consolidate',
  restructure: 'Restructure',
  repair: 'Targeted repair',
}

const REFACTOR_STATUS_STYLE: Record<RefactorView['status'], string> = {
  executed: 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  awaiting_confirmation: 'border border-amber-500/40 bg-amber-500/10 text-amber-300',
  clarification: 'border border-white/12 bg-white/5 text-white/50',
  rejected: 'border border-red-500/30 bg-red-500/10 text-red-300',
  failed: 'border border-red-500/30 bg-red-500/10 text-red-300',
}

/** M23 — the transcript card for one structured file operation. Shows the
 *  detected operation, every affected path, conflicts, reference impact, the
 *  confirmation action (destructive ops), the execution progress and the
 *  truthful final result with its recorded version. Same visual language as
 *  the versions panel (gold-on-dark, semantic badge colors). */
function FileOpCard(props: {
  op: FileOpView
  disabled: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  onRepair: () => void
}) {
  const { op, disabled, busy, onConfirm, onCancel, onRepair } = props
  if (op.status === 'clarification') return null // the question text is the answer
  const kindLabel = FILE_OP_KIND_LABEL[op.kind ?? ''] ?? 'File operation'
  return (
    <div className="mt-2 rounded-lg border border-[rgba(212,175,55,0.25)] bg-black/20 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <FileMinus2 className="h-3.5 w-3.5 text-[#f0c75e]" />
        <span className="text-[11px] font-medium text-white/85">{kindLabel}</span>
        <span className={cn('rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide', FILE_OP_STATUS_STYLE[op.status])}>
          {op.status === 'awaiting_confirmation' ? 'needs confirmation' : op.status.replace('_', ' ')}
        </span>
        {op.result?.replayed ? (
          <span className="rounded border border-white/12 px-1 py-0.5 text-[9px] text-white/40">replayed — already executed</span>
        ) : null}
        {op.versionSeq ? (
          <span className="rounded border border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.08)] px-1.5 py-0.5 text-[9px] text-[#f0c75e]">v{op.versionSeq}</span>
        ) : null}
      </div>

      {(op.source?.length ?? 0) > 0 || op.destination ? (
        <div className="mt-1.5 space-y-0.5 font-mono text-[10.5px] leading-snug text-white/60">
          {(op.source ?? []).map((s) => (
            <div key={s} className="break-all">
              <span className="text-white/40">from</span> {s}
              {op.destination ? <span className="text-white/40"> → {op.destination}</span> : null}
            </div>
          ))}
          {(op.source?.length ?? 0) === 0 && op.destination ? (
            <div className="break-all">
              <span className="text-white/40">path</span> {op.destination}
            </div>
          ) : null}
        </div>
      ) : null}

      {(op.affectedFiles?.length ?? 0) > 0 ? (
        <div className="mt-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/35">Affected ({op.affectedFiles?.length})</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {(op.affectedFiles ?? []).map((f) => (
              <span key={f} className="max-w-full break-all rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/55">
                {f}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {(op.conflicts?.length ?? 0) > 0 ? (
        <p className="mt-1.5 text-[10.5px] leading-snug text-red-300">Conflict: {(op.conflicts ?? []).join(', ')} already exist(s) — nothing was changed.</p>
      ) : null}
      {(op.referenceImpact?.length ?? 0) > 0 ? (
        <p className="mt-1.5 text-[10.5px] leading-snug text-amber-300">
          {op.referenceImpact?.length} file(s) reference the affected path(s) and may break: {op.referenceImpact?.map((r) => r.path).slice(0, 4).join(', ')}
          {(op.referenceImpact?.length ?? 0) > 4 ? '…' : ''} — a separate reviewable repair is offered after execution.
        </p>
      ) : null}
      {op.consequence ? <p className="mt-1.5 text-[10.5px] leading-snug text-white/45">{op.consequence}</p> : null}
      {op.reason ? <p className="mt-1.5 text-[10.5px] leading-snug text-red-300">{op.reason}</p> : null}

      {op.status === 'awaiting_confirmation' ? (
        <div className="mt-2 flex items-center gap-1.5">
          <button
            onClick={onConfirm}
            disabled={disabled}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-1 text-[10.5px] font-medium disabled:opacity-40',
              op.kind === 'delete' ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-[#d4af37] text-black hover:bg-[#e6c25a]',
            )}
          >
            {busy ? <Spinner className="h-3 w-3" /> : null} Confirm {kindLabel.toLowerCase()}
          </button>
          <button
            onClick={onCancel}
            disabled={disabled}
            className="rounded border border-white/10 px-2 py-1 text-[10.5px] text-white/50 hover:border-[rgba(212,175,55,0.3)] hover:text-white/80 disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {op.status === 'executed' && op.result ? (
        <div className="mt-1.5 border-t border-[rgba(212,175,55,0.12)] pt-1.5">
          <p className={cn('text-[10.5px] leading-snug', op.result.verification.contentsPreserved ? 'text-white/45' : 'text-red-300')}>
            {op.result.verification.detail}
          </p>
          {op.result.failed.length > 0 ? (
            <p className="mt-1 text-[10.5px] leading-snug text-red-300">{op.result.failed[0].reason}</p>
          ) : null}
          {op.result.repairOffered ? (
            <button
              onClick={onRepair}
              disabled={disabled}
              className="mt-1.5 inline-flex items-center gap-1 rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
            >
              <Wrench className="h-3 w-3" />
              Review repair ({op.result.repairOffered.affectedFiles.length} file{op.result.repairOffered.affectedFiles.length === 1 ? '' : 's'})
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** M25 — the transcript card for one structured refactoring plan: summary,
 *  affected files, before/after shape, risks and unresolved references,
 *  validation status after execution, version + rollback availability.
 *  Never shows a simulated outcome — everything comes from the server. */
function RefactorCard(props: {
  plan: RefactorView
  disabled: boolean
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
  onOpenFile: (path: string) => void
}) {
  const { plan, disabled, busy, onConfirm, onCancel, onOpenFile } = props
  if (plan.status === 'clarification') return null // the question text is the answer
  const kindLabel = REFACTOR_KIND_LABEL[plan.kind ?? ''] ?? 'Refactoring'
  return (
    <div className="mt-2 rounded-lg border border-[rgba(212,175,55,0.25)] bg-black/20 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <GitCompareArrows className="h-3.5 w-3.5 text-[#f0c75e]" />
        <span className="text-[11px] font-medium text-white/85">{kindLabel}</span>
        <span className={cn('rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide', REFACTOR_STATUS_STYLE[plan.status])}>
          {plan.status === 'awaiting_confirmation' ? 'needs approval' : plan.status.replace('_', ' ')}
        </span>
        <span className="rounded border border-white/12 px-1 py-0.5 text-[9px] text-white/40">
          {plan.engine === 'deterministic' ? 'deterministic — no model call' : 'provider-assisted draft, server-validated'}
        </span>
        {plan.result?.replayed ? (
          <span className="rounded border border-white/12 px-1 py-0.5 text-[9px] text-white/40">replayed — already executed</span>
        ) : null}
        {(plan.versionSeq ?? plan.result?.versionSeq) ? (
          <span className="rounded border border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.08)] px-1.5 py-0.5 text-[9px] text-[#f0c75e]">
            v{plan.versionSeq ?? plan.result?.versionSeq}
          </span>
        ) : null}
      </div>

      {plan.title ? <p className="mt-1.5 text-[11px] font-medium text-white/80">{plan.title}</p> : null}
      {plan.reason ? <p className="mt-0.5 text-[10.5px] leading-snug text-white/45">{plan.reason}</p> : null}

      {(plan.editsPreview?.length ?? 0) > 0 ? (
        <div className="mt-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/35">Before → after ({plan.editsPreview?.length} file(s))</p>
          <div className="mt-1 space-y-0.5">
            {(plan.editsPreview ?? []).map((e) => (
              <button
                key={e.path}
                onClick={() => onOpenFile(e.path)}
                className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left font-mono text-[10px] text-white/60 hover:bg-white/5"
              >
                <span
                  className={cn(
                    'rounded px-1 py-0.5 text-[8.5px] uppercase',
                    e.changeType === 'create' ? 'bg-emerald-500/15 text-emerald-300' : e.changeType === 'move-content' ? 'bg-sky-500/15 text-sky-300' : 'bg-[rgba(212,175,55,0.12)] text-[#f0c75e]',
                  )}
                >
                  {e.changeType}
                </span>
                <span className="break-all">{e.path}</span>
                <span className="ml-auto shrink-0 text-emerald-300">+{e.addedLines}</span>
                <span className="shrink-0 text-red-300">-{e.removedLines}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {(plan.risks?.length ?? 0) > 0 ? (
        <div className="mt-1.5">
          <p className="text-[10px] uppercase tracking-wide text-amber-300/70">Risks</p>
          <ul className="mt-0.5 list-inside list-disc space-y-0.5">
            {(plan.risks ?? []).slice(0, 4).map((r, i) => (
              <li key={i} className="text-[10.5px] leading-snug text-amber-300/90">{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {(plan.unresolved?.length ?? 0) > 0 ? (
        <div className="mt-1.5">
          <p className="text-[10px] uppercase tracking-wide text-white/35">Unresolved references (listed, never rewritten)</p>
          <ul className="mt-0.5 space-y-0.5">
            {(plan.unresolved ?? []).slice(0, 5).map((u, i) => (
              <li key={i} className="text-[10.5px] leading-snug text-white/45">
                <span className="font-mono text-white/60">{u.path}</span> — {u.note}
              </li>
            ))}
            {(plan.unresolved?.length ?? 0) > 5 ? <li className="text-[10px] text-white/35">… and {(plan.unresolved?.length ?? 0) - 5} more</li> : null}
          </ul>
        </div>
      ) : null}

      {plan.consequence ? <p className="mt-1.5 text-[10.5px] leading-snug text-white/45">{plan.consequence}</p> : null}
      {plan.reason && (plan.status === 'rejected' || plan.status === 'failed') ? (
        <p className="mt-1.5 text-[10.5px] leading-snug text-red-300">{plan.reason}</p>
      ) : null}

      {plan.status === 'awaiting_confirmation' ? (
        <div className="mt-2 flex items-center gap-1.5">
          <button
            onClick={onConfirm}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded bg-[#d4af37] px-2 py-1 text-[10.5px] font-medium text-black hover:bg-[#e6c25a] disabled:opacity-40"
          >
            {busy ? <Spinner className="h-3 w-3" /> : null} Approve &amp; execute
          </button>
          <button
            onClick={onCancel}
            disabled={disabled}
            className="rounded border border-white/10 px-2 py-1 text-[10.5px] text-white/50 hover:border-[rgba(212,175,55,0.3)] hover:text-white/80 disabled:opacity-40"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {plan.status === 'executed' && plan.result ? (
        <div className="mt-1.5 border-t border-[rgba(212,175,55,0.12)] pt-1.5">
          <p className={cn('text-[10.5px] leading-snug', plan.result.verification.contentsPreserved ? 'text-white/45' : 'text-red-300')}>
            {plan.result.verification.integrityDetail}
          </p>
          {plan.result.verification.unresolvedImports > 0 ? (
            <p className="mt-0.5 text-[10.5px] leading-snug text-amber-300">
              {plan.result.verification.unresolvedImports} unresolved relative import(s) remain — review them in the workspace.
            </p>
          ) : null}
          {plan.result.verification.duplicateExports.length > 0 ? (
            <p className="mt-0.5 text-[10.5px] leading-snug text-amber-300">
              Duplicate export(s): {plan.result.verification.duplicateExports.map((d) => d.name).slice(0, 4).join(', ')}
            </p>
          ) : null}
          {plan.result.failed.length > 0 ? <p className="mt-0.5 text-[10.5px] leading-snug text-red-300">{plan.result.failed[0].reason}</p> : null}
          <p className="mt-0.5 text-[10px] text-white/35">Rollback available from the Versions panel (rollback records a NEW version — history is never rewritten).</p>
        </div>
      ) : null}
    </div>
  )
}

function langOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    ts: 'typescript', tsx: 'typescript',
    py: 'python', html: 'html', css: 'css', json: 'json', md: 'markdown', sql: 'sql',
  }
  return map[ext] ?? 'text'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/** Keep interrupted/streaming answers READABLE: an unterminated ``` fence
 *  (a stream cut mid-code-block) would otherwise render as broken text.
 *  Closing the odd fence renders everything received so far as the code
 *  block the model was writing. Complete answers always have balanced
 *  fences, so this is a no-op for them and is only applied to
 *  incomplete/in-flight messages. */
export function closeUnbalancedFences(text: string): string {
  const fenceLines = text.split('\n').filter((l) => l.trimStart().startsWith('```'))
  return fenceLines.length % 2 === 1 ? `${text.replace(/\n*$/, '')}\n\n\`\`\`` : text
}

export function CodeGiftz() {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectId, setProjectId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [thinking, setThinking] = useState(false)
  /** Self-verification stage indicator (only set when the pipeline is enabled). */
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [fileView, setFileView] = useState<'code' | 'diff'>('code')
  const [editing, setEditing] = useState(false)
  const [editBuffer, setEditBuffer] = useState('')
  const [saving, setSaving] = useState(false)
  const [run, setRun] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [lastChanges, setLastChanges] = useState<FileChange[]>([])
  const [attachments, setAttachments] = useState<FileMeta[]>([])
  const [uploading, setUploading] = useState(false)
  const [workspaceWidth, setWorkspaceWidth] = useState(46) // percent of the row
  // Sidebar (ChatGPT-style): search query (debounced server fetch), the
  // mobile Sheet drawer, and the desktop collapsed rail.
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  // M22 — persistence & versioning UI state.
  const [showArchived, setShowArchived] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [versions, setVersions] = useState<VersionSummary[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionCompare, setVersionCompare] = useState<{ seq: number; data: VersionComparison } | null>(null)
  const [versionBusy, setVersionBusy] = useState(false)
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [previewObservations, setPreviewObservations] = useState<PreviewObservation[]>([])
  const [previewAudit, setPreviewAudit] = useState<PreviewAuditData | null>(null)
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'mobile'>('desktop')
  // M23 — file-operation cards: busy op (spinner on its buttons) and the
  // pending destructive confirmation (deletion / reference repair).
  const [fileOpBusy, setFileOpBusy] = useState<string | null>(null)
  const [confirmingFileOp, setConfirmingFileOp] = useState<{ messageId: string; opId: string; title: string; detail: string; destructive: boolean; target?: 'file-op' | 'refactor' } | null>(null)
  // Cache-buster: bumped after accepted changes so the iframe re-fetches the
  // fresh preview (the route serves no-store; this also forces a re-render).
  const [previewKey, setPreviewKey] = useState(0)
  const endRef = useRef<HTMLDivElement>(null)
  const streamedRef = useRef('')
  const abortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<HTMLElement | null>(null)
  const workspaceRef = useRef<HTMLDivElement>(null)
  // Synchronous double-submit guard: two rapid Enters/clicks in the same tick
  // both saw `streaming === false` with state alone (measured defect class).
  const streamingRef = useRef(false)
  // Prompt of the latest turn — powers the Retry action (cleared on success).
  const lastPromptRef = useRef<string | null>(null)
  // The assistant bubble currently being streamed (for the fence fix).
  const streamingAsstIdRef = useRef<string | null>(null)
  // NOTE (UI restriction): the frontend intelligence library is INTERNAL.
  // There is deliberately NO Frontend Toolkit selector or summary in the UI —
  // the engine resolves everything automatically from the user's request.

  const hasHtml = files.some((f) => f.path === 'index.html' || f.path === 'main.html')

  const loadProjects = useCallback(async (q?: string) => {
    try {
      // M22: the sidebar fetch now always carries includeArchived=1 (each row
      // carries its status; the archived view's restore lives there). The
      // pinned search contract (?q= + encodeURIComponent + shared filter) is
      // unchanged.
      const query = q?.trim() ? `?q=${encodeURIComponent(q.trim())}&includeArchived=1` : '?includeArchived=1'
      const d = await beanFetch<{ projects: ProjectSummary[] }>(`/api/code-giftz/chat${query}`)
      setProjects(d.projects)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => { void loadProjects() }, [loadProjects])

  // Debounced sidebar search: 250ms after the query settles, the server
  // filters across ALL of the user's conversations (not just the recent 50).
  useEffect(() => {
    const q = searchQuery.trim()
    if (q.length === 0) {
      setSearching(false)
      void loadProjects()
      return
    }
    setSearching(true)
    const t = setTimeout(() => {
      void (async () => {
        try {
          const d = await beanFetch<{ projects: ProjectSummary[] }>(
            `/api/code-giftz/chat?q=${encodeURIComponent(q)}&includeArchived=1`,
          )
          setProjects(d.projects)
        } catch { /* non-fatal — the last list stays visible */ }
        setSearching(false)
      })()
    }, 250)
    return () => clearTimeout(t)
  }, [searchQuery, loadProjects])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, streaming, thinking, verifying])
  // Unmount during generation stops the request instead of leaving an
  // orphaned stream running (and its server-side generation continuing).
  useEffect(
    () => () => {
      abortRef.current?.abort()
    },
    [],
  )

  async function openProject(id: string) {
    setError(null)
    setRun(null)
    setShowPreview(false)
    setVersionsOpen(false)
    setVersionCompare(null)
    setPreviewObservations([])
    setPreviewAudit(null)
    try {
      const d = await beanFetch<{
        project: {
          id: string
          title: string
          messages: Array<{ id: string; role: string; content: string; changes: Array<{ path: string; change: string }>; fileOp?: FileOpView; refactor?: RefactorView }>
          files: Array<{ path: string; content: string; origin: 'generated' | 'modified'; updatedAt?: string }>
        }
      }>(`/api/code-giftz/chat/${id}`)
      setProjectId(d.project.id)
      setMessages(d.project.messages.map((m) => ({ id: m.id, role: m.role as 'user' | 'assistant', content: m.content, changes: m.changes ?? [], ...(m.fileOp ? { fileOp: m.fileOp as FileOpView } : {}), ...(m.refactor ? { refactor: m.refactor as RefactorView } : {}) })))
      setFiles(d.project.files.map((f) => ({ path: f.path, content: f.content, origin: f.origin, updatedAt: f.updatedAt })))
      const first = d.project.files[0]
      setOpenTabs(first ? [first.path] : [])
      setActiveFile(first?.path ?? null)
      setFileView('code')
      setEditing(false)
      // M22: record the open (lastOpenedAt metadata) + refresh the preview
      // audit so the workspace shows honest structural evidence immediately.
      void beanFetch(`/api/code-giftz/projects/${id}/open`, { method: 'POST' }).catch(() => undefined)
      void refreshPreviewAudit(id)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  function newProject() {
    setProjectId(null)
    setMessages([])
    setFiles([])
    setOpenTabs([])
    setActiveFile(null)
    setRun(null)
    setError(null)
    setAttachments([])
    setShowPreview(false)
    setVersionsOpen(false)
    setVersionCompare(null)
    setPreviewObservations([])
    setPreviewAudit(null)
  }

  /** Sidebar rename (owner-checked server-side; sanitizer is the same pure
   *  helper RIISHE uses). Returns a result shape so the dialog can show an
   *  honest failure instead of closing over an error. */
  async function renameProject(id: string, title: string): Promise<SidebarActionResult> {
    try {
      await beanFetch(`/api/code-giftz/chat/${id}`, { method: 'PATCH', json: { title } })
      await loadProjects(searchQuery)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  /** Sidebar delete — called ONLY from the confirmation dialog. */
  async function deleteProject(id: string): Promise<SidebarActionResult> {
    try {
      await beanFetch(`/api/code-giftz/chat/${id}`, { method: 'DELETE' })
      if (projectId === id) newProject()
      await loadProjects(searchQuery)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  // ---- M23 file-operation handlers (confirm/cancel from the chat cards) ----

  /** Refresh the workspace files from the server (same semantics as the
   *  in-turn helper; usable outside a streaming turn). */
  function refreshWorkspaceFiles(pid: string) {
    void (async () => {
      try {
        const d = await beanFetch<{ project: { files: ProjectFile[] } }>(`/api/code-giftz/chat/${pid}`)
        setFiles(d.project.files)
        setOpenTabs((prev) => {
          const merged = [...prev]
          for (const f of d.project.files) if (!merged.includes(f.path)) merged.push(f.path)
          return merged
        })
      } catch { /* non-fatal */ }
    })()
  }

  async function executeFileOp(pid: string, opId: string, messageId: string) {
    setFileOpBusy(opId)
    try {
      const d = await beanFetch<{ result: FileOpResultView }>(
        `/api/code-giftz/projects/${pid}/file-ops/execute`,
        { method: 'POST', json: { opId } },
      )
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId && msg.fileOp
            ? { ...msg, fileOp: { ...msg.fileOp, status: 'executed' as const, result: d.result, versionSeq: d.result.versionSeq } }
            : msg,
        ),
      )
      refreshWorkspaceFiles(pid)
      setPreviewKey((k) => k + 1)
      void refreshPreviewAudit(pid)
      void loadProjects(searchQuery)
      if (versionsOpen) void openVersions()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setFileOpBusy(null)
    }
  }

  async function cancelFileOp(pid: string, opId: string, messageId: string) {
    setFileOpBusy(opId)
    try {
      await beanFetch(`/api/code-giftz/projects/${pid}/file-ops/cancel`, { method: 'POST', json: { opId } })
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId && msg.fileOp
            ? { ...msg, fileOp: { ...msg.fileOp, status: 'rejected' as const, reason: 'Cancelled — nothing was changed.' } }
            : msg,
        ),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setFileOpBusy(null)
    }
  }

  // ---- M25 refactoring execution (same ledger + confirmation endpoint; the
  // server dispatches 'refactor' rows to the atomic multi-file executor) ----
  async function executeRefactor(pid: string, opId: string, messageId: string) {
    setFileOpBusy(opId)
    try {
      const d = await beanFetch<{ result: RefactorResultView }>(
        `/api/code-giftz/projects/${pid}/file-ops/execute`,
        { method: 'POST', json: { opId } },
      )
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId && msg.refactor
            ? { ...msg, refactor: { ...msg.refactor, status: 'executed' as const, result: d.result, versionSeq: d.result.versionSeq } }
            : msg,
        ),
      )
      refreshWorkspaceFiles(pid)
      setPreviewKey((k) => k + 1)
      void refreshPreviewAudit(pid)
      void loadProjects(searchQuery)
      if (versionsOpen) void openVersions()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setFileOpBusy(null)
    }
  }

  async function cancelRefactor(pid: string, opId: string, messageId: string) {
    setFileOpBusy(opId)
    try {
      await beanFetch(`/api/code-giftz/projects/${pid}/file-ops/cancel`, { method: 'POST', json: { opId } })
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId && msg.refactor
            ? { ...msg, refactor: { ...msg.refactor, status: 'rejected' as const, reason: 'Cancelled — nothing was changed.' } }
            : msg,
        ),
      )
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setFileOpBusy(null)
    }
  }

  // ---- M22 project lifecycle handlers (duplicate / archive / restore) ----

  async function duplicateProject(id: string): Promise<SidebarActionResult> {
    try {
      await beanFetch(`/api/code-giftz/projects/${id}/duplicate`, { method: 'POST' })
      await loadProjects(searchQuery)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async function archiveProject(id: string): Promise<SidebarActionResult> {
    try {
      await beanFetch(`/api/code-giftz/projects/${id}/archive`, { method: 'POST' })
      if (projectId === id) newProject() // an archived project leaves the editor
      await loadProjects(searchQuery)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  async function restoreProject(id: string): Promise<SidebarActionResult> {
    try {
      await beanFetch(`/api/code-giftz/projects/${id}/restore`, { method: 'POST' })
      await loadProjects(searchQuery)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }

  // ---- M22 version history handlers ----

  async function openVersions() {
    if (!projectId) return
    setVersionsOpen(true)
    setVersionsLoading(true)
    setVersionCompare(null)
    try {
      const d = await beanFetch<{ versions: VersionSummary[] }>(`/api/code-giftz/projects/${projectId}/versions`)
      setVersions(d.versions)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setVersionsLoading(false)
    }
  }

  async function compareVersion(seq: number) {
    if (!projectId || versionBusy) return
    setVersionBusy(true)
    setError(null)
    try {
      const d = await beanFetch<{ comparison: VersionComparison }>(
        `/api/code-giftz/projects/${projectId}/versions/${seq}/compare?target=current`,
      )
      setVersionCompare({ seq, data: d.comparison })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setVersionBusy(false)
    }
  }

  /** Rollback = restore = create a NEW version (history never rewritten). */
  async function restoreVersion(seq: number) {
    if (!projectId || versionBusy) return
    setVersionBusy(true)
    setRestoringVersion(seq)
    setError(null)
    try {
      await beanFetch(`/api/code-giftz/projects/${projectId}/versions/${seq}/rollback`, { method: 'POST' })
      // The workspace changed on the server — reload it and the preview.
      await openProject(projectId)
      setPreviewKey((k) => k + 1)
      await openVersions()
      void loadProjects()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setVersionBusy(false)
      setRestoringVersion(null)
    }
  }

  // ---- M22 export handler (browser download) ----

  async function exportProject() {
    if (!projectId || exporting) return
    setExporting(true)
    setError(null)
    try {
      const res = await fetch(`/api/code-giftz/projects/${projectId}/export`)
      if (res.status === 401) window.dispatchEvent(new Event('bean:unauthorized'))
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(text || `Export failed (${res.status})`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'project.zip'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  // ---- M22 preview evidence (REAL observations only) ----

  // In-browser observations from the sandboxed preview iframe arrive via
  // postMessage with the `giftz-preview` source marker. Anything else is
  // ignored — this strip never shows invented errors.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      const d = ev.data as { source?: string; type?: string; message?: string; detail?: string }
      if (!d || d.source !== 'giftz-preview' || !d.type) return
      if (d.type !== 'console-error' && d.type !== 'console-warn' && d.type !== 'pageerror' && d.type !== 'unhandledrejection') return
      setPreviewObservations((prev) => [
        ...prev.slice(-49),
        { type: d.type as PreviewObservation['type'], message: d.message ?? '', detail: d.detail ?? '', at: Date.now() },
      ])
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Deterministic preview audit (missing assets / broken links) — refreshed
  // with the workspace files.
  const refreshPreviewAudit = useCallback(async (pid: string | null) => {
    if (!pid) {
      setPreviewAudit(null)
      return
    }
    try {
      const d = await beanFetch<{ audit: PreviewAuditData }>(`/api/code-giftz/projects/${pid}/preview-check`)
      setPreviewAudit(d.audit)
    } catch {
      setPreviewAudit(null) // non-fatal — the audit is advisory evidence
    }
  }, [])

  /** Compose a repair request from REAL preview evidence (user still sends it
   *  through the normal chat turn — approval flows stay intact). */
  function repairFromEvidence() {
    const lines: string[] = []
    for (const o of previewObservations.slice(-6)) {
      lines.push(`- ${o.type}: ${o.message}${o.detail ? ` (${o.detail})` : ''}`)
    }
    if (previewAudit) {
      for (const m of previewAudit.missingAssets.slice(0, 4)) lines.push(`- missing asset: ${m.reference} referenced from ${m.file}`)
      for (const l of previewAudit.brokenInternalLinks.slice(0, 4)) lines.push(`- broken internal link: ${l.target} referenced from ${l.file}`)
    }
    if (lines.length === 0) return
    setInput(
      `The preview shows real problems — please repair them with targeted edits:\n${lines.join('\n')}\n\nFix only what is needed to resolve these problems and keep the rest of the project unchanged.`,
    )
  }

  async function uploadFile(file: File) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/riishe/documents', { method: 'POST', body: form })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) window.dispatchEvent(new Event('bean:unauthorized'))
    if (!res.ok) throw new Error(data?.error?.message ?? `Upload failed (${res.status})`)
    return data.document as FileMeta
  }

  async function uploadFiles(list: FileList | File[]) {
    if (uploading || attachments.length >= 3) return
    setUploading(true)
    setError(null)
    try {
      for (const f of Array.from(list).slice(0, 3 - attachments.length)) {
        const doc = await uploadFile(f)
        setAttachments((prev) => [...prev, doc])
        if (doc.status === 'unsupported') {
          setError(`${doc.name}: ${doc.note ?? 'cannot be analyzed'}`)
        }
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function openFile(path: string) {
    setActiveFile(path)
    setFileView('code')
    setEditing(false)
    setOpenTabs((prev) => (prev.includes(path) ? prev : [...prev, path]))
  }

  async function saveEdit() {
    if (!activeFile || !projectId) return
    setSaving(true)
    setError(null)
    try {
      const activeRow = files.find((f) => f.path === activeFile)
      await beanFetch<{ versionSeq: number | null }>(`/api/code-giftz/projects/${projectId}/files`, {
        method: 'POST',
        json: {
          path: activeFile,
          content: editBuffer,
          // M22 optimistic concurrency: refuse the save when the file changed
          // elsewhere since it was loaded (honest conflict, no silent clobber).
          ...(activeRow?.updatedAt ? { expectedUpdatedAt: activeRow.updatedAt } : {}),
        },
      })
      const savedAt = new Date().toISOString()
      setFiles((prev) => prev.map((f) => (f.path === activeFile ? { ...f, content: editBuffer, origin: 'modified', updatedAt: savedAt } : f)))
      setEditing(false)
      setPreviewKey((k) => k + 1)
      void refreshPreviewAudit(projectId)
      void loadProjects(searchQuery)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  /** M22 — delete the active workspace file (records a file-delete version). */
  async function deleteActiveFile() {
    if (!activeFile || !projectId) return
    setError(null)
    try {
      await beanFetch(`/api/code-giftz/projects/${projectId}/files`, {
        method: 'DELETE',
        json: { path: activeFile },
      })
      setOpenTabs((prev) => prev.filter((p) => p !== activeFile))
      const remaining = files.filter((f) => f.path !== activeFile)
      setFiles(remaining)
      setActiveFile(remaining[0]?.path ?? null)
      setPreviewKey((k) => k + 1)
      void refreshPreviewAudit(projectId)
      void loadProjects(searchQuery)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  async function runInSandbox() {
    if (!projectId || running) return
    setRunning(true)
    setRun(null)
    setError(null)
    try {
      const d = await beanFetch<{ run: RunResult }>(`/api/code-giftz/projects/${projectId}/run`, {
        method: 'POST',
        json: { approval: true },
      })
      setRun(d.run)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  function stopGeneration() {
    abortRef.current?.abort()
  }

  /**
   * Send one chat turn over SSE.
   *
   * ROOT-CAUSE FIX (2026-11-03 "network error"): the previous loop read the
   * body with a hand-rolled line splitter and surfaced raw browser errors —
   * a transport death mid-generation reached the user as Chromium's literal
   * `TypeError: network error`, with no completion/interrupted distinction,
   * no watchdog, no retry, and no protected partial text.
   *
   * The turn is now consumed by the SAME hardened client the RIISHE product
   * uses (consumeRiisheStream): spec-correct SSE frames (LF/CRLF, multiline,
   * keepalive comments, final-flush), streaming UTF-8 decode, a 60s idle
   * watchdog, and typed failure categories. Partial text is always preserved
   * and honestly labeled; failures get actionable wording plus a safe Retry
   * (the failed turn never persisted an assistant answer, and the server
   * collapses the duplicated trailing prompt so history stays clean).
   */
  async function send(overrideMessage?: string) {
    const message = (overrideMessage ?? input).trim()
    if (!message || streamingRef.current) return
    if (overrideMessage === undefined) setInput('')
    setError(null)
    setStreaming(true)
    streamingRef.current = true
    setThinking(true)
    setVerifying(false)
    streamedRef.current = ''
    lastPromptRef.current = message

    const tempId = `u-${Date.now()}`
    const asstId = `a-${Date.now()}`
    streamingAsstIdRef.current = asstId
    setMessages((prev) => [...prev, { id: tempId, role: 'user', content: message, changes: [] }, { id: asstId, role: 'assistant', content: '', changes: [] }])

    const controller = new AbortController()
    abortRef.current = controller
    const readyFiles = attachments.filter((f) => f.status === 'ready')

    /** Refresh the workspace from the server (source of truth). */
    const refreshFiles = (pid: string | null) => {
      if (!pid) return
      void (async () => {
        try {
          const d = await beanFetch<{ project: { files: ProjectFile[] } }>(`/api/code-giftz/chat/${pid}`)
          setFiles(d.project.files)
          setOpenTabs((prev) => {
            const merged = [...prev]
            for (const f of d.project.files) if (!merged.includes(f.path)) merged.push(f.path)
            return merged
          })
          if (!activeFile && d.project.files.length > 0) setActiveFile(d.project.files[0].path)
        } catch { /* non-fatal */ }
      })()
    }

    try {
      const res = await fetch(`/api/code-giftz/chat?stream=1${projectId ? `&projectId=${projectId}` : ''}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          projectId: projectId ?? undefined,
          fileIds: readyFiles.length > 0 ? readyFiles.map((f) => f.id) : undefined,
        }),
        signal: controller.signal,
      })
      if (!res.ok || !res.body) {
        if (res.status === 401) window.dispatchEvent(new Event('bean:unauthorized'))
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error?.message ?? `Request failed (${res.status})`)
      }

      let newProjectId: string | null = projectId
      // The server's typed error frame (rate-limited, timeout, truncation…)
      // is the honest reason — it outranks the generic 'protocol' failure
      // the consumer reports when the stream closes after that frame.
      let serverError: { message: string; code: string } | null = null

      await consumeRiisheStream(
        res,
        {
          onEvent: (evt) => {
            if (evt.projectId) newProjectId = evt.projectId
            if (evt.stage === 'thinking') setThinking(true)
            // Self-verification stages (additive, only sent when the operator
            // enabled the pipeline): 'verifying' keeps the draft visible;
            // 'revising' means the deltas that follow REPLACE the buffer.
            if (evt.stage === 'verifying') setVerifying(true)
            if (evt.stage === 'revising') {
              setVerifying(false)
              streamedRef.current = ''
              setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, content: '' } : m)))
            }
            if (evt.error) serverError = { message: evt.error, code: evt.code ?? 'BACKEND_FAILURE' }
            if (evt.delta) {
              streamedRef.current += evt.delta
              setThinking(false)
              setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, content: streamedRef.current } : m)))
            }
          },
          onComplete: (evt) => {
            lastPromptRef.current = null // turn really completed — no Retry
            setThinking(false)
            setVerifying(false)
            const wireChanges = evt.changes ?? []
            const wireVerification = evt.verification ?? null
            setLastChanges(
              wireChanges.map((c) => ({ path: c.path, change: c.change === 'modified' ? 'modified' : 'added', diff: c.diff ?? [] })) as FileChange[],
            )
            setMessages((prev) =>
              prev.map((m) =>
                m.id === asstId
                  ? {
                      ...m,
                      content: streamedRef.current,
                      changes: wireChanges.map((c) => ({ path: c.path, change: c.change })),
                      incomplete: false,
                      verification: wireVerification,
                      ...(evt.fileOp ? { fileOp: evt.fileOp as FileOpView } : {}),
                      ...(evt.refactor ? { refactor: evt.refactor as RefactorView } : {}),
                    }
                  : m,
              ),
            )
            // Refresh from the server on every completed turn in a project.
            refreshFiles(newProjectId)
            // M22: a completed turn with changes recorded a project version —
            // refresh the preview evidence + list metadata (version badge).
            if (wireChanges.length > 0 && newProjectId) {
              setPreviewKey((k) => k + 1)
              void refreshPreviewAudit(newProjectId)
              void loadProjects(searchQuery)
            }
            // M23: an executed file operation changed the workspace — same
            // honest refresh semantics as any other accepted change.
            if (evt.fileOp?.status === 'executed' && newProjectId) {
              setPreviewKey((k) => k + 1)
              void refreshPreviewAudit(newProjectId)
              void loadProjects(searchQuery)
              if (versionsOpen) void openVersions()
            }
            // M25: a refactor card arrived (plan awaiting approval) — nothing
            // changed yet, but the version badge/list metadata may advance
            // once the user confirms (handled by executeRefactor).
            if (evt.refactor?.status === 'awaiting_confirmation') {
              void loadProjects(searchQuery)
            }
            const changes = evt.changes ?? []
            if (changes.length > 0) {
              setShowPreview((v) => v)
              const firstChanged = changes[0].path
              setOpenTabs((prev) => (prev.includes(firstChanged) ? prev : [...prev, firstChanged]))
              setActiveFile(firstChanged)
              setFileView('diff')
              setEditing(false)
            }
          },
          onFailure: (failure: StreamFailureInfo) => {
            setThinking(false)
            setVerifying(false)
            const hasText = streamedRef.current !== ''
            if (hasText) {
              // Partial content is preserved and labeled honestly: never a
              // silent look-alike of a completed answer.
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === asstId
                    ? { ...m, incomplete: true, incompleteReason: failure.kind === 'aborted' ? 'stopped' : 'interrupted' }
                    : m,
                ),
              )
            } else {
              setMessages((prev) => prev.filter((m) => m.id !== asstId))
            }
            if (failure.kind === 'aborted') return // user Stop — not an error
            const server = serverError as { message: string; code: string } | null
            setError(server ? `${server.message}` : failure.message || streamFailureMessage(failure.kind, failure.status))
          },
        },
        { signal: controller.signal },
      )

      if (newProjectId && !projectId) setProjectId(newProjectId)
      void loadProjects()
    } catch (e) {
      // Failures BEFORE the stream was consumable (fetch rejection, non-OK
      // status) — typed the same way, never the browser's raw wording.
      setThinking(false)
      setVerifying(false)
      if ((e as Error).name === 'AbortError') {
        if (streamedRef.current !== '') {
          setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, incomplete: true, incompleteReason: 'stopped' } : m)))
        } else {
          setMessages((prev) => prev.filter((m) => m.id !== asstId))
        }
      } else {
        if (streamedRef.current === '') setMessages((prev) => prev.filter((m) => m.id !== asstId))
        else setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, incomplete: true, incompleteReason: 'interrupted' } : m)))
        setError((e as Error).message || streamFailureMessage('http', null))
      }
    } finally {
      setStreaming(false)
      setThinking(false)
      setVerifying(false)
      streamingRef.current = false
      streamingAsstIdRef.current = null
      abortRef.current = null
    }
  }

  // Resizable workspace divider (mouse drag; keyboard arrows for a11y).
  function startResize(clientX: number) {
    const container = workspaceRef.current?.parentElement
    if (!container) return
    const rect = container.getBoundingClientRect()
    const onMove = (e: MouseEvent) => {
      const pct = ((rect.right - e.clientX) / rect.width) * 100
      setWorkspaceWidth(Math.min(72, Math.max(24, pct)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      dragRef.current = null
    }
    dragRef.current = container
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    void clientX
  }

  const active = files.find((f) => f.path === activeFile) ?? null
  const lastChange: FileChange['diff'] | null =
    (activeFile ? lastChanges.find((c) => c.path === activeFile)?.diff : null) ?? null

  const chatColumn = (
    <div className="flex min-w-0 flex-1 flex-col border-r border-[rgba(212,175,55,0.1)]">
      <div className="flex items-center gap-2 border-b border-[rgba(212,175,55,0.1)] px-5 py-3">
        <MessageSquareCode className="h-4 w-4 text-[#d4af37]" />
        <div className="text-sm font-semibold tracking-wide">CODE GIFTZ</div>
        <span className="hidden text-xs text-white/35 sm:inline">Chat-first coding · sandbox · live preview</span>
        {/* Mobile: the conversation drawer opens from the header (<lg). */}
        <div className="ml-auto lg:hidden">
          <GiftzSidebarMobileTrigger onClick={() => setSidebarOpen(true)} />
        </div>
      </div>

      <div className="bean-scroll flex-1 overflow-y-auto px-5 py-4">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl">
            <div className="flex justify-start">
              <div className="bean-glass max-w-[90%] rounded-2xl px-4 py-3 text-white/85">
                <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed">{WELCOME}</p>
              </div>
            </div>
            <div className="mt-6 grid gap-2 sm:grid-cols-2">
              {[
                'Build a small web app (HTML/CSS/JS) — try a gold-themed timer',
                'Write a JavaScript function and run it in the sandbox',
                'Explain what this regular expression does: ^\\d{4}-\\d{2}$',
                'Refactor a messy function into clean modules',
              ].map((s) => (
                <button
                  key={s}
                  onClick={() => { setInput(s.replace(/ — try a gold-themed timer$/, '')) }}
                  className="rounded-lg border border-[rgba(212,175,55,0.14)] bg-black/20 px-3 py-2 text-left text-xs text-white/55 transition-colors hover:border-[rgba(212,175,55,0.35)] hover:text-white/80"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4">
            {messages.map((m) => (
              <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[90%] rounded-2xl px-4 py-3', m.role === 'user' ? 'bg-[rgba(212,175,55,0.14)] text-white/90' : 'bean-glass text-white/85')}>
                  {m.role === 'user' ? (
                    <p className="whitespace-pre-wrap text-[14.5px] leading-relaxed">{m.content}</p>
                  ) : m.content || m.incomplete ? (
                    <>
                      <Markdown
                        content={
                          // Complete answers have balanced fences — only an
                          // in-flight or interrupted message ever needs the fix.
                          m.incomplete || (streaming && m.id === streamingAsstIdRef.current)
                            ? closeUnbalancedFences(m.content)
                            : m.content
                        }
                      />
                      {m.incomplete ? (
                        <p className="mt-2 border-t border-[rgba(212,175,55,0.12)] pt-2 text-[10.5px] text-amber-300">
                          {m.incompleteReason === 'stopped'
                            ? 'Generation stopped — the text above is incomplete.'
                            : 'Response interrupted — the text above is incomplete.'}
                        </p>
                      ) : null}
                      {m.verification ? (
                        <p
                          className="mt-2 flex items-center gap-1.5 border-t border-[rgba(212,175,55,0.12)] pt-2 text-[10.5px] text-white/45"
                          data-verification={m.verification.status}
                        >
                          <BadgeCheck className="h-3 w-3" />
                          {m.verification.status === 'verified'
                            ? 'Answer verified against your request.'
                            : m.verification.status === 'corrected'
                              ? `Answer corrected after verification (${m.verification.corrections} revision${m.verification.corrections === 1 ? '' : 's'}) and re-verified.`
                              : m.verification.status === 'corrected-unverified'
                                ? 'Answer corrected after verification; the corrected answer could not be fully re-verified.'
                                : 'This answer could not be fully verified — treat it with care and double-check critical parts.'}
                        </p>
                      ) : null}
                      {m.changes.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1.5 border-t border-[rgba(212,175,55,0.12)] pt-2">
                          {m.changes.map((c) => (
                            <button
                              key={c.path}
                              onClick={() => openFile(c.path)}
                              className={cn(
                                'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]',
                                c.change === 'added'
                                  ? 'border border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                  : 'border border-[rgba(212,175,55,0.35)] bg-[rgba(212,175,55,0.1)] text-[#f0c75e]',
                              )}
                            >
                              <FilePlus2 className="h-3 w-3" />
                              {c.change === 'added' ? 'created' : 'modified'} {c.path}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {/* M23 — file-operation card: the real structured plan/result
                          of a chat-driven rename/move/delete/create/repair. The
                          server executed (or proposed) it; this card never shows
                          a simulated outcome. */}
                      {m.fileOp ? (
                        <FileOpCard
                          op={m.fileOp}
                          disabled={fileOpBusy !== null}
                          busy={fileOpBusy !== null && fileOpBusy === m.fileOp.opId}
                          onConfirm={() => {
                            const op = m.fileOp
                            if (!op?.opId) return
                            const destructive = op.kind === 'delete' || op.kind === 'repair'
                            if (destructive) {
                              setConfirmingFileOp({
                                messageId: m.id,
                                opId: op.opId,
                                title: op.kind === 'delete' ? 'Confirm deletion' : 'Confirm reference repair',
                                detail:
                                  (op.consequence ?? '') +
                                  (op.affectedFiles && op.affectedFiles.length > 0
                                    ? ` Affected: ${op.affectedFiles.slice(0, 6).join(', ')}${op.affectedFiles.length > 6 ? ` and ${op.affectedFiles.length - 6} more` : ''}.`
                                    : ''),
                                destructive: true,
                              })
                            } else if (projectId) {
                              void executeFileOp(projectId, op.opId, m.id)
                            }
                          }}
                          onCancel={() => {
                            const op = m.fileOp
                            if (op?.opId && projectId) void cancelFileOp(projectId, op.opId, m.id)
                          }}
                          onRepair={() => {
                            const offered = m.fileOp?.result?.repairOffered
                            if (!offered) return
                            setConfirmingFileOp({
                              messageId: m.id,
                              opId: offered.opId,
                              title: 'Confirm reference repair',
                              detail:
                                offered.consequence +
                                (offered.affectedFiles.length > 0
                                  ? ` Files: ${offered.affectedFiles.map((f) => f.path).slice(0, 6).join(', ')}${offered.affectedFiles.length > 6 ? ` and ${offered.affectedFiles.length - 6} more` : ''}.`
                                  : ''),
                              destructive: true,
                            })
                          }}
                        />
                      ) : null}
                      {/* M25 — refactoring card: the real structured plan/result of a
                          chat-driven multi-file refactoring. The plan is always
                          awaiting explicit approval; execution runs through the
                          same hash-bound confirmation endpoint as file ops. */}
                      {m.refactor ? (
                        <RefactorCard
                          plan={m.refactor}
                          disabled={fileOpBusy !== null}
                          busy={fileOpBusy !== null && fileOpBusy === m.refactor.opId}
                          onConfirm={() => {
                            const plan = m.refactor
                            if (!plan?.opId) return
                            setConfirmingFileOp({
                              messageId: m.id,
                              opId: plan.opId,
                              target: 'refactor',
                              title: `Confirm ${REFACTOR_KIND_LABEL[plan.kind ?? ''] ?? 'refactoring'}`,
                              detail:
                                (plan.consequence ?? '') +
                                (plan.affectedFiles && plan.affectedFiles.length > 0
                                  ? ` Files: ${plan.affectedFiles.slice(0, 6).join(', ')}${plan.affectedFiles.length > 6 ? ` and ${plan.affectedFiles.length - 6} more` : ''}.`
                                  : '') +
                                ' This applies every listed change atomically as one version; version history keeps a full rollback path.',
                              destructive: true,
                            })
                          }}
                          onCancel={() => {
                            const plan = m.refactor
                            if (plan?.opId && projectId) void cancelRefactor(projectId, plan.opId, m.id)
                          }}
                          onOpenFile={(p) => openFile(p)}
                        />
                      ) : null}
                      {/* ADDITIVE (shared research gateway): clickable technical
                          references actually used by this turn — never fabricated. */}
                      {m.research && m.research.sources.length > 0 ? (
                        <details className="group mt-2 border-t border-[rgba(212,175,55,0.12)] pt-2">
                          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-[10.5px] text-white/40 hover:text-white/65">
                            <ExternalLink className="h-3 w-3" />
                            Technical references ({m.research.sources.length})
                          </summary>
                          <ul className="mt-1.5 space-y-1 pl-3">
                            {m.research.sources.map((r, i) => (
                              <li key={`${r.url}-${i}`} className="break-words text-[10.5px] leading-snug">
                                <a
                                  href={r.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#f0c75e] hover:underline"
                                >
                                  {r.title.slice(0, 90)}
                                </a>
                                <span className="text-white/35"> — {r.host}</span>
                                {r.channel !== 'gateway' ? (
                                  <span className="ml-1 text-[10px] text-sky-300/60" title={`Retrieved via the ${r.channel} channel of the BEAN research gateway`}>
                                    · via {r.channel}
                                  </span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                          {m.research.degraded.length > 0 ? (
                            <p className="mt-1 pl-3 text-[10px] leading-snug text-white/25">
                              Some references could not be retrieved: {m.research.degraded.slice(0, 3).join('; ')}
                            </p>
                          ) : null}
                        </details>
                      ) : null}
                    </>
                  ) : thinking || verifying ? (
                    <span className="inline-flex items-center gap-2 text-xs text-white/40"><Spinner /> {verifying ? 'Verifying answer…' : 'Thinking…'}</span>
                  ) : null}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {error ? (
        <div className="mx-5 mb-2 flex items-center justify-between gap-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <span className="min-w-0">{error}</span>
          {lastPromptRef.current && !streaming ? (
            <button
              onClick={() => { const p = lastPromptRef.current; if (p) void send(p) }}
              className="shrink-0 rounded border border-red-400/40 px-2 py-1 text-[11px] text-red-200 transition-colors hover:bg-red-500/20"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {attachments.length > 0 || uploading ? (
        <div className="mx-auto flex w-full max-w-2xl flex-wrap gap-2 px-5 pb-1">
          {attachments.map((a) => (
            <span
              key={a.id}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]',
                a.status === 'ready' ? 'border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.08)] text-[#f0c75e]' : 'border-amber-500/40 bg-amber-500/10 text-amber-300',
              )}
            >
              <FileCode2 className="h-3 w-3" /> {a.name} <span className="text-white/35">{formatBytes(a.size)}</span>
              {a.status !== 'ready' ? <span>· can't analyze</span> : null}
              <button onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))} className="ml-0.5 text-white/40 hover:text-white/80" aria-label={`Remove ${a.name}`}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {uploading ? <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-2.5 py-1 text-[11px] text-white/50"><Spinner className="h-3 w-3" /> uploading…</span> : null}
        </div>
      ) : null}

      <div className="border-t border-[rgba(212,175,55,0.1)] p-4">
        <div className="mx-auto max-w-2xl">
          {/* NOTE: the Frontend Toolkit panel was deliberately removed — the
              frontend intelligence library is internal-only; the user just
              describes what they want to build. */}
          {/* ADDITIVE (shared research gateway): honest source availability. */}
          <div className="mb-1.5">
            <ResearchStatusStrip product="code-giftz" />
          </div>
          <div className="mb-2 flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || attachments.length >= 3}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(212,175,55,0.25)] px-2.5 py-1.5 text-[11px] text-white/55 transition-colors hover:bg-white/5 hover:text-white/80 disabled:opacity-50"
              title="Attach files (code, documents, data — analyzed server-side)"
            >
              <Paperclip className="h-3.5 w-3.5" /> Attach
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => { if (e.target.files?.length) void uploadFiles(e.target.files) }}
            />
            <span className="text-[10px] text-white/30">context files for the next request</span>
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() }
              }}
              placeholder="Describe what to build or change… (Enter to send, Shift+Enter for a new line)"
              rows={Math.min(4, Math.max(1, input.split('\n').length))}
              maxLength={12000}
              disabled={streaming}
              className="max-h-40 min-h-[46px] resize-none bg-black/30"
              aria-label="Message CODE GIFTZ"
            />
            {streaming ? (
              <Button onClick={stopGeneration} className="h-[46px] bg-[rgba(212,175,55,0.15)] px-4 text-[#f0c75e] hover:bg-[rgba(212,175,55,0.25)]" variant="outline" aria-label="Stop generating">
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={() => void send()} disabled={!input.trim()} className="h-[46px] bg-[#d4af37] px-4 text-black hover:bg-[#e6c25a]" aria-label="Send">
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )

  const workspace = (
    <div ref={workspaceRef} className="flex min-w-0 flex-col" style={{ width: `var(--ws, ${workspaceWidth}%)` }}>
      <div className="flex items-center justify-between border-b border-[rgba(212,175,55,0.1)] px-4 py-2.5">
        <div className="flex items-center gap-2 text-xs text-white/50">
          <Code2 className="h-3.5 w-3.5 text-[#d4af37]" /> Workspace
          {files.length > 0 ? <span className="text-white/30">· {files.length} file{files.length > 1 ? 's' : ''}</span> : null}
        </div>
        <div className="flex items-center gap-1.5">
          {/* M22: version history + complete ZIP export (owner, existing project). */}
          <button
            onClick={() => void openVersions()}
            disabled={!projectId}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/50 transition-colors hover:border-[rgba(212,175,55,0.3)] hover:text-white/80 disabled:opacity-40"
            title="Version history: compare and restore earlier versions"
          >
            <History className="h-3 w-3" /> Versions
          </button>
          <button
            onClick={() => void exportProject()}
            disabled={!projectId || exporting || files.length === 0}
            className="inline-flex items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-[11px] text-white/50 transition-colors hover:border-[rgba(212,175,55,0.3)] hover:text-white/80 disabled:opacity-40"
            title="Download the complete project as a ZIP (secrets, dependencies and build outputs excluded)"
          >
            {exporting ? <Spinner className="h-3 w-3" /> : <Download className="h-3 w-3" />} Export
          </button>
          {hasHtml ? (
            <button
              onClick={() => setShowPreview((v) => !v)}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
                showPreview ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]' : 'border-white/10 text-white/50 hover:border-[rgba(212,175,55,0.3)]',
              )}
            >
              <MonitorPlay className="h-3 w-3" /> Preview
            </button>
          ) : null}
          <button
            onClick={() => void runInSandbox()}
            disabled={running || !files.some((f) => /\.(js|ts|py)$/.test(f.path))}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 px-2 py-1 text-[11px] text-emerald-300 transition-colors hover:bg-emerald-500/10 disabled:opacity-50"
            title="Run the project's JS/TS/Python in the restricted sandbox (real execution, real output)"
          >
            {running ? <Spinner className="h-3 w-3" /> : <TerminalIcon className="h-3 w-3" />} Run
          </button>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
          <FileCode2 className="mb-3 h-9 w-9 text-[#d4af37]/40" />
          <p className="text-sm font-medium text-white/70">No files yet</p>
          <p className="mt-1 max-w-xs text-xs text-white/40">
            Ask CODE GIFTZ to build something — generated files appear here with an editor, diffs, a sandbox terminal and a live preview.
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Tabs */}
          <div className="flex flex-wrap items-center gap-1 border-b border-[rgba(212,175,55,0.08)] px-3 py-1.5">
            {openTabs.map((p) => {
              const f = files.find((x) => x.path === p)
              // HYDRATION FIX (nested button): the tab pill was a button
              // element containing the close button element — invalid HTML
              // that broke hydration. The pill is now a NON-INTERACTIVE flex
              // container holding two SIBLING buttons: tab selection and
              // close. Every class (border, padding, radius, active/inactive
              // variants, hover targets) moved to the container unchanged, so
              // spacing, sizing, colors and hover behavior are pixel-
              // identical; both actions remain real buttons (keyboard +
              // screen-reader safe).
              return (
                <div
                  key={p}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
                    activeFile === p ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.1)] text-[#f0c75e]' : 'border-white/10 text-white/50 hover:border-[rgba(212,175,55,0.3)]',
                  )}
                >
                  <button
                    onClick={() => { setActiveFile(p); setFileView('code'); setEditing(false) }}
                    className="inline-flex items-center gap-1"
                  >
                    <FileCode2 className="h-3 w-3" />
                    {p}
                    {f?.origin === 'modified' ? <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="edited" /> : null}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpenTabs((prev) => prev.filter((x) => x !== p)); if (activeFile === p) setActiveFile(openTabs.find((x) => x !== p) ?? null) }}
                    className="ml-0.5 text-white/30 hover:text-white/70"
                    aria-label={`Close ${p}`}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              )
            })}
          </div>

          <div className="flex min-h-0 flex-1">
            {/* Explorer */}
            <div className="w-44 shrink-0 overflow-y-auto border-r border-[rgba(212,175,55,0.08)] px-2 py-2">
              <div className="mb-1 px-1.5 text-[10px] uppercase tracking-wider text-white/30">Files</div>
              {files.map((f) => (
                <button
                  key={f.path}
                  onClick={() => openFile(f.path)}
                  className={cn(
                    'group flex w-full items-center justify-between rounded px-1.5 py-1 text-left text-[11px] transition-colors',
                    activeFile === f.path ? 'bg-[rgba(212,175,55,0.1)] text-[#f0c75e]' : 'text-white/55 hover:bg-white/5',
                  )}
                  title={f.origin === 'modified' ? 'Modified after generation (by you or a follow-up)' : 'Generated by CODE GIFTZ'}
                >
                  <span className="truncate">{f.path}</span>
                  <span className={cn('ml-1 h-1.5 w-1.5 shrink-0 rounded-full', f.origin === 'modified' ? 'bg-amber-400' : 'bg-emerald-500/70')} />
                </button>
              ))}
            </div>

            {/* Editor / diff / preview / versions */}
            <div className="flex min-w-0 flex-1 flex-col">
              {versionsOpen ? (
                /* M22 VERSIONS PANEL — real recorded history, honest compare,
                   rollback-through-new-version. */
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex items-center justify-between border-b border-[rgba(212,175,55,0.08)] px-3 py-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] text-white/70">
                      <History className="h-3.5 w-3.5 text-[#d4af37]" /> Version history
                      {versions.length > 0 ? <span className="text-white/30">· {versions.length} recorded</span> : null}
                    </div>
                    <button onClick={() => { setVersionsOpen(false); setVersionCompare(null) }} className="rounded px-1.5 py-0.5 text-[10px] text-white/45 hover:text-white/80" aria-label="Close version history">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="bean-scroll min-h-0 flex-1 overflow-auto px-3 py-2">
                    {versionsLoading ? (
                      <p className="flex items-center gap-2 py-6 text-xs text-white/40"><Spinner /> Loading versions…</p>
                    ) : versions.length === 0 ? (
                      <p className="py-6 text-center text-xs text-white/35">
                        No versions recorded yet. Every accepted change, manual snapshot and rollback is recorded here.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {versions.map((v) => (
                          <div key={v.id} className="rounded-lg border border-white/8 bg-black/20 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded border border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.08)] px-1.5 py-0.5 text-[10px] text-[#f0c75e]">v{v.seq}</span>
                              <span className="rounded border border-white/12 px-1 py-0.5 text-[9px] uppercase tracking-wide text-white/40">{v.kind}</span>
                              <span className="text-[10px] text-white/30">{timeAgo(v.createdAt)}</span>
                              <span className="text-[10px] text-white/30">· {v.fileCount} file{v.fileCount === 1 ? '' : 's'}</span>
                              <span className="ml-auto flex items-center gap-1.5">
                                <button
                                  onClick={() => void compareVersion(v.seq)}
                                  disabled={versionBusy}
                                  className="inline-flex items-center gap-1 rounded border border-white/12 px-1.5 py-0.5 text-[10px] text-white/55 hover:border-[rgba(212,175,55,0.3)] hover:text-white/85 disabled:opacity-40"
                                >
                                  <GitCompareArrows className="h-3 w-3" /> Compare with current
                                </button>
                                <button
                                  onClick={() => setRestoringVersion(v.seq)}
                                  disabled={versionBusy}
                                  className="inline-flex items-center gap-1 rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-300 hover:bg-amber-500/10 disabled:opacity-40"
                                  title="Restore this version — creates a new version (history is never rewritten)"
                                >
                                  <Undo2 className="h-3 w-3" /> Restore
                                </button>
                              </span>
                            </div>
                            {v.summary ? <p className="mt-1 truncate text-[11px] text-white/60" title={v.summary}>{v.summary}</p> : null}
                            {v.changedFiles.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {v.changedFiles.map((c) => (
                                  <span
                                    key={c.path}
                                    className={cn(
                                      'inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[9.5px]',
                                      c.change === 'added' && 'bg-emerald-500/10 text-emerald-300',
                                      c.change === 'modified' && 'bg-[rgba(212,175,55,0.1)] text-[#f0c75e]',
                                      c.change === 'deleted' && 'bg-red-500/10 text-red-300',
                                      c.change === 'renamed' && 'bg-sky-500/10 text-sky-300',
                                    )}
                                  >
                                    {c.change === 'added' ? <PlusCircle className="h-2.5 w-2.5" /> : c.change === 'deleted' ? <MinusCircle className="h-2.5 w-2.5" /> : c.change === 'renamed' ? <CopyIcon className="h-2.5 w-2.5" /> : <FilePlus2 className="h-2.5 w-2.5" />}
                                    {c.change === 'renamed' ? `${c.previousPath} → ${c.path}` : c.path}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}

                    {versionCompare ? (
                      <div className="mt-3 rounded-lg border border-[rgba(212,175,55,0.2)] bg-black/30">
                        <div className="flex items-center justify-between border-b border-[rgba(212,175,55,0.15)] px-3 py-1.5">
                          <span className="text-[11px] text-white/70">
                            {versionCompare.data.from.label} → {versionCompare.data.to.label}
                            {versionCompare.data.truncated ? <span className="ml-2 text-[10px] text-amber-300">(diff truncated at payload budget)</span> : null}
                          </span>
                          <button onClick={() => setVersionCompare(null)} className="text-[10px] text-white/40 hover:text-white/75" aria-label="Close comparison">close</button>
                        </div>
                        <div className="px-3 py-2 text-[11px]">
                          {versionCompare.data.added.length > 0 ? (
                            <p className="mb-1 text-emerald-300">Added: {versionCompare.data.added.join(', ')}</p>
                          ) : null}
                          {versionCompare.data.deleted.length > 0 ? (
                            <p className="mb-1 text-red-300">Deleted: {versionCompare.data.deleted.join(', ')}</p>
                          ) : null}
                          {versionCompare.data.renamed.length > 0 ? (
                            <p className="mb-1 text-sky-300">Renamed: {versionCompare.data.renamed.map((r) => `${r.previousPath} → ${r.path}`).join(', ')}</p>
                          ) : null}
                          {versionCompare.data.modified.map((m) => (
                            <div key={m.path} className="mb-2">
                              <p className="text-[#f0c75e]">Modified: {m.path} <span className="text-white/35">(+{m.added} / -{m.removed})</span></p>
                              {versionCompare.data.diffs[m.path] ? (
                                <pre className="mt-0.5 font-mono text-[10.5px] leading-relaxed">
                                  {versionCompare.data.diffs[m.path].map((l, i) => (
                                    <div key={i} className={cn('px-2', l.type === 'add' && 'bg-emerald-500/10 text-emerald-300', l.type === 'del' && 'bg-red-500/10 text-red-300', l.type === 'ctx' && 'text-white/40')}>
                                      <span className="mr-2 inline-block w-3 select-none">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</span>
                                      {l.text || ' '}
                                    </div>
                                  ))}
                                </pre>
                              ) : null}
                            </div>
                          ))}
                          {versionCompare.data.added.length === 0 && versionCompare.data.deleted.length === 0 && versionCompare.data.renamed.length === 0 && versionCompare.data.modified.length === 0 ? (
                            <p className="text-white/40">No differences — the workspace matches this version.</p>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : showPreview && hasHtml ? (
                /* M22 PREVIEW — viewport toggle, refresh, REAL evidence strip. */
                <div className="flex min-h-0 flex-1 flex-col">
                  {(previewObservations.length > 0 || (previewAudit && (previewAudit.missingAssets.length > 0 || previewAudit.brokenInternalLinks.length > 0))) ? (
                    <div className="shrink-0 border-b border-amber-500/25 bg-amber-500/5 px-3 py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-amber-300">
                          <AlertTriangle className="h-3 w-3" />
                          Preview evidence: {previewObservations.length} runtime observation{previewObservations.length === 1 ? '' : 's'}
                          {previewAudit && previewAudit.missingAssets.length + previewAudit.brokenInternalLinks.length > 0
                            ? ` · ${previewAudit.missingAssets.length} missing asset${previewAudit.missingAssets.length === 1 ? '' : 's'} · ${previewAudit.brokenInternalLinks.length} broken link${previewAudit.brokenInternalLinks.length === 1 ? '' : 's'}`
                            : ''}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <button
                            onClick={repairFromEvidence}
                            className="inline-flex items-center gap-1 rounded border border-amber-500/40 px-1.5 py-0.5 text-[10px] text-amber-200 hover:bg-amber-500/10"
                            title="Prefill a targeted repair request from this real evidence"
                          >
                            <Wrench className="h-3 w-3" /> Draft repair
                          </button>
                          <button onClick={() => setPreviewObservations([])} className="text-[10px] text-white/40 hover:text-white/75" aria-label="Clear observations">clear</button>
                        </span>
                      </div>
                      <ul className="mt-1 max-h-24 space-y-0.5 overflow-auto">
                        {previewObservations.slice(-6).map((o, i) => (
                          <li key={o.at + '-' + i} className={cn('truncate font-mono text-[10px]', o.type === 'console-warn' ? 'text-amber-200/70' : 'text-red-300/90')} title={`${o.message}${o.detail ? ` — ${o.detail}` : ''}`}>
                            [{o.type}] {o.message}
                          </li>
                        ))}
                        {previewAudit?.missingAssets.slice(0, 3).map((m, i) => (
                          <li key={'ma' + i} className="truncate font-mono text-[10px] text-amber-200/80" title={`${m.file} references ${m.reference}`}>
                            [missing asset] {m.reference} (from {m.file})
                          </li>
                        ))}
                        {previewAudit?.brokenInternalLinks.slice(0, 3).map((l, i) => (
                          <li key={'bl' + i} className="truncate font-mono text-[10px] text-amber-200/80" title={`${l.file} links to ${l.target}`}>
                            [broken link] {l.target} (from {l.file})
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between border-b border-[rgba(212,175,55,0.08)] px-3 py-1">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setPreviewViewport('desktop')}
                        className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]', previewViewport === 'desktop' ? 'bg-[rgba(212,175,55,0.14)] text-[#f0c75e]' : 'text-white/45 hover:text-white/75')}
                        aria-pressed={previewViewport === 'desktop'}
                      >
                        <Monitor className="h-3 w-3" /> Desktop
                      </button>
                      <button
                        onClick={() => setPreviewViewport('mobile')}
                        className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]', previewViewport === 'mobile' ? 'bg-[rgba(212,175,55,0.14)] text-[#f0c75e]' : 'text-white/45 hover:text-white/75')}
                        aria-pressed={previewViewport === 'mobile'}
                      >
                        <Smartphone className="h-3 w-3" /> Mobile width
                      </button>
                      <span className="ml-1 text-[9px] text-white/25">real rendering · isolated iframe</span>
                    </div>
                    <button
                      onClick={() => setPreviewKey((k) => k + 1)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/45 hover:text-white/80"
                      title="Reload the preview with the latest saved files"
                    >
                      <RefreshCw className="h-3 w-3" /> Refresh
                    </button>
                  </div>
                  <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-black/30">
                    <iframe
                      key={previewKey}
                      title="Project preview (isolated)"
                      sandbox="allow-scripts"
                      src={`/api/code-giftz/projects/${projectId}/preview?v=${previewKey}`}
                      className={cn('h-full border-0 bg-white', previewViewport === 'mobile' ? 'max-w-full' : 'w-full')}
                      style={previewViewport === 'mobile' ? { width: 390 } : undefined}
                    />
                  </div>
                </div>
              ) : active ? (
                <>
                  <div className="flex items-center justify-between border-b border-[rgba(212,175,55,0.08)] px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setFileView('code')}
                        className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]', fileView === 'code' ? 'bg-[rgba(212,175,55,0.14)] text-[#f0c75e]' : 'text-white/45 hover:text-white/75')}
                      >
                        <Eye className="h-3 w-3" /> Code
                      </button>
                      <button
                        onClick={() => setFileView('diff')}
                        disabled={!lastChange}
                        className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] disabled:opacity-40', fileView === 'diff' ? 'bg-[rgba(212,175,55,0.14)] text-[#f0c75e]' : 'text-white/45 hover:text-white/75')}
                        title={lastChange ? 'Show what the last request changed' : 'No recorded change for this file yet'}
                      >
                        <GitCompareArrows className="h-3 w-3" /> Diff
                      </button>
                      <span className="ml-1 rounded border border-white/12 px-1 text-[9px] text-white/40">
                        {active.origin === 'modified' ? 'modified' : 'generated'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {/* M22: honest workspace file deletion (records a version). */}
                      {!editing ? (
                        <button
                          onClick={() => { if (window.confirm(`Delete ${active.path} from this project? This records a version and cannot be undone.`)) void deleteActiveFile() }}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-red-300/80 hover:bg-red-500/10 hover:text-red-300"
                          title="Delete this file from the project (records a version)"
                        >
                          <FileMinus2 className="h-3 w-3" /> Delete file
                        </button>
                      ) : null}
                      {editing ? (
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => { setEditing(false); setEditBuffer('') }} className="rounded px-1.5 py-0.5 text-[10px] text-white/45 hover:text-white/80">Cancel</button>
                          <Button onClick={() => void saveEdit()} disabled={saving} size="sm" className="h-6 bg-[#d4af37] px-2 text-[10px] text-black hover:bg-[#e6c25a]">
                            {saving ? <Spinner className="h-3 w-3" /> : <Save className="h-3 w-3" />} Save
                          </Button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditBuffer(active.content); setEditing(true); setFileView('code') }}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/45 hover:text-white/80"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="bean-scroll min-h-0 flex-1 overflow-auto">
                    {editing ? (
                      <textarea
                        value={editBuffer}
                        onChange={(e) => setEditBuffer(e.target.value)}
                        spellCheck={false}
                        className="h-full min-h-[280px] w-full resize-none bg-[#0c0c0f] p-3 font-mono text-[12.5px] leading-relaxed text-white/85 outline-none"
                        aria-label={`Edit ${active.path}`}
                      />
                    ) : fileView === 'diff' && lastChange ? (
                      <pre className="min-h-full p-0 font-mono text-[11.5px] leading-relaxed">
                        {lastChange.map((l, i) => (
                          <div
                            key={i}
                            className={cn(
                              'px-3',
                              l.type === 'add' && 'bg-emerald-500/10 text-emerald-300',
                              l.type === 'del' && 'bg-red-500/10 text-red-300',
                              l.type === 'ctx' && 'text-white/45',
                            )}
                          >
                            <span className="mr-2 inline-block w-3 select-none">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</span>
                            {l.text || ' '}
                          </div>
                        ))}
                      </pre>
                    ) : (
                      <SyntaxHighlighter
                        language={langOf(active.path)}
                        style={vscDarkPlus}
                        customStyle={{ margin: 0, background: '#0c0c0f', fontSize: '12.5px', padding: '14px', minHeight: '100%' }}
                        wrapLongLines={false}
                      >
                        {active.content}
                      </SyntaxHighlighter>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center text-xs text-white/35">Select a file</div>
              )}

              {/* Terminal */}
              {run ? (
                <div className="max-h-56 shrink-0 overflow-auto border-t border-[rgba(212,175,55,0.12)] bg-black/60 px-4 py-3">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/70">
                      <TerminalIcon className="h-3.5 w-3.5 text-[#d4af37]" /> Sandbox
                    </span>
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px]',
                      run.timedOut ? 'border-amber-500/40 text-amber-300' : run.exitCode === 0 ? 'border-emerald-500/40 text-emerald-300' : 'border-red-500/40 text-red-300',
                    )}>
                      {run.timedOut ? <CircleX className="h-3 w-3" /> : run.exitCode === 0 ? <CircleCheck className="h-3 w-3" /> : <CircleX className="h-3 w-3" />}
                      {run.timedOut ? 'timeout (SIGKILL)' : `exit ${run.exitCode ?? '—'}`} · {run.durationMs}ms
                    </span>
                  </div>
                  {run.stdout ? <pre className="whitespace-pre-wrap font-mono text-[11.5px] text-emerald-200/90"><code>{run.stdout}</code></pre> : null}
                  {run.stderr ? <pre className="mt-1 whitespace-pre-wrap font-mono text-[11.5px] text-red-300/90"><code>{run.stderr}</code></pre> : null}
                  {!run.stdout && !run.stderr ? <p className="text-[11px] text-white/40">The process produced no output.</p> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )


  return (
    <div
      className={cn(
        'grid min-h-[calc(100vh-3.5rem-2rem)] lg:h-[calc(100vh-3.5rem-1.5rem)]',
        sidebarCollapsed ? 'lg:grid-cols-[48px_1fr]' : 'lg:grid-cols-[220px_1fr]',
      )}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (e.dataTransfer?.files?.length) void uploadFiles(e.dataTransfer.files)
      }}
    >
      {/* Conversations rail (desktop) — ChatGPT-style, collapsible; the
          mobile drawer lives at the bottom of this tree. */}
      {sidebarCollapsed ? (
        <GiftzSidebarCollapsedRail onExpand={() => setSidebarCollapsed(false)} onNew={newProject} />
      ) : (
        <aside className="hidden flex-col border-r border-[rgba(212,175,55,0.1)] lg:flex">
          <GiftzSidebarBody
            projects={showArchived ? projects : projects.filter((p) => p.status !== 'archived')}
            activeId={projectId}
            searching={searching}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onOpen={(id) => void openProject(id)}
            onNew={newProject}
            onRename={renameProject}
            onDelete={deleteProject}
            onDuplicate={duplicateProject}
            onArchive={archiveProject}
            onRestore={restoreProject}
            showArchived={showArchived}
            onToggleArchived={() => setShowArchived((v) => !v)}
            onCollapse={() => setSidebarCollapsed(true)}
          />
        </aside>
      )}

      {/* Chat + workspace row */}
      <div className="flex min-h-0 min-w-0">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col lg:border-r-0">{chatColumn}</div>
        <div
          className="hidden min-h-0 shrink-0 grow-0 border-l border-[rgba(212,175,55,0.1)] lg:flex lg:flex-col"
          style={{ width: `${workspaceWidth}%` }}
          onMouseDown={(e) => {
            // The 6px strip at the left edge acts as the resize handle.
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            if (e.clientX - rect.left <= 6) startResize(e.clientX)
          }}
        >
          {workspace}
        </div>
      </div>

      {/* Conversations drawer (mobile <lg) — same body, same capabilities. */}
      <GiftzSidebarMobile
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        projects={showArchived ? projects : projects.filter((p) => p.status !== 'archived')}
        activeId={projectId}
        searching={searching}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpen={(id) => void openProject(id)}
        onNew={newProject}
        onRename={renameProject}
        onDelete={deleteProject}
        onDuplicate={duplicateProject}
        onArchive={archiveProject}
        onRestore={restoreProject}
        showArchived={showArchived}
        onToggleArchived={() => setShowArchived((v) => !v)}
      />

      {/* M22 — restore-version confirmation: the rollback is real and
          consequential (workspace files change), so it never runs from one
          click, and the dialog explains the honest semantics. */}
      <AlertDialog
        open={restoringVersion !== null}
        onOpenChange={(open) => {
          if (!open) setRestoringVersion(null)
        }}
      >
        <AlertDialogContent className="border-[rgba(212,175,55,0.25)] bg-[#141416]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white/90">Restore version {restoringVersion}?</AlertDialogTitle>
            <AlertDialogDescription>
              The workspace files will be restored to this recorded state. This creates a NEW version — nothing is deleted from history, and you can restore again at any time. Unsaved file changes in the workspace will be replaced.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/15 bg-transparent text-white/70 hover:bg-white/5 hover:text-white">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                const seq = restoringVersion
                setRestoringVersion(null)
                if (seq !== null) void restoreVersion(seq)
              }}
              disabled={versionBusy}
              className="bg-[#d4af37] text-black hover:bg-[#e6c25a]"
            >
              {versionBusy ? <Spinner className="h-3.5 w-3.5" /> : null} Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* M23 — destructive file-operation confirmation: deletion and reference
          repair never run from one click. The dialog states the exact plan the
          server recorded (bound to it by the operation id) and the honest
          recovery semantics (version history). */}
      <AlertDialog
        open={confirmingFileOp !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmingFileOp(null)
        }}
      >
        <AlertDialogContent className="border-[rgba(212,175,55,0.25)] bg-[#141416]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white/90">{confirmingFileOp?.title ?? 'Confirm'}</AlertDialogTitle>
            <AlertDialogDescription>{confirmingFileOp?.detail}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/15 bg-transparent text-white/70 hover:bg-white/5 hover:text-white">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                const pending = confirmingFileOp
                setConfirmingFileOp(null)
                if (pending && projectId) {
                  if (pending.target === 'refactor') void executeRefactor(projectId, pending.opId, pending.messageId)
                  else void executeFileOp(projectId, pending.opId, pending.messageId)
                }
              }}
              disabled={fileOpBusy !== null}
              className={confirmingFileOp?.destructive ? 'bg-red-600 text-white hover:bg-red-500' : 'bg-[#d4af37] text-black hover:bg-[#e6c25a]'}
            >
              {fileOpBusy ? <Spinner className="h-3.5 w-3.5" /> : null} Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
