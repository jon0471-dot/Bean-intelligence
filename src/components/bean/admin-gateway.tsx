'use client'

/**
 * BEAN Intelligence — admin gateway management (API & model administration).
 *
 * Server-side authorization is enforced by the endpoints themselves
 * (/api/admin/gateway, /api/admin/verification, /api/v1/keys — admin session
 * only). This UI therefore only renders what the server already decided this
 * principal may see:
 *  - provider credentials as MASKED hints (the plaintext never leaves the
 *    server; even the encrypted envelope is never shipped);
 *  - application API keys as fingerprints (prefix + hash fragment);
 *  - a freshly created/rotated key is displayed EXACTLY ONCE, in a
 *    dismissable panel the user must copy from — the server never returns it
 *    again, and this component holds it only in memory.
 *  - self-verification controls (bounded: hard caps are enforced server-side).
 */
import { useCallback, useEffect, useState } from 'react'
import { beanFetch, GoldBadge, Spinner, StatusDot, timeAgo } from './shared'
import { KeyRound, Lock, PlugZap, ShieldCheck, Trash2, RefreshCw, Plus, Activity } from 'lucide-react'

interface CredentialView {
  id: string
  provider: string
  label: string
  maskedHint: string
  baseUrl: string | null
  status: string
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
}

interface GatewayData {
  credentialEncryption: 'configured' | 'not-configured'
  registeredProviders: string[]
  credentials: CredentialView[]
  externalProbe: { healthy: boolean; detail: string; latencyMs: number | null } | null
  models: Array<{
    id: string
    displayName: string
    provider: string
    capabilities: string[]
    enabled: boolean
    configurationStatus: string
    unavailableReason: string | null
    health: { healthy: boolean; detail: string; latencyMs: number | null } | null
  }>
  apiKeys: Array<{
    id: string
    name: string
    fingerprint: string
    permissions: string[]
    status: string
    rateLimitPerMin: number
    requestCount: number
    lastUsedAt: string | null
    expiresAt: string | null
    revokedAt: string | null
    createdAt: string
  }>
  recentRequests: Array<{
    id: string
    authKind: string
    provider: string
    model: string
    endpoint: string
    status: number
    errorCode: string | null
    streamed: boolean
    durationMs: number | null
    createdAt: string
  }>
}

interface VerificationData {
  config: {
    enabled: boolean
    verificationModel: string
    maxAttempts: number
    timeoutMs: number
    minConfidence: number
    regenerationLimit: number
    maxInputChars: number
  }
  hardCaps: { maxAttempts: number; timeoutMs: number; maxRegenerations: number; maxInputChars: number }
  chatModels: Array<{ id: string; displayName: string; provider: string; configurationStatus: string }>
}

const ALL_SCOPES = ['chat:completions', 'models:read', 'providers:read', 'usage:read', '*']

const VERIFICATION_STATUS_LABEL: Record<string, string> = {
  verified: 'Verified',
  corrected: 'Corrected + re-verified',
  'corrected-unverified': 'Corrected (re-check unavailable)',
  unverified: 'Not verified',
}

