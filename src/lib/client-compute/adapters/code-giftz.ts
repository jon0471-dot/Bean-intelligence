/**
 * BEAN Intelligence — CODE GIFTZ client-compute adapter (Phase 10.D).
 *
 * Scope (from the Phase 0 audit): browser-side static code analysis over
 * project files the CODE GIFTZ UI already has in memory. Advisory only —
 * the server's dependency-analysis route, preview audit and sandbox approval
 * contract remain authoritative. Nothing here executes project code; it is
 * pure text scanning (delimiter balance + relative-import resolution).
 *
 * The kernel is a single self-contained pure function (worker-serializable).
 *
 * Client-safe: no Node-only imports.
 */
import type { CpuEngine } from '../cpu/engine'
import type { ClientCompute } from '../index'
import type { ComputeTaskOutput, RegisteredTaskKind, TargetHandler } from '../types'

export const CODE_ANALYSIS_KIND = 'code.analysis'

export interface CodeAnalysisFileInput {
  path: string
  content: string
}

export interface CodeAnalysisIssue {
  kind: 'unbalanced-delimiters' | 'missing-relative-import'
  path: string
  line?: number
  message: string
}

export interface CodeAnalysisPayload {
  files: CodeAnalysisFileInput[]
  /** Cap on reported issues per category (bounded diagnostics). */
  maxIssues?: number
}

export interface CodeAnalysisResult {
  files: string[]
  issues: CodeAnalysisIssue[]
  /** Honest note about what this analysis does and does not check. */
  note: string
}

/**
 * Self-contained analysis kernel (no imports, no closure refs — worker-safe).
 * Checks:
 *  1. Delimiter balance per file (string/comment aware).
 *  2. Relative imports that do not resolve to any provided project file.
 * Deliberately NOT checked here (server owns these): npm/bare imports,
 * lockfile semantics, build-tool correctness, syntax typing.
 */
