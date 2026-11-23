'use client'

/**
 * BEAN Intelligence — AI Device settings (universal AI runtime controls).
 *
 * The coherent control surface for device acceleration (task §4 user controls):
 * compute mode, consent, per-capability honest status, model downloads with
 * REAL size shown before any approval, pause/cancel, cache management, the
 * optional local desktop engine pairing (loopback only) and the privacy
 * summary. Everything is driven by MEASURED state (DeviceCapabilityManager);
 * no status here can be fabricated by configuration.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  Cpu, Globe, HardDriveDownload, Laptop, Loader2, RefreshCw, ShieldCheck,
  Trash2, Zap, CircleStop, Server, Info,
} from 'lucide-react'
import {
  getDeviceCapabilityManager,
  CHAT_MODEL_ID,
  ASR_MODEL_ID,
  AI_CAPABILITY_STATUS_EXPLANATIONS,
  type AiCapabilityStatus,
  type DeviceAiStatus,
} from '@/lib/client-compute/inference/device-capability-manager'
import { getDeviceSettings, setDeviceSettings, unpairLocalEngine, type AiDeviceMode } from '@/lib/client-compute/inference/device-settings'
import { getDefaultModelRegistry, clientModelDisplayName as modelDisplayName } from '@/lib/client-compute/model-registry'
import { getConsent, setConsent } from '@/lib/client-compute/privacy'

function formatBytes(n: number | null): string {
  if (n === null) return 'unknown'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const STATUS_STYLES: Record<AiCapabilityStatus, string> = {
  ready: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  loading: 'border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.1)] text-[#f0c75e]',
  downloading: 'border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.1)] text-[#f0c75e]',
  'not-installed': 'border-white/15 bg-white/5 text-white/55',
  'not-configured': 'border-white/15 bg-white/5 text-white/55',
  'unsupported-on-device': 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  unavailable: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  degraded: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  failed: 'border-red-500/40 bg-red-500/10 text-red-300',
}

const MODES: Array<{ id: AiDeviceMode; label: string; hint: string }> = [
  { id: 'auto', label: 'Automatic', hint: 'Browser GPU → browser CPU → paired local engine → server, per request' },
  { id: 'gpu-preferred', label: 'GPU acceleration', hint: 'Prefer WebGPU when this device supports it' },
  { id: 'cpu-only', label: 'CPU only', hint: 'Never use the GPU (battery/thermal control)' },
  { id: 'local-engine', label: 'Local desktop engine', hint: 'Use the paired llama.cpp engine on this computer' },
  { id: 'server', label: 'Server providers', hint: 'Everything runs server-side through the BEAN gateway' },
]

type DownloadState = { modelId: string; progress: number | null; note: string } | null

export function AiDeviceSettings() {
  const [status, setStatus] = useState<DeviceAiStatus | null>(null)
  const [settings, setSettingsState] = useState(getDeviceSettings())
  const [consentState, setConsentState] = useState(getConsent())
  const [busy, setBusy] = useState(false)
  const [download, setDownload] = useState<DownloadState>(null)
  const [confirmDownloadId, setConfirmDownloadId] = useState<string | null>(null)
  const [note, setNote] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const [engineHost, setEngineHost] = useState<'127.0.0.1' | 'localhost'>(settings.localEngine?.host === 'localhost' ? 'localhost' : '127.0.0.1')
  const [enginePort, setEnginePort] = useState<string>(String(settings.localEngine?.port ?? 8080))
  const [engineKey, setEngineKey] = useState('')
  const [engineBusy, setEngineBusy] = useState(false)

  const refresh = useCallback(async () => {
    const manager = getDeviceCapabilityManager()
    const s = await manager.getStatus()
    setStatus(s)
    setSettingsState(getDeviceSettings())
    setConsentState(getConsent())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function updateConsent(granted: boolean, localOnly: boolean) {
    setConsent(granted, localOnly)
    setConsentState(getConsent())
    setNote(granted ? { tone: 'ok', text: 'Device inference consent saved.' } : { tone: 'ok', text: 'Device inference consent withdrawn.' })
    void refresh()
  }

  async function updateMode(mode: AiDeviceMode) {
    setDeviceSettings({ mode })
    setSettingsState(getDeviceSettings())
    void refresh()
  }

  /** BEAN-managed download (checksum-verified artifact path). */
  async function downloadBeanModel(modelId: string) {
    setBusy(true)
    setConfirmDownloadId(null)
    setDownload({ modelId, progress: 0, note: 'starting download' })
    const controller = new AbortController()
    try {
      const registry = getDefaultModelRegistry()
      const result = await registry.requestDownload(modelId, {
        approval: true,
        signal: controller.signal,
        onProgress: (fraction, noteText) => setDownload({ modelId, progress: fraction, note: noteText ?? 'downloading' }),
      })
      if (result.ok) {
        setNote({ tone: 'ok', text: `${modelDisplayName(modelId)} installed and verified (${formatBytes(result.bytes)}).` })
      } else {
        setNote({ tone: 'err', text: `${modelDisplayName(modelId)}: ${result.reason}` })
      }
    } finally {
      setDownload(null)
      setBusy(false)
      void refresh()
    }
  }

  /** Runtime-managed preparation (WebLLM / Transformers.js fetch their own cache). */
  async function prepareRuntimeModel(modelId: string) {
    const manager = getDeviceCapabilityManager()
    setDownload({ modelId, progress: 0, note: 'preparing runtime' })
    try {
      if (modelId === CHAT_MODEL_ID) {
        await manager.ensureOnDeviceChatReady({ onProgress: (p) => setDownload({ modelId, progress: p.progress, note: p.note }) })
        setNote({ tone: 'ok', text: 'On-device chat model loaded into this browser (WebGPU).' })
      } else if (modelId === ASR_MODEL_ID) {
        await manager.ensureBrowserAsrReady({ onProgress: (p) => setDownload({ modelId, progress: p.progress, note: p.note }) })
        setNote({ tone: 'ok', text: 'On-device transcription model loaded into this browser.' })
      }
    } catch (error) {
      const err = error as { message?: string; recovery?: string }
      setNote({ tone: 'err', text: `${err.message ?? 'Preparation failed.'} ${err.recovery ?? ''}`.trim() })
    } finally {
      setDownload(null)
      void refresh()
    }
  }

  async function clearModel(modelId: string, runtime: string) {
    setBusy(true)
    try {
      const registry = getDefaultModelRegistry()
      await registry.deleteModel(modelId)
      if (runtime === 'web-llm') {
        // WebLLM stores weights in its own Cache Storage namespaces.
        if (typeof caches !== 'undefined') {
          for (const name of ['webllm/model', 'webllm/wasm', 'webllm/config']) {
            try {
              await caches.delete(name)
            } catch {
              /* namespace may not exist */
            }
          }
        }
        await getDeviceCapabilityManager().unloadOnDeviceChat()
      }
      setNote({ tone: 'ok', text: `${modelDisplayName(modelId)} cleared from this browser.` })
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  async function unloadChatModel() {
    setBusy(true)
    try {
      await getDeviceCapabilityManager().unloadOnDeviceChat()
      setNote({ tone: 'ok', text: 'The on-device chat model was unloaded (VRAM freed; cached weights kept).' })
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  async function pairEngine() {
    setEngineBusy(true)
    setNote(null)
    try {
      const port = Number(enginePort)
      const result = await getDeviceCapabilityManager().pairLocalEngine({
        host: engineHost,
        port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 8080,
        apiKey: engineKey,
      })
      if (result.ok) {
        setEngineKey('') // never keep the raw key in component state after pairing
        setNote({ tone: 'ok', text: `Paired with the local engine${result.model ? ` — model: ${result.model}` : ''}. The key is stored only in this browser.` })
      } else {
        setNote({ tone: 'err', text: `${result.error.message} ${result.error.recovery}`.trim() })
      }
    } finally {
      setEngineBusy(false)
      void refresh()
    }
  }

  async function verifyEngine() {
    setEngineBusy(true)
    try {
      const ok = await getDeviceCapabilityManager().verifyLocalEngine()
      setNote(ok ? { tone: 'ok', text: 'The local engine answered (models probe passed).' } : { tone: 'err', text: 'The local engine did not answer — is llama-server running with --api-key on that port?' })
    } finally {
      setEngineBusy(false)
      void refresh()
    }
  }

  function doUnpair() {
    unpairLocalEngine()
    setNote({ tone: 'ok', text: 'Local engine unpaired (the stored key was deleted).' })
    void refresh()
  }

  const caps = status?.capabilities ?? []

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-white/90">
          <Cpu className="h-5 w-5 text-[#d4af37]" /> AI Device
        </h1>
        <p className="mt-1 text-sm text-white/50">
          Your device processes your own AI requests. Every status below is measured on this device — never assumed.
        </p>
      </div>

      {note ? (
        <div className={cn('rounded-lg border px-4 py-3 text-sm', note.tone === 'ok' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200')}>
          {note.text}
        </div>
      ) : null}

      {/* Device facts */}
      <section className="rounded-xl border border-[rgba(212,175,55,0.15)] bg-black/30 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/85">This device</h2>
          <Button size="sm" variant="outline" onClick={() => void refresh()} className="h-7 border-white/15 text-white/60">
            <RefreshCw className="h-3.5 w-3.5" /> Re-measure
          </Button>
        </div>
        {status ? (
          <div className="grid grid-cols-2 gap-3 text-xs text-white/65 sm:grid-cols-3">
            <div><span className="text-white/40">Compute tier:</span> {status.tierLabel}</div>
            <div><span className="text-white/40">WebGPU:</span> {status.webgpu.adapterAvailable ? 'adapter available' : status.webgpu.supported ? 'API present, no adapter' : 'not supported'}</div>
            <div><span className="text-white/40">WebAssembly:</span> {status.wasm.supported ? `supported${status.wasm.simd === true ? ' + SIMD' : ''}` : 'not supported'}</div>
            <div><span className="text-white/40">Workers:</span> {status.workers ? 'available' : 'unavailable'}</div>
            <div><span className="text-white/40">Browser GPU chat runtime:</span> {status.runtimes.webLlm ? 'available' : 'unavailable'}</div>
            <div><span className="text-white/40">Browser ML runtime:</span> {status.runtimes.transformersJs ? 'available' : 'unavailable'}</div>
            <div><span className="text-white/40">Browser vision runtime:</span> {status.runtimes.ortWeb ? 'available' : 'unavailable'}</div>
            <div title="Policy estimate from the browser's coarse memory bucket — browsers never expose exact RAM.">
              <span className="text-white/40">Model memory budget:</span> ~{status.memoryBudgetMb ?? '—'} MB (estimate)
            </div>
            <div title="The on-device model currently loaded into this browser's memory."><span className="text-white/40">Loaded model:</span> {status.activeHeavyModel ? modelDisplayName(status.activeHeavyModel) : 'none'}</div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-white/50"><Loader2 className="h-4 w-4 animate-spin" /> Measuring device capabilities…</div>
        )}
      </section>

      {/* Consent */}
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white/85"><ShieldCheck className="h-4 w-4 text-[#d4af37]" /> Consent</h2>
        <div className="space-y-3 text-sm">
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="text-white/85">Run AI on this device</span>
              <span className="block text-xs text-white/45">Required once before any browser/local inference. Off = only server lanes run.</span>
            </span>
            <Switch checked={consentState?.granted === true} onCheckedChange={(v) => void updateConsent(v, consentState?.localOnly === true)} />
          </label>
          <label className="flex items-center justify-between gap-4">
            <span>
              <span className="text-white/85">Local-only mode</span>
              <span className="block text-xs text-white/45">Device execution never falls back to the server, even on failure.</span>
            </span>
            <Switch checked={consentState?.localOnly === true} onCheckedChange={(v) => void updateConsent(consentState?.granted === true, v)} />
          </label>
        </div>
      </section>

      {/* Mode */}
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h2 className="mb-3 text-sm font-semibold text-white/85">Compute mode</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => void updateMode(m.id)}
              className={cn(
                'rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                settings.mode === m.id ? 'border-[rgba(212,175,55,0.5)] bg-[rgba(212,175,55,0.08)] text-[#f0c75e]' : 'border-white/10 text-white/70 hover:bg-white/5',
              )}
            >
              <div className="font-medium">{m.label}</div>
              <div className="mt-0.5 text-[11px] text-white/40">{m.hint}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Capabilities */}
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h2 className="mb-3 text-sm font-semibold text-white/85">AI capabilities on this device</h2>
        <div className="space-y-2">
          {caps.map((c) => (
            <div key={c.capability} className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-white/80">{c.capability}</span>
                <span className={cn('rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide', STATUS_STYLES[c.status])}>{c.status.replace(/-/g, ' ')}</span>
              </div>
              {c.reason ? <div className="mt-1 text-xs leading-relaxed text-white/45">{c.reason}</div> : null}
              <div className="mt-1 text-[10px] text-white/30">{AI_CAPABILITY_STATUS_EXPLANATIONS[c.status]}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Models */}
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white/85"><HardDriveDownload className="h-4 w-4 text-[#d4af37]" /> Models</h2>
        <p className="mb-3 text-xs text-white/45">Downloads never start automatically. The real size is shown before you approve; checksums/revision pins are recorded per model.</p>
        <div className="space-y-3">
          {status?.models.map((m) => {
            const isDownloading = download?.modelId === m.id
            return (
              <div key={m.id} className="rounded-lg border border-white/8 bg-white/[0.02] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm text-white/85">
                      {m.displayName}
                      {m.installed ? <Badge className="border-emerald-500/40 bg-emerald-500/10 text-emerald-300" variant="outline">installed</Badge> : null}
                      {!m.runtimeAvailable ? <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-300">runtime unavailable</Badge> : null}
                    </div>
                    <div className="mt-1 text-[11px] text-white/45">
                      {m.runtimeLabel} · {formatBytes(m.sizeBytes)}{m.sizeUnverified ? ' (unverified)' : ''} · {m.licenseName} · {m.integrity === 'pinned-artifact-sha256' ? 'SHA-256-pinned artifact' : 'revision-pinned artifact'}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {isDownloading ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-[#f0c75e]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {download?.progress !== null && download?.progress !== undefined ? `${Math.round(download.progress * 100)}%` : download?.note}
                      </span>
                    ) : m.downloadPath === 'runtime-managed-cache' ? (
                      <Button size="sm" variant="outline" disabled={!m.runtimeAvailable || m.enabled !== true || busy} onClick={() => setConfirmDownloadId(m.id)} className="h-7 border-white/15 text-white/70">
                        <HardDriveDownload className="h-3.5 w-3.5" /> {m.installed ? 'Re-prepare' : 'Prepare'}
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled={!m.runtimeAvailable || m.enabled !== true || busy} onClick={() => setConfirmDownloadId(m.id)} className="h-7 border-white/15 text-white/70">
                        <HardDriveDownload className="h-3.5 w-3.5" /> Download
                      </Button>
                    )}
                    {m.runtime === 'web-llm' && status.activeHeavyModel === m.id ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void unloadChatModel()} className="h-7 border-white/15 text-white/70">
                        <CircleStop className="h-3.5 w-3.5" /> Unload
                      </Button>
                    ) : null}
                    {m.downloadPath === 'bean-managed-cache' && m.installed ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void clearModel(m.id, m.runtime)} className="h-7 border-white/15 text-white/70">
                        <Trash2 className="h-3.5 w-3.5" /> Clear
                      </Button>
                    ) : null}
                    {m.runtime === 'web-llm' ? (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void clearModel(m.id, m.runtime)} className="h-7 border-white/15 text-white/70">
                        <Trash2 className="h-3.5 w-3.5" /> Clear cache
                      </Button>
                    ) : null}
                  </div>
                </div>
                {m.limitations.length > 0 ? (
                  <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] leading-relaxed text-white/40">
                    {m.limitations.map((l) => <li key={l}>{l}</li>)}
                  </ul>
                ) : null}
                {confirmDownloadId === m.id ? (
                  <div className="mt-2 rounded-lg border border-[rgba(212,175,55,0.35)] bg-[rgba(212,175,55,0.06)] p-3 text-xs text-white/75">
                    Download <span className="text-[#f0c75e]">{formatBytes(m.sizeBytes)}</span> for <span className="text-[#f0c75e]">{m.displayName}</span> ({m.licenseName})?
                    {m.downloadPath === 'runtime-managed-cache' ? ' The weights are fetched by the browser runtime from the pinned upstream revision into its own cache.' : ' The bytes are verified against the pinned SHA-256 before install.'}
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" onClick={() => void (m.downloadPath === 'runtime-managed-cache' ? prepareRuntimeModel(m.id) : downloadBeanModel(m.id))} className="h-7 bg-[#d4af37] text-black hover:bg-[#e6c25a]">
                        Confirm download
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmDownloadId(null)} className="h-7 border-white/20 text-white/70">Cancel</Button>
                    </div>
                  </div>
                ) : null}
                {isDownloading && download?.progress != null ? (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div className="h-full rounded-full bg-[#d4af37] transition-all" style={{ width: `${Math.round(download.progress * 100)}%` }} />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>

      {/* Local desktop engine */}
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white/85"><Laptop className="h-4 w-4 text-[#d4af37]" /> Local desktop engine (optional)</h2>
        <p className="mb-3 text-xs leading-relaxed text-white/45">
          Pair a llama.cpp <code className="text-white/60">llama-server</code> running on THIS computer. Loopback only;
          the pairing key is stored in this browser and sent only to the engine — never to BEAN. Start it like:
          <code className="ml-1 text-white/60">llama-server -m model.gguf --host 127.0.0.1 --port 8080 --api-key &lt;your-secret&gt;</code>
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-36">
            <Label className="text-[11px] text-white/50">Host</Label>
            <select
              value={engineHost}
              onChange={(e) => setEngineHost(e.target.value === 'localhost' ? 'localhost' : '127.0.0.1')}
              className="mt-1 h-9 w-full rounded-md border border-white/15 bg-black/40 px-2 text-sm text-white/80"
            >
              <option value="127.0.0.1">127.0.0.1</option>
              <option value="localhost">localhost</option>
            </select>
          </div>
          <div className="w-24">
            <Label className="text-[11px] text-white/50">Port</Label>
            <Input value={enginePort} onChange={(e) => setEnginePort(e.target.value)} className="mt-1 border-white/15 bg-black/40 text-white/80" inputMode="numeric" />
          </div>
          <div className="min-w-48 flex-1">
            <Label className="text-[11px] text-white/50">API key (llama-server --api-key)</Label>
            <Input type="password" value={engineKey} onChange={(e) => setEngineKey(e.target.value)} placeholder={settings.localEngine ? '•••••••• (stored)' : 'paste the engine API key'} className="mt-1 border-white/15 bg-black/40 text-white/80" />
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={engineBusy} onClick={() => void pairEngine()} className="h-9 bg-[#d4af37] text-black hover:bg-[#e6c25a]">
              {engineBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Pair
            </Button>
            {settings.localEngine ? (
              <>
                <Button size="sm" variant="outline" disabled={engineBusy} onClick={() => void verifyEngine()} className="h-9 border-white/15 text-white/70">
                  <RefreshCw className="h-4 w-4" /> Verify
                </Button>
                <Button size="sm" variant="outline" disabled={engineBusy} onClick={doUnpair} className="h-9 border-white/15 text-white/70">
                  <Trash2 className="h-4 w-4" /> Unpair
                </Button>
              </>
            ) : null}
          </div>
        </div>
        <div className="mt-3 text-xs text-white/55">
          Status: {status?.localEngine.paired ? 'paired' : 'not paired'}
          {status?.localEngine.reachable !== null && status?.localEngine.paired ? ` · ${status.localEngine.reachable ? 'reachable' : 'unreachable (last probe)'}` : ''}
          {status?.localEngine.reportedModel ? ` · model: ${status.localEngine.reportedModel}` : ''}
        </div>
      </section>

      {/* Privacy summary */}
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/85"><Info className="h-4 w-4 text-[#d4af37]" /> Privacy</h2>
        <ul className="list-inside list-disc space-y-1 text-xs leading-relaxed text-white/55">
          <li>On-device inference processes YOUR requests on YOUR device. Your prompts and files in this mode are not uploaded to BEAN or anyone else.</li>
          <li>No visitor&apos;s device ever processes another visitor&apos;s job — there is no shared/distributed compute path, and background compute stops when consent is off.</li>
          <li>Model weights are stored in your browser&apos;s cache only; clearing them above deletes every byte. Nothing is sent back to BEAN about your models except an optional, sanitized capability report (only with consent).</li>
          <li>Server lanes still follow BEAN&apos;s existing contracts: provider credentials stay server-side; prompts to server models are processed under the provider&apos;s terms.</li>
          <li>The local desktop engine talks only to loopback on your machine. Other websites cannot use your engine while an API key is set.</li>
        </ul>
      </section>

      <div className="flex items-center gap-2 text-[10px] text-white/30">
        <Globe className="h-3 w-3" /> Server lanes remain available regardless of these settings ·
        <Server className="h-3 w-3" /> Background jobs keep running server-side even if this tab closes
      </div>
    </div>
  )
}