export function AdminGateway() {
  const [data, setData] = useState<GatewayData | null>(null)
  const [verif, setVerif] = useState<VerificationData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Shown-once key (create/rotate result) — memory only, gone on dismiss.
  const [shownKey, setShownKey] = useState<{ key: string; notice: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  // Credential create form
  const [credProvider, setCredProvider] = useState('openai-compatible')
  const [credLabel, setCredLabel] = useState('')
  const [credKey, setCredKey] = useState('')
  const [credBaseUrl, setCredBaseUrl] = useState('')

  // Key create form
  const [keyName, setKeyName] = useState('')
  const [keyScopes, setKeyScopes] = useState<string[]>(['chat:completions'])
  const [keyRate, setKeyRate] = useState(60)

  const reload = useCallback(async () => {
    try {
      const [g, v] = await Promise.all([
        beanFetch<GatewayData>('/api/admin/gateway'),
        beanFetch<VerificationData>('/api/admin/verification'),
      ])
      setData(g)
      setVerif(v)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const run = async (fn: () => Promise<unknown>, successNote?: string) => {
    setBusy(true)
    setFormError(null)
    try {
      await fn()
      if (successNote) setFormError(null)
      await reload()
    } catch (e) {
      setFormError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <div className="p-6 text-sm text-red-300">{error}</div>
  if (!data || !verif) {
    return <div className="flex h-40 items-center justify-center"><Spinner className="h-6 w-6" /></div>
  }

  return (
    <div className="space-y-8">
      {/* ---- Credential encryption status -------------------------------- */}
      <div className="bean-glass flex flex-wrap items-center gap-3 rounded-xl p-4 text-[13px]">
        <ShieldCheck className="h-4 w-4 text-[#d4af37]" />
        <span className="text-white/60">Credential encryption (master key):</span>
        {data.credentialEncryption === 'configured' ? (
          <GoldBadge tone="green"><StatusDot ok /> configured — provider credentials are AES-256-GCM encrypted</GoldBadge>
        ) : (
          <GoldBadge tone="red">
            not configured — set BEAN_CREDENTIALS_MASTER_KEY (32 bytes hex) in the environment to enable external provider credentials
          </GoldBadge>
        )}
      </div>

      {formError ? <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{formError}</div> : null}

      {/* ---- Provider credentials ---------------------------------------- */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
          <PlugZap className="h-4 w-4 text-[#d4af37]" /> Provider credentials (external AI providers)
        </h2>
        <div className="mb-3 space-y-2">
          {data.credentials.length === 0 ? (
            <p className="bean-glass rounded-xl p-4 text-[12.5px] text-white/40">
              No external provider credentials configured. The gateway serves the platform&apos;s own hosted models;
              external OpenAI-compatible providers stay honestly &quot;awaiting credentials&quot; until an administrator adds one.
            </p>
          ) : (
            data.credentials.map((c) => (
              <div key={c.id} className="bean-glass flex flex-wrap items-center gap-2 rounded-xl p-3 text-[12.5px]">
                <Lock className="h-3.5 w-3.5 text-[#d4af37]" />
                <span className="font-mono text-[#f0c75e]">{c.label}</span>
                <GoldBadge tone="neutral">{c.provider}</GoldBadge>
                {/* Masked hint only — never the plaintext, never the envelope */}
                <span className="font-mono text-white/50">{c.maskedHint}</span>
                {c.baseUrl ? <span className="text-white/35">{c.baseUrl}</span> : null}
                {c.status === 'active' ? <GoldBadge tone="green">active</GoldBadge> : <GoldBadge tone="red">revoked</GoldBadge>}
                <span className="text-[11px] text-white/30">added {timeAgo(c.createdAt)}{c.lastUsedAt ? ` · last used ${timeAgo(c.lastUsedAt)}` : ''}</span>
                {c.status === 'active' ? (
                  <button
                    disabled={busy}
                    onClick={() => void run(async () => { await beanFetch('/api/admin/gateway', { method: 'POST', body: JSON.stringify({ action: 'revoke-credential', id: c.id }) }) })}
                    className="ml-auto inline-flex items-center gap-1 rounded border border-red-400/30 px-2 py-1 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-3 w-3" /> Revoke
                  </button>
                ) : null}
              </div>
            ))
          )}
          {data.externalProbe ? (
            <div className="flex items-center gap-2 px-1 text-[11.5px] text-white/45">
              <StatusDot ok={data.externalProbe.healthy} /> external provider probe: {data.externalProbe.detail}
              {data.externalProbe.latencyMs != null ? ` (${data.externalProbe.latencyMs}ms)` : ''}
            </div>
          ) : null}
        </div>
        {data.credentialEncryption === 'configured' ? (
          <div className="bean-glass rounded-xl p-4">
            <p className="mb-2 text-[12px] text-white/50">
              Add a credential for an external OpenAI-compatible endpoint. The key is encrypted server-side immediately and never displayed again.
            </p>
            <div className="grid gap-2 md:grid-cols-2">
              <input value={credLabel} onChange={(e) => setCredLabel(e.target.value)} placeholder="Label (e.g. Production OpenAI)" className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-[12.5px] outline-none focus:border-[rgba(212,175,55,0.5)]" />
              <select value={credProvider} onChange={(e) => setCredProvider(e.target.value)} className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-[12.5px] outline-none focus:border-[rgba(212,175,55,0.5)]">
                {data.registeredProviders.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input value={credBaseUrl} onChange={(e) => setCredBaseUrl(e.target.value)} placeholder="Base URL (e.g. https://api.openai.com/v1)" className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-[12.5px] outline-none focus:border-[rgba(212,175,55,0.5)]" />
              <input value={credKey} onChange={(e) => setCredKey(e.target.value)} placeholder="Provider API key (paste — stored encrypted)" type="password" className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 font-mono text-[12.5px] outline-none focus:border-[rgba(212,175,55,0.5)]" />
            </div>
            <button
              disabled={busy || !credLabel || !credKey}
              onClick={() =>
                void run(async () => {
                  await beanFetch('/api/admin/gateway', {
                    method: 'POST',
                    body: JSON.stringify({
                      action: 'create-credential',
                      provider: credProvider,
                      label: credLabel,
                      apiKey: credKey,
                      baseUrl: credBaseUrl || null,
                    }),
                  })
                  setCredLabel('')
                  setCredKey('')
                  setCredBaseUrl('')
                }, 'credential created')
              }
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[rgba(212,175,55,0.4)] px-3 py-1.5 text-[12px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)] disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Add credential
            </button>
          </div>
        ) : null}
      </section>

      {/* ---- API keys ----------------------------------------------------- */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
          <KeyRound className="h-4 w-4 text-[#d4af37]" /> Application API keys (gateway access for BEAN products)
        </h2>
        <div className="mb-3 space-y-2">
          {data.apiKeys.length === 0 ? (
            <p className="bean-glass rounded-xl p-4 text-[12.5px] text-white/40">No application API keys yet.</p>
          ) : (
            data.apiKeys.map((k) => (
              <div key={k.id} className="bean-glass flex flex-wrap items-center gap-2 rounded-xl p-3 text-[12.5px]">
                <span className="font-mono text-[#f0c75e]">{k.name}</span>
                {/* Fingerprint only — prefix + hash fragment, useless to an attacker */}
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
                      onClick={() =>
                        void run(async () => {
                          const r = await beanFetch<{ key: string; notice: string }>(`/api/v1/keys/${k.id}/rotate`, { method: 'POST' })
                          setShownKey({ key: r.key, notice: r.notice })
                        })
                      }
                      className="inline-flex items-center gap-1 rounded border border-[rgba(212,175,55,0.35)] px-2 py-1 text-[11px] text-[#f0c75e] hover:bg-[rgba(212,175,55,0.1)] disabled:opacity-50"
                    >
                      <RefreshCw className="h-3 w-3" /> Rotate
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void run(async () => { await beanFetch(`/api/v1/keys/${k.id}`, { method: 'DELETE' }) })}
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
            Create an application API key. The complete key is shown ONCE — only its SHA-256 hash is stored server-side.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Key name (e.g. BEAN Reports integration)" className="min-w-[220px] flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-[12.5px] outline-none focus:border-[rgba(212,175,55,0.5)]" />
            <input type="number" min={1} max={600} value={keyRate} onChange={(e) => setKeyRate(Number(e.target.value))} title="Rate limit (requests/min)" className="w-24 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-[12.5px] outline-none focus:border-[rgba(212,175,55,0.5)]" />
            <div className="flex flex-wrap gap-1.5">
              {ALL_SCOPES.map((s) => (
                <button
                  key={s}
                  onClick={() => setKeyScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}
                  className={`rounded-full border px-2 py-0.5 font-mono text-[10.5px] ${keyScopes.includes(s) ? 'border-[rgba(212,175,55,0.5)] bg-[rgba(212,175,55,0.12)] text-[#f0c75e]' : 'border-white/15 text-white/40'}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <button
              disabled={busy || !keyName || keyScopes.length === 0}
              onClick={() =>
                void run(async () => {
                  const r = await beanFetch<{ key: string; notice: string }>('/api/v1/keys', {
                    method: 'POST',
                    body: JSON.stringify({ name: keyName, permissions: keyScopes, rateLimitPerMin: keyRate }),
                  })
                  setShownKey({ key: r.key, notice: r.notice })
                  setKeyName('')
                })
              }
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

      {/* ---- Model registry ----------------------------------------------- */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
          <Activity className="h-4 w-4 text-[#d4af37]" /> Gateway model registry (measured availability)
        </h2>
        <div className="space-y-2">
          {data.models.map((m) => (
            <div key={m.id} className="bean-glass flex flex-wrap items-center gap-2 rounded-xl p-3 text-[12.5px]">
              <span className="font-mono text-[#f0c75e]">{m.id}</span>
              <span className="text-white/60">{m.displayName}</span>
              {m.configurationStatus === 'configured' ? (
                m.health ? (
                  <GoldBadge tone={m.health.healthy ? 'green' : 'red'}><StatusDot ok={m.health.healthy} /> {m.health.healthy ? 'available' : 'unavailable (measured)'}</GoldBadge>
                ) : (
                  <GoldBadge tone="neutral">configured</GoldBadge>
                )
              ) : m.configurationStatus === 'awaiting-credentials' ? (
                <GoldBadge tone="gold">awaiting credentials</GoldBadge>
              ) : (
                <GoldBadge tone="red">disabled</GoldBadge>
              )}
              {m.capabilities.map((c) => <GoldBadge key={c} tone="neutral">{c}</GoldBadge>)}
              {m.unavailableReason ? <span className="basis-full text-[11.5px] text-white/40">{m.unavailableReason}</span> : null}
            </div>
          ))}
        </div>
      </section>

      {/* ---- Recent gateway requests -------------------------------------- */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
          <Activity className="h-4 w-4 text-[#d4af37]" /> Recent gateway requests (latest 25 — no prompts, no secrets)
        </h2>
        <div className="bean-glass divide-y divide-white/5 rounded-xl">
          {data.recentRequests.length === 0 ? (
            <p className="px-4 py-5 text-sm text-white/35">No gateway requests recorded yet.</p>
          ) : (
            data.recentRequests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[12px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-white/50">{r.model}</span>
                  <GoldBadge tone={r.status < 400 ? 'green' : 'red'}>{r.status}{r.errorCode ? ` · ${r.errorCode}` : ''}</GoldBadge>
                  <GoldBadge tone="neutral">{r.authKind}</GoldBadge>
                  {r.streamed ? <GoldBadge tone="neutral">stream</GoldBadge> : null}
                  <span className="text-white/30">{r.endpoint}</span>
                </div>
                <span className="text-[11px] text-white/30">{r.durationMs != null ? `${r.durationMs}ms · ` : ''}{timeAgo(r.createdAt)}</span>
              </div>
            ))
          )}
        </div>
      </section>

      {/* ---- Self-verification controls ----------------------------------- */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/80">
          <ShieldCheck className="h-4 w-4 text-[#d4af37]" /> Self-verification (CODE GIFTZ answer verification)
        </h2>
        <div className="bean-glass rounded-xl p-4">
          <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={verif.config.enabled}
                disabled={busy}
                onChange={(e) => {
                  const enabled = e.target.checked
                  setVerif({ ...verif, config: { ...verif.config, enabled } })
                  void run(async () => { await beanFetch('/api/admin/verification', { method: 'PUT', body: JSON.stringify({ enabled }) }) })
                }}
              />
              <span className="text-white/70">Enable self-verification</span>
            </label>
            <span className="text-white/40">— when enabled, every CODE GIFTZ answer is independently verified against the request (bounded, honest statuses).</span>
          </div>
          <div className="mt-3 grid gap-3 text-[12.5px] md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-white/50">Verification model (may differ from the answering model)</span>
              <select
                value={verif.config.verificationModel}
                disabled={busy}
                onChange={(e) => {
                  const verificationModel = e.target.value
                  setVerif({ ...verif, config: { ...verif.config, verificationModel } })
                  void run(async () => { await beanFetch('/api/admin/verification', { method: 'PUT', body: JSON.stringify({ verificationModel }) }) })
                }}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 outline-none focus:border-[rgba(212,175,55,0.5)]"
              >
                {verif.chatModels.map((m) => (
                  <option key={m.id} value={m.id} disabled={m.configurationStatus !== 'configured'}>
                    {m.displayName} ({m.id}){m.configurationStatus !== 'configured' ? ' — awaiting credentials' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-white/50">Max verification attempts (hard cap {verif.hardCaps.maxAttempts})</span>
              <input
                type="number"
                min={1}
                max={verif.hardCaps.maxAttempts}
                value={verif.config.maxAttempts}
                disabled={busy}
                onChange={(e) => {
                  const maxAttempts = Math.max(1, Math.min(verif.hardCaps.maxAttempts, Number(e.target.value) || 1))
                  setVerif({ ...verif, config: { ...verif.config, maxAttempts } })
                  void run(async () => { await beanFetch('/api/admin/verification', { method: 'PUT', body: JSON.stringify({ maxAttempts }) }) })
                }}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 outline-none focus:border-[rgba(212,175,55,0.5)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-white/50">Verification timeout (ms, cap {verif.hardCaps.timeoutMs})</span>
              <input
                type="number"
                min={5000}
                max={verif.hardCaps.timeoutMs}
                step={1000}
                value={verif.config.timeoutMs}
                disabled={busy}
                onChange={(e) => {
                  const timeoutMs = Math.max(5000, Math.min(verif.hardCaps.timeoutMs, Number(e.target.value) || 5000))
                  setVerif({ ...verif, config: { ...verif.config, timeoutMs } })
                  void run(async () => { await beanFetch('/api/admin/verification', { method: 'PUT', body: JSON.stringify({ timeoutMs }) }) })
                }}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 outline-none focus:border-[rgba(212,175,55,0.5)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-white/50">Minimum confidence to claim &quot;verified&quot; (0–1)</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={verif.config.minConfidence}
                disabled={busy}
                onChange={(e) => {
                  const minConfidence = Math.max(0, Math.min(1, Number(e.target.value)))
                  setVerif({ ...verif, config: { ...verif.config, minConfidence } })
                  void run(async () => { await beanFetch('/api/admin/verification', { method: 'PUT', body: JSON.stringify({ minConfidence }) }) })
                }}
                className="rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 outline-none focus:border-[rgba(212,175,55,0.5)]"
              />
            </label>
          </div>
          <p className="mt-3 text-[11px] text-white/35">
            No infinite loops: attempts are hard-capped ({verif.hardCaps.maxAttempts} verifies, ≤ {verif.hardCaps.maxAttempts - 1} corrective revisions per turn).
            When verification cannot establish correctness, the best available answer ships with an honest &quot;not fully verified&quot; status — never a claimed verification.
          </p>
        </div>
      </section>

      {busy ? <div className="flex justify-center py-2"><Spinner className="h-4 w-4" /></div> : null}
    </div>
  )
}

// Re-export the label map for tests/type consumers.
export { VERIFICATION_STATUS_LABEL }
