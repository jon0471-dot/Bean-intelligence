'use client'

/**
 * RIISHE thread primitives — the ChatGPT-style message surface in BEAN's
 * black-and-gold identity (assistant-ui-inspired primitives, implemented on
 * the existing dependency set: react-markdown + remark-gfm +
 * react-syntax-highlighter; no new packages).
 *
 * Content rules preserved from the pre-upgrade RIISHE reading experience:
 *  - citation markers render as concise clickable source names (no numeric
 *    badges, no internal pipeline diagnostics);
 *  - the honest verification note appears ONLY when something material could
 *    not be confirmed;
 *  - sources stay behind a subtle collapsible section, each entry carrying
 *    publisher, verified publication date, and the claim it supports.
 *
 * Code rendering is display-only: generated code is NEVER executed in the
 * browser or on the server — the block is a highlighted, copyable artifact.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Markdown, Spinner } from '@/components/bean/shared'
import { cn } from '@/lib/utils'
import { RiisheIcon } from '@/components/riishe/RiisheIcon'
import { linkifyCitations, cleanAnswerForCopy, mapSourceClaims } from '@/lib/riishe/citation-view'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Globe,
  RefreshCw,
  Terminal,
} from 'lucide-react'
import type { Msg } from './use-riishe-chat'

/** The EXACT greeting required for a fresh conversation — no extra copy,
 *  no capability tour, no suggestions. Rendered as the empty-state hero;
 *  it is display-only and is never inserted into the message history or
 *  the model's context. */
export function WelcomeGreeting() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 pb-24 pt-10 text-center">
      {/* Official RIISHE app icon — the glossy rounded-square tile variant
          of the centralized RiisheIcon brand component. */}
      <RiisheIcon variant="tile" className="mb-5 h-14 w-14" />
      <h1 className="text-2xl font-semibold leading-snug text-white/92 sm:text-[28px]">
        Hello! I&apos;m <span className="bean-gold-text">RIISHE</span>, How can I help you today?
      </h1>
    </div>
  )
}

function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const copy = (text: string) => {
    const done = () => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done)
    } else {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      done()
    }
  }
  return [copied, copy]
}

/** Code block with real syntax highlighting, language label, copy button and
 *  a bounded height so long listings scroll instead of stretching the thread. */
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, copy] = useCopy()
  return (
    <div className="group/code relative my-2 overflow-hidden rounded-[10px] border border-[rgba(212,175,55,0.18)]">
      <div className="flex items-center justify-between bg-black/60 px-3 py-1">
        <span className="text-[10px] uppercase tracking-wider text-white/35">{lang || 'code'}</span>
        <button
          onClick={() => copy(code)}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white/45 transition-colors hover:bg-white/10 hover:text-white/80"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="max-h-[480px] overflow-auto bean-scroll">
        <SyntaxHighlighter
          language={lang || 'text'}
          style={vscDarkPlus}
          showLineNumbers={false}
          customStyle={{ margin: 0, background: '#0c0c0f', fontSize: '12.5px', padding: '12px 14px' }}
          wrapLongLines={false}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  )
}

/** Markdown renderer overrides shared by every RIISHE message. */
function useMarkdownComponents() {
  const components: React.ComponentProps<typeof Markdown>['components'] = {
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      if (href?.startsWith('#bean-src-')) {
        return (
          <a
            href={href}
            className="mx-0.5 rounded bg-[rgba(212,175,55,0.14)] px-1 text-[11px] text-[#e6c25a] no-underline hover:bg-[rgba(212,175,55,0.28)] hover:text-[#f0c75e]"
            title="Show source"
          >
            {children}
          </a>
        )
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-words text-[#f0c75e] underline decoration-[rgba(212,175,55,0.4)] hover:decoration-[#f0c75e]"
        >
          {children}
        </a>
      )
    },
    pre: ({ children }: { children?: ReactNode }) => {
      // React-markdown nests <code> inside <pre>; extract for highlighting.
      const child = Array.isArray(children) ? children[0] : children
      const props = (child as { props?: { className?: string; children?: ReactNode } })?.props
      const lang = props?.className?.replace(/language-/, '') || undefined
      const code = String(props?.children ?? '').replace(/\n$/, '')
      if (code === '') return <pre>{children}</pre>
      return <CodeBlock code={code} lang={lang} />
    },
    table: ({ children }: { children?: ReactNode }) => (
      // Wide tables scroll INSIDE their own wrapper — the thread column never
      // gets horizontal overflow on mobile.
      <div className="bean-scroll my-2 overflow-x-auto rounded-[10px] border border-[rgba(212,175,55,0.18)]">
        <table>{children}</table>
      </div>
    ),
  }
  return components
}

