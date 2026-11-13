'use client'

/**
 * BEAN Intelligence — developer portal (Phase 1).
 *
 * Self-service surface for ANY signed-in user (members included):
 *   Projects — create and manage the caller's OWN single-owner projects.
 *   API Keys — create project-scoped keys with selected scopes, view SAFE
 *              metadata only, rotate, revoke.
 *   Usage    — real persisted per-key usage from the gateway (never invented).
 *   Logs     — real recorded gateway requests + portal activity for the project.
 *
 * Server-side authorization is enforced by the endpoints themselves
 * (/api/portal/* — session-only, owner-scoped, 404 on cross-user access).
 * This UI only renders what the server already decided this principal may
 * see. A freshly created/rotated key is displayed EXACTLY ONCE in a
 * dismissable panel — the server never returns it again and this component
 * holds it only in memory.
 */
import { useCallback, useEffect, useState } from 'react'
import { beanFetch, GoldBadge, Spinner, StatusDot, timeAgo } from './shared'
import {
  FolderKey,
  Plus,
  KeyRound,
  RefreshCw,
  Trash2,
  Activity,
  ScrollText,
  Archive,
  ArchiveRestore,
} from 'lucide-react'

interface ProjectView {
  id: string
  name: string
  status: string
  createdAt: string
  updatedAt: string
}

interface KeyView {
  id: string
  name: string
  fingerprint: string
  permissions: string[]
  rateLimitPerMin: number
  status: string
  expiresAt: string | null
  lastUsedAt: string | null
  requestCount: number
  createdAt: string
  revokedAt: string | null
}

interface UsageData {
  project: ProjectView
  totals: { requests: number; successes: number; failures: number; tokensIn: number; tokensOut: number }
  keys: Array<{
    id: string
    name: string
    fingerprint: string
    status: string
    requestCount: number
    lastUsedAt: string | null
    createdAt: string
  }>
  note: string
}

interface LogsData {
  project: { id: string; name: string }
  requests: Array<{
    id: string
    keyId: string | null
    keyName: string | null
    provider: string
    model: string
    endpoint: string
    status: number
    errorCode: string | null
    tokensIn: number | null
    tokensOut: number | null
    durationMs: number | null
    streamed: boolean
    createdAt: string
  }>
  activity: Array<{ id: string; action: string; target: string | null; createdAt: string }>
}