export function codeAnalysisKernel(payload: CodeAnalysisPayload): CodeAnalysisResult {
  const files = Array.isArray(payload?.files) ? payload.files : []
  const maxIssues = typeof payload?.maxIssues === 'number' && payload.maxIssues > 0 ? payload.maxIssues : 50
  const issues: CodeAnalysisIssue[] = []
  const paths: string[] = []

  // Build a resolution set from the provided files (with and without extension).
  const pathSet = new Set<string>()
  for (const file of files) {
    if (typeof file?.path !== 'string' || typeof file.content !== 'string') continue
    paths.push(file.path)
    pathSet.add(file.path)
    const noExt = file.path.replace(/\.(ts|tsx|js|jsx|mjs|css|json)$/i, '')
    pathSet.add(noExt)
  }
  const resolveRelative = (fromPath: string, spec: string): string => {
    const norm = spec.replace(/^\.\//, '').replace(/^\.\.\//, '../')
    const dirParts = fromPath.split('/').slice(0, -1)
    const parts = norm.split('/')
    const stack = [...dirParts]
    for (const part of parts) {
      if (part === '.' || part === '') continue
      if (part === '..') stack.pop()
      else stack.push(part)
    }
    return stack.join('/')
  }

  const addIssue = (issue: CodeAnalysisIssue): void => {
    if (issues.length < maxIssues * 2) issues.push(issue)
  }

  for (const file of files) {
    if (typeof file?.path !== 'string' || typeof file.content !== 'string') continue
    const content = file.content

    // --- delimiter balance (string + comment aware) ---
    const stack: Array<{ ch: string; line: number }> = []
    let line = 1
    let state: 'code' | 'line-comment' | 'block-comment' | 'single-quote' | 'double-quote' | 'template' = 'code'
    let templateDepth = 0
    for (let i = 0; i < content.length; i++) {
      const ch = content[i]
      const next = content[i + 1]
      if (ch === '\n') {
        line += 1
        if (state === 'line-comment') state = 'code'
        continue
      }
      if (state === 'line-comment') continue
      if (state === 'block-comment') {
        if (ch === '*' && next === '/') {
          state = 'code'
          i++
        }
        continue
      }
      if (state === 'single-quote') {
        if (ch === '\\') i++
        else if (ch === "'") state = 'code'
        continue
      }
      if (state === 'double-quote') {
        if (ch === '\\') i++
        else if (ch === '"') state = 'code'
        continue
      }
      if (state === 'template') {
        if (ch === '\\') i++
        else if (ch === '`') {
          state = templateDepth > 0 ? 'code' : 'code'
          templateDepth = 0
        } else if (ch === '$' && next === '{') {
          templateDepth += 1
          state = 'code'
          stack.push({ ch: '{', line })
          i++
        }
        continue
      }
      // state === 'code'
      if (ch === '/' && next === '/') {
        state = 'line-comment'
        i++
        continue
      }
      if (ch === '/' && next === '*') {
        state = 'block-comment'
        i++
        continue
      }
      if (ch === "'") {
        state = 'single-quote'
        continue
      }
      if (ch === '"') {
        state = 'double-quote'
        continue
      }
      if (ch === '`') {
        state = 'template'
        continue
      }
      if (ch === '(' || ch === '[' || ch === '{') stack.push({ ch, line })
      else if (ch === ')' || ch === ']' || ch === '}') {
        const top = stack[stack.length - 1]
        const match = top && ((ch === ')' && top.ch === '(') || (ch === ']' && top.ch === '[') || (ch === '}' && top.ch === '{'))
        if (!match) {
          addIssue({ kind: 'unbalanced-delimiters', path: file.path, line, message: `Unexpected closing "${ch}".` })
        } else {
          stack.pop()
          if (templateDepth > 0 && ch === '}') {
            state = 'template'
            templateDepth -= 1
          }
        }
      }
    }
    if (stack.length > 0) {
      const top = stack[stack.length - 1]
      addIssue({ kind: 'unbalanced-delimiters', path: file.path, line: top.line, message: `${stack.length} unclosed delimiter(s); last opened "${top.ch}" on line ${top.line}.` })
    }

    // --- relative-import resolution ---
    const importRegex = /(?:from\s+|require\(\s*|import\s+)['"](\.[^'"]+)['"]/g
    let match: RegExpExecArray | null
    while ((match = importRegex.exec(content)) !== null) {
      const spec = match[1]
      const resolved = resolveRelative(file.path, spec)
      const found =
        pathSet.has(resolved) ||
        pathSet.has(`${resolved}.ts`) ||
        pathSet.has(`${resolved}.tsx`) ||
        pathSet.has(`${resolved}.js`) ||
        pathSet.has(`${resolved}.jsx`) ||
        pathSet.has(`${resolved}.css`) ||
        pathSet.has(`${resolved}.json`) ||
        pathSet.has(`${resolved}/index`) ||
        pathSet.has(`${resolved}/index.ts`) ||
        pathSet.has(`${resolved}/index.tsx`) ||
        pathSet.has(`${resolved}/index.js`)
      if (!found) {
        const line = content.slice(0, match.index).split('\n').length
        addIssue({ kind: 'missing-relative-import', path: file.path, line, message: `Relative import "${spec}" does not match any project file.` })
      }
    }
  }

  return {
    files: paths,
    issues,
    note: 'Advisory client-side scan: delimiter balance + relative-import resolution only. Server analysis, sandbox approval and build validation remain authoritative.',
  }
}

export function buildCodeGiftzKinds(cpu: CpuEngine): Array<RegisteredTaskKind<unknown, unknown>> {
  const handler: TargetHandler<CodeAnalysisPayload, CodeAnalysisResult> = async ({ input, signal }) => {
    if (!input || !Array.isArray(input.files)) throw new Error('Analysis input must include a files array.')
    const run = await cpu.runFunction(codeAnalysisKernel, input, { signal, allowMainThreadFallback: false })
    if (!run.ok) throw new Error(run.reason)
    return run.output
  }
  return [
    {
      kind: CODE_ANALYSIS_KIND,
      productId: 'code-giftz',
      preferredOrder: ['client-cpu'],
      handlers: { 'client-cpu': handler as TargetHandler<unknown, unknown> },
      feasibility: { gpuSupported: false, cpuSupported: true },
      resourceClass: 'medium',
      privacy: 'local-only', // project code never leaves the device for this scan
      timeoutMs: 60_000,
    },
  ]
}

export function registerCodeGiftzAdapter(client: Pick<ClientCompute, 'scheduler' | 'cpu'>): void {
  client.scheduler.registerProductAdapter({
    productId: 'code-giftz',
    summary: 'Browser-side advisory code analysis (delimiter balance, relative-import resolution) over in-memory project files; runs local-only and never executes project code.',
    kinds: buildCodeGiftzKinds(client.cpu),
  })
}

export async function scheduleCodeAnalysis(
  client: Pick<ClientCompute, 'scheduler'>,
  input: CodeAnalysisPayload,
  options: { signal?: AbortSignal } = {},
): Promise<ComputeTaskOutput<CodeAnalysisResult>> {
  return client.scheduler.runTask<CodeAnalysisPayload, CodeAnalysisResult>(
    { productId: 'code-giftz', kind: CODE_ANALYSIS_KIND, input, signal: options.signal },
  )
}
