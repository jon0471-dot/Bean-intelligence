/**
 * BEAN Intelligence — RIISHE built-in tools.
 *
 * Every tool wraps an EXISTING, already-verified BEAN capability:
 *  - web_search / read_url  -> the real research provider (gateway web_search
 *    + page_reader with typed errors and timeouts).
 *  - calculate              -> the same deterministic safe evaluator the
 *    arithmetic verifier uses (no eval, no model arithmetic).
 *  - run_code               -> CODE GIFTZ's restricted sandbox (ephemeral
 *    workspace, minimal env, SIGKILL timeout). Gated behind an explicit
 *    per-request user opt-in; NEVER available implicitly.
 *  - read_document          -> text extracted from a user-uploaded document
 *    that the route already ownership-validated for THIS request.
 *
 * Outputs are bounded and customer-safe. Tools return honest failures; they
 * never synthesize plausible-looking results.
 */
import { z } from 'zod'
import { webSearch, readPage } from '@/lib/research/provider'
import { evaluateExpression } from '@/lib/verify/exprcheck'
import { runInSandbox, type SandboxFile } from '@/lib/sandbox/runner'
import type { ToolDescriptor, ToolResult } from './types'

const MAX_SEARCH_OUTPUT = 6
const MAX_PAGE_CHARS = 9000
const MAX_DOC_CHARS = 12_000

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n[truncated at ${max} characters]` : text
}

// ---- web_search ------------------------------------------------------------

const searchInput = z.object({
  query: z.string().min(2).max(300),
  recencyDays: z.number().int().min(1).max(3650).optional(),
})

export const webSearchTool: ToolDescriptor<z.infer<typeof searchInput>> = {
  name: 'web_search',
  description:
    'Search the live web. Input: {"query": string, "recencyDays"?: number}. ' +
    'Returns real result titles, URLs, hosts and dates. Use for current facts.',
  permission: 'standard',
  timeoutMs: 20_000,
  validate(input) {
    return searchInput.parse(input)
  },
  async execute({ query, recencyDays }, ctx): Promise<ToolResult> {
    const results = await webSearch(query, { num: 8, recencyDays })
    if (results.length === 0) {
      return { ok: true, output: `No results found for "${query}".` }
    }
    const offset = ctx.sourceIdOffset ?? 0
    const shown = results.slice(0, MAX_SEARCH_OUTPUT)
    const lines = shown.map(
      (r, i) =>
        `[${offset + i + 1}] ${r.title}\n   URL: ${r.url}\n   Host: ${r.hostName}${r.date ? `\n   Date: ${r.date}` : ''}\n   ${r.snippet.slice(0, 300)}`,
    )
    return {
      ok: true,
      output: lines.join('\n') + '\n(cite these as [n] with the numbers shown)',
      sources: shown.map((r, i) => ({
        id: offset + i + 1,
        url: r.url,
        title: r.title,
        hostName: r.hostName,
        date: r.date,
        pageRead: false,
      })),
    }
  },
}

// ---- read_url ---------------------------------------------------------------

const readUrlInput = z.object({
  url: z.string().url().max(2000),
})

export const readUrlTool: ToolDescriptor<z.infer<typeof readUrlInput>> = {
  name: 'read_url',
  description:
    'Fetch a web page and return its readable text. Input: {"url": string}. ' +
    'Use after web_search when a result looks authoritative and needs full content.',
  permission: 'standard',
  timeoutMs: 28_000,
  validate(input) {
    return readUrlInput.parse(input)
  },
  async execute({ url }): Promise<ToolResult> {
    // Only http(s); block anything exotic (file:, data:, internal hosts are
    // still resolvable by the provider, so scheme filtering is mandatory).
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, output: `Unsupported URL scheme: ${parsed.protocol}` }
    }
    const page = await readPage(url)
    return {
      ok: true,
      output: clip(`TITLE: ${page.title}${page.publishedTime ? `\nPUBLISHED: ${page.publishedTime}` : ''}\n\n${page.text}`, MAX_PAGE_CHARS),
      sources: [{ url, title: page.title, hostName: parsed.host, date: page.publishedTime, pageRead: true }],
    }
  },
}

// ---- calculate ---------------------------------------------------------------

const calcInput = z.object({
  expression: z.string().min(1).max(500),
})

export const calculateTool: ToolDescriptor<z.infer<typeof calcInput>> = {
  name: 'calculate',
  description:
    'Evaluate one arithmetic expression exactly (safe deterministic evaluator, not model arithmetic). ' +
    'Input: {"expression": string}, e.g. "(17*23)+sqrt(144)/3". Use for any nontrivial arithmetic.',
  permission: 'standard',
  timeoutMs: 5_000,
  validate(input) {
    return calcInput.parse(input)
  },
  async execute({ expression }): Promise<ToolResult> {
    try {
      const value = evaluateExpression(expression)
      return { ok: true, output: `${expression} = ${value}` }
    } catch (e) {
      const reason = e instanceof Error ? e.message.replace(/\/[\w./-]+/g, '<path>').slice(0, 200) : 'invalid expression'
      return { ok: false, output: `The expression could not be evaluated (${reason}). Use plain + - * / % ^ and parentheses.` }
    }
  },
}

// ---- run_code (explicit permission) -----------------------------------------

const runCodeInput = z.object({
  code: z.string().min(1).max(20_000),
  language: z.enum(['javascript', 'typescript']).default('javascript'),
})

export const runCodeTool: ToolDescriptor<z.infer<typeof runCodeInput>> = {
  name: 'run_code',
  description:
    'Run a short JavaScript/TypeScript snippet in BEAN\'s restricted sandbox (no network secrets, 15s cap) ' +
    'and return the REAL stdout/stderr. Input: {"code": string, "language"?: "javascript"|"typescript"}. ' +
    'Only available when the user approved execution for this request.',
  permission: 'explicit',
  permissionKey: 'allowCodeExecution',
  timeoutMs: 20_000,
  validate(input) {
    return runCodeInput.parse(input)
  },
  async execute({ code, language }): Promise<ToolResult> {
    const file: SandboxFile = { path: `main.${language === 'typescript' ? 'ts' : 'js'}`, content: code }
    const result = await runInSandbox([file])
    const parts = [
      `exit code: ${result.exitCode ?? 'killed'}`,
      result.timedOut ? 'TIMED OUT after 15s' : null,
      result.stdout.trim() ? `stdout:\n${result.stdout.trim()}` : null,
      result.stderr.trim() ? `stderr:\n${result.stderr.trim()}` : null,
    ].filter((p): p is string => p !== null)
    return { ok: !result.timedOut && result.exitCode === 0, output: clip(parts.join('\n') || '(no output)', 8000) }
  },
}

// ---- read_document -----------------------------------------------------------

const readDocInput = z.object({
  documentId: z.string().min(1).max(64),
  offset: z.number().int().min(0).max(1_000_000).default(0),
})

export const readDocumentTool: ToolDescriptor<z.infer<typeof readDocInput>> = {
  name: 'read_document',
  description:
    'Read a portion of a document the user attached to this request. ' +
    'Input: {"documentId": string, "offset"?: number (character offset)}. ' +
    'Returns ~4000 characters of the ACTUAL extracted text from that offset.',
  permission: 'standard',
  timeoutMs: 5_000,
  validate(input) {
    return readDocInput.parse(input)
  },
  async execute({ documentId, offset }, ctx): Promise<ToolResult> {
    const doc = ctx.documents.get(documentId)
    if (!doc) {
      return { ok: false, output: `No attached document has id ${documentId}. Available: ${[...ctx.documents.keys()].join(', ') || 'none'}.` }
    }
    const slice = doc.text.slice(offset, offset + 4000)
    if (!slice) {
      return { ok: true, output: `Offset ${offset} is past the end of "${doc.name}" (${doc.text.length} characters total).` }
    }
    const nextOffset = offset + slice.length
    const more = nextOffset < doc.text.length ? `\n[more text remains: call again with offset=${nextOffset}]` : '\n[end of document]'
    return { ok: true, output: clip(`FILE: ${doc.name} (offset ${offset})\n\n${slice}${more}`, MAX_DOC_CHARS) }
  },
}