export function Portal() {
  const [projects, setProjects] = useState<ProjectView[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [keys, setKeys] = useState<{ scopes: string[]; keys: KeyView[] } | null>(null)
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [logs, setLogs] = useState<LogsData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Shown-once key (create/rotate result) — memory only, gone on dismiss.
  const [shownKey, setShownKey] = useState<{ key: string; notice: string } | null>(null)

  // Forms
  const [newProjectName, setNewProjectName] = useState('')
  const [keyName, setKeyName] = useState('')
  const [keyScopes, setKeyScopes] = useState<string[]>(['chat:completions'])

  const selected = projects?.find((p) => p.id === selectedId) ?? null

  const reloadProjects = useCallback(async () => {
    const d = await beanFetch<{ projects: ProjectView[] }>('/api/portal/projects')
    setProjects(d.projects)
    return d.projects
  }, [])

  const reloadProjectData = useCallback(async (id: string) => {
    const [k, u, l] = await Promise.all([
      beanFetch<{ scopes: string[]; keys: KeyView[] }>(`/api/portal/projects/${id}/keys`),
      beanFetch<UsageData>(`/api/portal/projects/${id}/usage`),
      beanFetch<LogsData>(`/api/portal/projects/${id}/logs`),
    ])
    setKeys(k)
    setUsage(u)
    setLogs(l)
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const list = await reloadProjects()
        if (list.length > 0) setSelectedId((cur) => cur ?? list[0].id)
        setLoadError(null)
      } catch (e) {
        setLoadError((e as Error).message)
      }
    })()
  }, [reloadProjects])

  useEffect(() => {
    if (!selectedId) return
    void (async () => {
      try {
        await reloadProjectData(selectedId)
        setLoadError(null)
      } catch (e) {
        setLoadError((e as Error).message)
      }
    })()
  }, [selectedId, reloadProjectData])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setFormError(null)
    try {
      await fn()
    } catch (e) {
      setFormError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const createProject = () =>
    void run(async () => {
      const r = await beanFetch<{ project: ProjectView }>('/api/portal/projects', {
        method: 'POST',
        body: JSON.stringify({ name: newProjectName }),
      })
      setNewProjectName('')
      await reloadProjects()
      setSelectedId(r.project.id)
    })

  const patchProject = (id: string, patch: { name?: string; status?: string }) =>
    void run(async () => {
      await beanFetch(`/api/portal/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      await reloadProjects()
      if (selectedId) await reloadProjectData(selectedId)
    })

  const createKey = () =>
    void run(async () => {
      if (!selectedId) return
      const r = await beanFetch<{ key: string; notice: string }>(`/api/portal/projects/${selectedId}/keys`, {
        method: 'POST',
        body: JSON.stringify({ name: keyName, permissions: keyScopes }),
      })
      setShownKey({ key: r.key, notice: r.notice })
      setKeyName('')
      await reloadProjectData(selectedId)
    })

  const rotateKey = (keyId: string) =>
    void run(async () => {
      if (!selectedId) return
      const r = await beanFetch<{ key: string; notice: string }>(`/api/portal/projects/${selectedId}/keys/${keyId}/rotate`, { method: 'POST' })
      setShownKey({ key: r.key, notice: r.notice })
      await reloadProjectData(selectedId)
    })

  const revokeKey = (keyId: string) =>
    void run(async () => {
      if (!selectedId) return
      await beanFetch(`/api/portal/projects/${selectedId}/keys/${keyId}`, { method: 'DELETE' })
      await reloadProjectData(selectedId)
    })

  if (loadError) return <div className="p-6 text-sm text-red-300">{loadError}</div>
  if (projects === null) {
    return <div className="flex h-40 items-center justify-center"><Spinner className="h-6 w-6" /></div>
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-2">
        <FolderKey className="h-5 w-5 text-[#d4af37]" />
        <h1 className="text-xl font-semibold tracking-tight">Developer portal</h1>
      </div>

      <div className="bean-glass mb-6 rounded-xl p-4 text-xs leading-relaxed text-white/45">
        Single-owner projects with project-scoped API keys for the BEAN gateway. A project key works anywhere its granted
        scopes are enforced (today: the v1 chat API) and can never reach resources outside its own project. The complete
        key is shown exactly once at creation — only its SHA-256 hash is stored server-side.
      </div>

      {formError ? <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{formError}</div> : null}

      {/* ---- Projects ------------------------------------------------------ */}
      <section className="mb-10">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
          <FolderKey className="h-4 w-4 text-[#d4af37]" /> Projects
        </h2>
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          {projects.length === 0 ? (
            <p className="bean-glass rounded-xl p-4 text-[12.5px] text-white/40 sm:col-span-2">
              No projects yet — create one below to start issuing project-scoped API keys.
            </p>
          ) : (
            projects.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                aria-pressed={selectedId === p.id}
                className={`bean-glass rounded-xl p-3 text-left transition-colors ${
                  selectedId === p.id ? 'shadow-[inset_0_0_0_1px_rgba(212,175,55,0.45)]' : 'hover:shadow-[inset_0_0_0_1px_rgba(212,175,55,0.2)]'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-[#f0c75e]">{p.name}</span>
                  {p.status === 'active' ? <GoldBadge tone="green">active</GoldBadge> : <GoldBadge tone="neutral">archived</GoldBadge>}
                </div>
                <div className="mt-1 text-[11px] text-white/30">created {timeAgo(p.createdAt)} · updated {timeAgo(p.updatedAt)}</div>
              </button>
            ))
          )}
        </div>
        <div className="bean-glass flex flex-wrap items-center gap-2 rounded-xl p-3">
          <input
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && newProjectName.trim() && createProject()}
            placeholder="New project name (e.g. My app integration)"
            className="min-w-[220px] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-[12.5px] outline-none focus:border-[rgba(212,175,55,0.5)]"
          />
          <button
            disabled={busy || !newProjectName.trim()}
            onClick={createProject}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(212,175,55,0.4)] px-3 py-1.5 text-[12px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)] disabled:opacity-50"
          >
            <Plus className="h-3.5 w-3.5" /> Create project
          </button>
        </div>
      </section>

      {selected ? (
        <>
          {/* ---- API keys ---------------------------------------------------- */}
          <section className="mb-10">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-white/80">
                <KeyRound className="h-4 w-4 text-[#d4af37]" /> API keys — {selected.name}
              </h2>
              {selected.status === 'active' ? (
                <button
                  disabled={busy}
                  onClick={() => patchProject(selected.id, { status: 'archived' })}
                  className="ml-auto inline-flex items-center gap-1 rounded border border-white/15 px-2 py-1 text-[11px] text-white/50 hover:bg-white/5 disabled:opacity-50"
                  title="Archived projects cannot mint new keys; existing keys keep their recorded state"
                >
                  <Archive className="h-3 w-3" /> Archive
                </button>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => patchProject(selected.id, { status: 'active' })}
                  className="ml-auto inline-flex items-center gap-1 rounded border border-[rgba(212,175,55,0.35)] px-2 py-1 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)] disabled:opacity-50"
                >
                  <ArchiveRestore className="h-3 w-3" /> Reactivate
                </button>
              )}
            </div>
            <div className="mb-3 space-y-2">
              {keys === null ? (
                <div className="flex h-16 items-center justify-center"><Spinner className="h-5 w-5" /></div>
              ) : keys.keys.length === 0 ? (
                <p className="bean-glass rounded-xl p-4 text-[12.5px] text-white/40">No keys in this project yet.</p>
              ) : (
                keys.keys.map((k) => (
                  <div key={k.id} className="bean-glass flex flex-wrap items-center gap-2 rounded-xl p-3 text-[12.5px]">
                    <span className="font-mono text-[#f0c75e]">{k.name}</span>
                    {/* Fingerprint only — the raw key is never shown again, by construction */}
                    <span className="font-mono text-white/50">{k.fingerprint}</span>
                    {k.status === 'active' ? <GoldBadge tone="green">active</GoldBadge> : <GoldBadge tone="red">revoked</GoldBadge>}
                    {k.permissions.map((p) => <GoldBadge key={p} tone="neutral">{p}</GoldBadge>)}
                    <span className="text-white/35">{k.rateLimitPerMin}/min · {k.requestCount} requests</span>
                    {k.expiresAt ? <span className="text-white/35">expires {new Date(k.expiresAt).toISOString().slice(0, 10)}</span> : null}
                    <span className="text-[11px] text-white/30">created {timeAgo(k.createdAt)}{k.lastUsedAt ? ` · last used ${timeAgo(k.lastUsedAt)}` : ''}</span>
                    {k.status === 'active' ? (
                      <span className="ml-auto flex gap-1.5">
                        <button
                          disabled={busy}
                          onClick={() => rotateKey(k.id)}
                          className="inline-flex items-center gap-1 rounded border border-[rgba(212,175,55,0.35)] px-2 py-1 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)] disabled:opacity-50"
                        >
                          <RefreshCw className="h-3 w-3" /> Rotate
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => revokeKey(k.id)}
                          className="inline-flex items-center gap-1 rounded border border-red-400/30 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" /> Revoke
                        </button>
                      </span>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            <div className="bean-glass rounded-xl p-4">
              <p className="mb-2 text-[12px] text-white/50">
                Create a key for <span className="text-[#f0c75e]">{selected.name}</span>. The complete key is shown ONCE — copy it
                immediately; it cannot be retrieved again. Scopes marked &quot;planned&quot; are real grants whose product
                endpoints arrive in a future phase — they are stored and enforced by the gateway&apos;s central scope gate.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="Key name (e.g. Production backend)"
                  className="min-w-[220px] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-[12.5px] outline-none focus:border-[rgba(212,175,55,0.5)]"
                />
                <div className="flex flex-wrap gap-1.5">
                  {(keys?.scopes ?? []).map((s) => (
                    <button
                      key={s}
                      onClick={() => setKeyScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
                      aria-pressed={keyScopes.includes(s)}
                      className={`rounded-full border px-2 py-0.5 font-mono text-[10.5px] ${
                        keyScopes.includes(s) ? 'border-[rgba(212,175,55,0.5)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]' : 'border-white/15 text-white/40'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <button
                  disabled={busy || !keyName.trim() || keyScopes.length === 0 || selected.status !== 'active'}
                  onClick={createKey}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[rgba(212,175,55,0.4)] px-3 py-1.5 text-[12px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)] disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" /> Create key
                </button>
              </div>
            </div>
            {shownKey ? (
              <div className="mt-3 rounded-xl border border-[rgba(212,175,55,0.45)] bg-[rgba(212,175,55,0.08)] p-4">
                <p className="mb-2 text-[12px] font-semibold text-[#f0c75e]">{shownKey.notice}</p>
                <code className="block break-all rounded-lg bg-black/50 px-3 py-2 font-mono text-[12.5px] text-white/85 select-all">{shownKey.key}</code>
                <button onClick={() => setShownKey(null)} className="mt-2 rounded border border-white/20 px-2.5 py-1 text-[11px] text-white/60 hover:bg-white/5">
                  I stored it — dismiss forever
                </button>
              </div>
            ) : null}
          </section>

          {/* ---- Usage -------------------------------------------------------- */}
          <section className="mb-10">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
              <Activity className="h-4 w-4 text-[#d4af37]" /> Usage — real recorded data
            </h2>
            {usage === null ? (
              <div className="flex h-16 items-center justify-center"><Spinner className="h-5 w-5" /></div>
            ) : (
              <>
                <div className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  <UsageStat label="Requests" value={usage.totals.requests} />
                  <UsageStat label="Successes" value={usage.totals.successes} />
                  <UsageStat label="Failures" value={usage.totals.failures} />
                  <UsageStat label="Tokens in" value={usage.totals.tokensIn} />
                  <UsageStat label="Tokens out" value={usage.totals.tokensOut} />
                </div>
                <div className="bean-glass divide-y divide-white/5 rounded-xl">
                  {usage.keys.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-white/35">No keys — create one to start attributing usage.</p>
                  ) : (
                    usage.keys.map((k) => (
                      <div key={k.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[12px]">
                        <span className="font-mono text-[#f0c75e]">{k.name}</span>
                        <span className="font-mono text-white/45">{k.fingerprint}</span>
                        {k.status === 'active' ? <StatusDot ok /> : <StatusDot ok={false} />}
                        <span className="ml-auto text-white/45">{k.requestCount} requests{k.lastUsedAt ? ` · last used ${timeAgo(k.lastUsedAt)}` : ''}</span>
                      </div>
                    ))
                  )}
                </div>
                <p className="mt-2 px-1 text-[11px] text-white/35">{usage.note}</p>
              </>
            )}
          </section>

          {/* ---- Logs --------------------------------------------------------- */}
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
              <ScrollText className="h-4 w-4 text-[#d4af37]" /> Logs — gateway requests &amp; portal activity
            </h2>
            {logs === null ? (
              <div className="flex h-16 items-center justify-center"><Spinner className="h-5 w-5" /></div>
            ) : (
              <div className="space-y-4">
                <div className="bean-glass divide-y divide-white/5 rounded-xl">
                  <div className="px-4 py-2 text-[11px] font-medium tracking-[0.14em] text-white/40">GATEWAY REQUESTS (latest {logs.requests.length || 0} — no prompts, no secrets)</div>
                  {logs.requests.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-white/35">No gateway requests recorded for this project&apos;s keys yet.</p>
                  ) : (
                    logs.requests.map((r) => (
                      <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[12px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-white/55">{r.model}</span>
                          <GoldBadge tone={r.status < 400 ? 'green' : 'red'}>{r.status}{r.errorCode ? ` · ${r.errorCode}` : ''}</GoldBadge>
                          {r.streamed ? <GoldBadge tone="neutral">stream</GoldBadge> : null}
                          {r.keyName ? <span className="text-white/35">via {r.keyName}</span> : null}
                        </div>
                        <span className="text-[11px] text-white/30">{r.durationMs != null ? `${r.durationMs}ms · ` : ''}{timeAgo(r.createdAt)}</span>
                      </div>
                    ))
                  )}
                </div>
                <div className="bean-glass divide-y divide-white/5 rounded-xl">
                  <div className="px-4 py-2 text-[11px] font-medium tracking-[0.14em] text-white/40">PORTAL ACTIVITY (latest {logs.activity.length || 0})</div>
                  {logs.activity.length === 0 ? (
                    <p className="px-4 py-4 text-sm text-white/35">No portal activity recorded yet.</p>
                  ) : (
                    logs.activity.map((a) => (
                      <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[12px]">
                        <span className="font-mono text-white/55">{a.action}</span>
                        <span className="text-[11px] text-white/30">{timeAgo(a.createdAt)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </section>
        </>
      ) : null}

      {busy ? <div className="flex justify-center py-2"><Spinner className="h-4 w-4" /></div> : null}
    </div>
  )
}

function UsageStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bean-glass rounded-xl p-4">
      <div className="text-[10.5px] font-medium tracking-[0.14em] text-white/40">{label.toUpperCase()}</div>
      <div className="mt-1 text-lg font-semibold text-white/85">{value}</div>
    </div>
  )
}