function CopyMessageButton({ content }: { content: string }) {
  const [copied, copy] = useCopy()
  return (
    <button
      onClick={() => copy(cleanAnswerForCopy(content))}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-white/45 transition-colors hover:bg-white/10 hover:text-white/85"
      aria-label="Copy response"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function SourceClaimLine({ content }: { content?: string }) {
  if (!content) return null
  return <div className="mt-0.5 text-[10.5px] leading-snug text-white/30">Supports: {content}</div>
}

/**
 * Answer-first evidence: NO state badges, NO tool chips, NO "last checked"
 * telemetry in the reading flow. What remains: a short honest verification
 * note ONLY when something material could not be confirmed, and a subtle
 * collapsed "Sources" section listing what was really retrieved.
 */
function AnswerMeta({
  meta,
  forceOpen,
  claims,
}: {
  meta?: Msg['meta']
  forceOpen?: boolean
  claims: Map<number, string>
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (forceOpen && detailsRef.current) detailsRef.current.open = true
  }, [forceOpen])
  const sources = meta?.sources ?? []
  const note = meta?.verificationNote
  const researchFailed = meta?.states?.includes('TOOL_UNAVAILABLE') ?? false
  if (!researchFailed && !note && sources.length === 0) return null
  return (
    <div className="mt-2 border-t border-[rgba(212,175,55,0.12)] pt-2">
      {researchFailed ? (
        <div className="text-[11px] text-amber-300/90">
          Live sources could not be checked for this answer — treat current details as unverified.
        </div>
      ) : note ? (
        <div className="text-[11px] leading-snug text-white/40">{note}</div>
      ) : null}

      {sources.length > 0 ? (
        <details ref={detailsRef} className="group mt-1">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-[11px] text-white/40 hover:text-white/65">
            <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
            Sources ({sources.length})
          </summary>
          <ul className="mt-1.5 space-y-2 pl-4">
            {sources.map((s) => (
              <li key={s.id} id={`bean-src-${s.id}`} className="scroll-mt-6 break-words text-[11px] leading-snug">
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-words text-[#f0c75e] hover:underline"
                >
                  {s.title.slice(0, 90)}
                  <ExternalLink className="ml-1 inline h-2.5 w-2.5" />
                </a>
                <span className="text-white/35"> — {s.hostName.replace(/^www\./, '')}</span>
                {s.date ? (
                  <span
                    className="ml-1 text-white/30"
                    title="Publication date stated by the source — distinct from the event date"
                  >
                    · published {s.date}
                  </span>
                ) : (
                  <span className="ml-1 text-white/25" title="No publication date could be verified for this source">
                    · no date verified
                  </span>
                )}
                {s.social ? (
                  <span className="ml-1 text-amber-300/50">· social-media post (unverified provenance)</span>
                ) : null}
                <SourceClaimLine content={claims.get(s.id)} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

function UserMessage({ msg }: { msg: Msg }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md border border-[rgba(212,175,55,0.22)] bg-[rgba(212,175,55,0.12)] px-4 py-2.5">
        <p className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-white/92">{msg.content}</p>
      </div>
    </div>
  )
}

function AssistantMessage({
  msg,
  chat,
  isStreamingThis,
}: {
  msg: Msg
  chat: import('./use-riishe-chat').RiisheChat
  /** True only for the message currently receiving the live stream. */
  isStreamingThis: boolean
}) {
  const components = useMarkdownComponents()
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const hasSources = (msg.meta?.sources?.length ?? 0) > 0

  if (!msg.content) {
    // Empty draft: the live honest status line (search / tools / thinking).
    return (
      <div className="flex items-start gap-3">
        <AssistantAvatar />
        <div className="min-w-0 flex-1 pt-1.5">
          {chat.researching ? (
            <span className="inline-flex items-center gap-2 text-xs text-white/50">
              <Globe className="h-3.5 w-3.5 animate-pulse text-[#d4af37]" /> Searching the web…
            </span>
          ) : chat.runningTool ? (
            <span className="inline-flex items-center gap-2 text-xs text-white/50">
              <Terminal className="h-3.5 w-3.5 animate-pulse text-[#d4af37]" />
              {chat.runningTool === 'working' ? 'Working…' : 'Running tools…'}
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 text-xs text-white/40">
              <Spinner /> Thinking…
            </span>
          )}
        </div>
      </div>
    )
  }

  const claims = mapSourceClaims(msg.content, msg.meta?.sources ?? [])
  return (
    <div className="flex items-start gap-3">
      <AssistantAvatar />
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[11px] font-semibold tracking-wide text-[#f0c75e]">RIISHE</div>
        <div className={cn('bean-prose text-[14.5px] text-white/88', isStreamingThis && 'bean-streaming')}>
          <Markdown content={linkifyCitations(msg.content, msg.meta?.sources)} components={components} />
        </div>
        {msg.pending ? <Spinner className="ml-1 mt-1" /> : null}
        {msg.partial ? (
          <div className="mt-2 inline-flex items-center gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300">
            <AlertTriangle className="h-3 w-3" /> Incomplete — the stream was stopped or ended early
          </div>
        ) : null}
        <AnswerMeta meta={msg.meta} forceOpen={sourcesOpen} claims={claims} />
        {!msg.pending ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <CopyMessageButton content={msg.content} />
            <button
              onClick={() => chat.regenerateFrom(msg)}
              disabled={chat.streaming}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-white/45 transition-colors hover:bg-white/10 hover:text-white/85 disabled:opacity-40"
              aria-label="Regenerate response"
            >
              <RefreshCw className="h-3 w-3" /> Regenerate
            </button>
            {hasSources ? (
              <button
                onClick={() => setSourcesOpen(true)}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-white/45 transition-colors hover:bg-white/10 hover:text-white/85"
                aria-label="View sources"
                aria-expanded={sourcesOpen}
              >
                <ExternalLink className="h-3 w-3" /> View sources
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function AssistantAvatar() {
  return (
    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.1)]">
      <RiisheIcon className="h-4.5 w-4.5" />
    </div>
  )
}

/** The full thread: greeting when empty, messages otherwise. */
export function RiisheThread({
  chat,
  endRef,
}: {
  chat: import('./use-riishe-chat').RiisheChat
  endRef: React.RefObject<HTMLDivElement | null>
}) {
  if (chat.messages.length === 0) {
    return <WelcomeGreeting />
  }
  const lastIdx = chat.messages.length - 1
  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 py-6 sm:px-6">
      {chat.messages.map((m, i) =>
        m.role === 'user' ? (
          <UserMessage key={m.id} msg={m} />
        ) : (
          <AssistantMessage
            key={m.id}
            msg={m}
            chat={chat}
            isStreamingThis={chat.streaming && i === lastIdx}
          />
        ),
      )}
      <div ref={endRef} />
    </div>
  )
}
