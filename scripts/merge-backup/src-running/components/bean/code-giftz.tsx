'use client'

/**
 * BEAN Intelligence — CODE GIFTZ workspace.
 * Modes: generate / explain / review / plan. Generated files can be
 * executed in the restricted sandbox — ONLY via the explicit Run button
 * (server requires approval:true). Real stdout/stderr/exit code shown.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Markdown, Spinner, timeAgo, beanFetch } from './shared'
import { cn } from '@/lib/utils'
import { Code2, Play, FileCode2, Terminal, CircleCheck, CircleX, History } from 'lucide-react'

type Mode = 'generate' | 'explain' | 'review' | 'plan'
interface TaskFile { path: string; content: string }
interface Task {
  id: string
  mode: string | null
  status: string
  content: string | null
  files: TaskFile[]
  durationMs: number | null
  createdAt: string
}
interface RunResult {
  runId: string
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  durationMs: number
}

const LANGS = ['javascript', 'typescript', 'python', 'sql']

export function CodeGiftz() {
  const [mode, setMode] = useState<Mode>('generate')
  const [language, setLanguage] = useState('javascript')
  const [prompt, setPrompt] = useState('')
  const [codeContext, setCodeContext] = useState('')
  const [busy, setBusy] = useState(false)
  const [task, setTask] = useState<Task | null>(null)
  const [history, setHistory] = useState<Task[]>([])
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [run, setRun] = useState<RunResult | null>(null)
  const [activeFile, setActiveFile] = useState(0)

  const loadHistory = useCallback(async () => {
    try {
      const d = await beanFetch<{ tasks: Task[] }>('/api/code-giftz/tasks')
      setHistory(d.tasks)
    } catch { /* non-fatal */ }
  }, [])

  useEffect(() => { void loadHistory() }, [loadHistory])

  async function submit() {
    const p = prompt.trim()
    if (!p || busy) return
    setBusy(true)
    setError(null)
    setRun(null)
    try {
      const d = await beanFetch<{ task: Task }>('/api/code-giftz/tasks', {
        method: 'POST',
        json: { mode, prompt: p, language, codeContext: codeContext.trim() || undefined },
      })
      setTask(d.task)
      setActiveFile(0)
      void loadHistory()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function runInSandbox() {
    if (!task || running) return
    setRunning(true)
    setRun(null)
    try {
      const d = await beanFetch<{ run: RunResult }>('/api/code-giftz/run', {
        method: 'POST',
        json: { taskId: task.id, approval: true },
      })
      setRun(d.run)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-3.5rem-2rem)] lg:grid-cols-[420px_1fr]">
      {/* Composer + history */}
      <div className="border-b border-[rgba(212,175,55,0.1)] p-5 lg:border-b-0 lg:border-r">
        <div className="mb-4 flex items-center gap-2">
          <Code2 className="h-4 w-4 text-[#d4af37]" />
          <h2 className="text-sm font-semibold tracking-wide">CODE GIFTZ</h2>
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="mb-4">
          <TabsList className="grid w-full grid-cols-4 bg-black/40">
            {(['generate', 'explain', 'review', 'plan'] as Mode[]).map((m) => (
              <TabsTrigger key={m} value={m} className="text-[11px] capitalize data-[state=active]:text-[#f0c75e]">
                {m}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <label htmlFor="cg-prompt" className="mb-1.5 block text-xs text-white/55">Task</label>
        <Textarea
          id="cg-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          maxLength={12000}
          placeholder={
            mode === 'generate' ? 'Describe what to build…'
            : mode === 'explain' ? 'Paste or describe code to explain…'
            : mode === 'review' ? 'Paste code to review…'
            : 'Describe the feature to plan…'
          }
          className="resize-none bg-black/30"
        />

        {mode !== 'generate' && mode !== 'plan' ? (
          <>
            <label htmlFor="cg-context" className="mb-1.5 mt-3 block text-xs text-white/55">Code context (optional)</label>
            <Textarea
              id="cg-context"
              value={codeContext}
              onChange={(e) => setCodeContext(e.target.value)}
              rows={4}
              maxLength={12000}
              placeholder="Paste the code here…"
              className="resize-none bg-black/30 font-mono text-xs"
            />
          </>
        ) : (
          <div className="mt-3">
            <div className="mb-1.5 text-xs text-white/55">Target language</div>
            <div className="flex gap-1.5">
              {LANGS.map((l) => (
                <button
                  key={l}
                  onClick={() => setLanguage(l)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-[11px] transition-colors',
                    language === l ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]' : 'border-white/10 text-white/50 hover:border-[rgba(212,175,55,0.3)]',
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        )}

        <Button onClick={() => void submit()} disabled={busy || prompt.trim().length < 5} className="mt-4 w-full bg-[#d4af37] font-semibold text-black hover:bg-[#e6c25a]">
          {busy ? <Spinner className="border-black/30 border-t-black" /> : <Play className="mr-1.5 h-4 w-4" />}
          {busy ? 'Working…' : 'Run task'}
        </Button>

        {history.length > 0 ? (
          <div className="mt-6">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] tracking-wide text-white/40">
              <History className="h-3.5 w-3.5" /> Recent tasks
            </div>
            <div className="bean-scroll max-h-52 space-y-1 overflow-y-auto pr-1">
              {history.map((h) => (
                <button
                  key={h.id}
                  onClick={() => { setTask(h); setRun(null); setActiveFile(0); setError(null) }}
                  className={cn(
                    'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[12px] transition-colors',
                    task?.id === h.id ? 'bg-[rgba(212,175,55,0.1)] text-[#f0c75e]' : 'text-white/55 hover:bg-white/5',
                  )}
                >
                  <span className="truncate">{h.mode ?? 'task'} · {(h.content ?? '').slice(0, 40) || '(no text)'}</span>
                  <span className="ml-2 shrink-0 text-[10px] text-white/30">{timeAgo(h.createdAt)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* Result */}
      <div className="min-w-0 p-5">
        {error ? <div className="mb-3 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div> : null}
        {!task ? (
          <div className="flex h-full flex-col items-center justify-center py-20 text-center">
            <Code2 className="mb-3 h-10 w-10 text-[#d4af37]/50" />
            <p className="text-sm font-medium text-white/75">No task yet</p>
            <p className="mt-1 max-w-sm text-xs text-white/40">
              Describe a coding task on the left. Generated files can be executed in the restricted sandbox — only after you press Run.
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[calc(100vh-9rem)] min-h-[420px]">
            <div className="pr-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs text-white/40 capitalize">{task.mode} task · {timeAgo(task.createdAt)}</span>
                {task.files.length > 0 ? (
                  <Button onClick={() => void runInSandbox()} disabled={running} size="sm" variant="outline" className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10">
                    {running ? <Spinner className="mr-1.5" /> : <Terminal className="mr-1.5 h-3.5 w-3.5" />}
                    Run in sandbox
                  </Button>
                ) : null}
              </div>

              {task.files.length > 0 ? (
                <div className="bean-glass mb-4 rounded-xl p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    {task.files.map((f, i) => (
                      <button
                        key={f.path}
                        onClick={() => setActiveFile(i)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
                          activeFile === i ? 'border-[rgba(212,175,55,0.55)] bg-[rgba(212,175,55,0.1)] text-[#f0c75e]' : 'border-white/10 text-white/50 hover:border-[rgba(212,175,55,0.3)]',
                        )}
                      >
                        <FileCode2 className="h-3 w-3" /> {f.path}
                      </button>
                    ))}
                  </div>
                  <pre className="bean-scroll max-h-72 overflow-auto rounded-lg bg-[#0c0c0f] p-3 text-[12px] leading-relaxed">
                    <code className="font-mono text-white/80">{task.files[activeFile]?.content}</code>
                  </pre>
                </div>
              ) : null}

              <div className="bean-glass rounded-xl p-4">
                <Markdown content={task.content ?? ''} />
              </div>

              {run ? (
                <div className="bean-glass mt-4 rounded-xl p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white/80">
                      <Terminal className="h-4 w-4 text-[#d4af37]" /> Sandbox result
                    </div>
                    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px]',
                      run.timedOut ? 'border-amber-500/40 text-amber-300'
                      : run.exitCode === 0 ? 'border-emerald-500/40 text-emerald-300'
                      : 'border-red-500/40 text-red-300')}>
                      {run.timedOut ? <CircleX className="h-3 w-3" /> : run.exitCode === 0 ? <CircleCheck className="h-3 w-3" /> : <CircleX className="h-3 w-3" />}
                      {run.timedOut ? 'timeout (SIGKILL)' : `exit ${run.exitCode ?? '—'}`} · {run.durationMs}ms
                    </span>
                  </div>
                  {run.stdout ? (
                    <pre className="bean-scroll max-h-56 overflow-auto rounded-lg bg-black/60 p-3 text-[12px] text-emerald-200/90"><code className="font-mono">{run.stdout}</code></pre>
                  ) : null}
                  {run.stderr ? (
                    <pre className="bean-scroll mt-2 max-h-40 overflow-auto rounded-lg bg-black/60 p-3 text-[12px] text-red-300/90"><code className="font-mono">{run.stderr}</code></pre>
                  ) : null}
                  {!run.stdout && !run.stderr ? <p className="text-xs text-white/40">The process produced no output.</p> : null}
                </div>
              ) : null}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
