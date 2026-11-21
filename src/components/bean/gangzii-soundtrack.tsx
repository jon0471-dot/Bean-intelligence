'use client'

/**
 * BEAN Intelligence — GANGZII Soundtrack Studio (M27).
 *
 * Real audio production on the GANGZII audio-production API:
 *  - audio library: user-uploaded music / SFX with license + attribution
 *    metadata (BEAN bundles NO third-party media — every asset's rights are
 *    recorded per asset and travel into receipts);
 *  - production: trim / fade / volume / duck / EQ / compress / limit /
 *    one-pass loudness normalization on real audio, with EBUR128 loudness
 *    measured on every result;
 *  - honesty rules surfaced in the UI: a transcoded track is NEVER labeled
 *    "mastered"; measured loudness is displayed next to the target.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  Loader2,
  Music,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  XCircle,
  CheckCircle2,
} from 'lucide-react'
import { beanFetch, EmptyState, GoldBadge, Spinner } from '@/components/bean/shared'

interface AssetView {
  id: string
  displayName: string
  kind: string
  container: string
  bytes: number
  durationMs: number | null
  license: string | null
  attribution: string | null
  createdAt: string
  audioUrl: string | null
}

interface ProductionJobView {
  id: string
  status: string
  progress: number
  errorCode: string | null
  errorMessage: string | null
  result: {
    audioUrl?: string
    loudness?: { integratedLufs: number | null; truePeakDbtp: number | null }
    masterLabel?: string
    durationSec?: number | null
    operations?: string[]
    warnings?: string[]
    ducking?: Array<{ regions: Array<{ startSec: number; endSec: number }>; config: { duckTo: number; attackMs: number; releaseMs: number; curve: string; minMusicLevel: number } }>
  } | null
  queuedAt: string
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

export function GangziiSoundtrack() {
  const [assets, setAssets] = useState<AssetView[]>([])
  const [jobs, setJobs] = useState<ProductionJobView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // upload form
  const [file, setFile] = useState<File | null>(null)
  const [kind, setKind] = useState<'music' | 'sfx' | 'voiceover-upload'>('music')
  const [license, setLicense] = useState('')
  const [attribution, setAttribution] = useState('')
  const [uploading, setUploading] = useState(false)

  // production form
  const [sourceAssetId, setSourceAssetId] = useState<string>('')
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [fadeIn, setFadeIn] = useState(0)
  const [fadeOut, setFadeOut] = useState(0)
  const [gain, setGain] = useState(1)
  const [duckMode, setDuckMode] = useState<'none' | 'static' | 'dynamic'>('none')
  // M28 Priority C: dynamic ducking controls (deterministic automation from
  // measured narration regions — the plan is recorded in the result).
  const [duckRegions, setDuckRegions] = useState('')
  const [duckDepth, setDuckDepth] = useState(0.35)
  const [duckAttackMs, setDuckAttackMs] = useState(150)
  const [duckReleaseMs, setDuckReleaseMs] = useState(400)
  const [duckCurve, setDuckCurve] = useState<'cosine' | 'linear'>('cosine')
  const [loudnessTarget, setLoudnessTarget] = useState<number | null>(null)
  const [outputFormat, setOutputFormat] = useState<'wav' | 'mp3' | 'm4a'>('wav')
  const [producing, setProducing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [lib, prod] = await Promise.all([
        beanFetch<{ assets: AssetView[] }>('/api/gangzii/assets'),
        beanFetch<{ jobs: ProductionJobView[] }>('/api/gangzii/produce'),
      ])
      setAssets(lib.assets)
      setJobs(prod.jobs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the soundtrack studio.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const anyActive = jobs.some((j) => ['queued', 'running'].includes(j.status))
  useEffect(() => {
    if (!anyActive) return
    const t = setInterval(() => void load(), 3000)
    return () => clearInterval(t)
  }, [anyActive, load])

  const upload = async () => {
    setError(null)
    if (!file) {
      setError('Choose an audio file first (music, SFX or voiceover upload).')
      return
    }
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('kind', kind)
      if (license.trim()) form.append('license', license.trim())
      if (attribution.trim()) form.append('attribution', attribution.trim())
      const res = await fetch('/api/gangzii/assets', { method: 'POST', body: form })
      const body = (await res.json()) as { ok?: boolean; error?: { message?: string } }
      if (!res.ok || !body.ok) {
        throw new Error(body.error?.message ?? 'The upload was rejected.')
      }
      setNotice('Asset stored with its license metadata. BEAN never bundles third-party media — your attribution travels with the asset into receipts.')
      setFile(null)
      setLicense('')
      setAttribution('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The upload failed.')
    } finally {
      setUploading(false)
    }
  }

  const produce = async () => {
    setError(null)
    if (!sourceAssetId) {
      setError('Pick a source asset to process.')
      return
    }
    const operations: Array<{ op: string; params?: Record<string, unknown> }> = []
    if (trimStart > 0 || trimEnd > 0) operations.push({ op: 'trim', params: { startSec: trimStart, endSec: trimEnd } })
    if (fadeIn > 0) operations.push({ op: 'fade-in', params: { durationSec: fadeIn } })
    if (fadeOut > 0) operations.push({ op: 'fade-out', params: { durationSec: fadeOut } })
    if (gain !== 1) operations.push({ op: 'volume', params: { gain } })
    if (duckMode === 'static') operations.push({ op: 'duck', params: { duckTo: 0.35 } })
    if (duckMode === 'dynamic') {
      // Regions are typed "start-end, start-end" in seconds and parsed
      // client-side for preview; the server re-bounds everything anyway.
      const regions = duckRegions
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const [a, b] = part.split('-').map((v) => Number(v.trim()))
          return { startSec: a, endSec: b }
        })
      if (regions.length === 0 || regions.some((r) => !Number.isFinite(r.startSec) || !Number.isFinite(r.endSec))) {
        setError('Dynamic ducking needs narration regions like "1.5-4.5, 8.0-10.0" (seconds).')
        return
      }
      operations.push({
        op: 'duck-dynamic',
        params: { regions, duckTo: duckDepth, attackMs: duckAttackMs, releaseMs: duckReleaseMs, curve: duckCurve },
      })
    }
    if (loudnessTarget !== null) operations.push({ op: 'normalize-loudness', params: { targetLufs: loudnessTarget } })
    if (operations.length === 0) {
      setError('Pick at least one operation (trim, fade, volume, duck or loudness).')
      return
    }
    setProducing(true)
    try {
      const res = await beanFetch<{ jobId: string }>('/api/gangzii/produce', {
        method: 'POST',
        body: JSON.stringify({ sourceAssetId, operations, output: { format: outputFormat, channels: outputFormat === 'wav' ? 2 : 2 } }),
      })
      setNotice(`Production job queued (${res.jobId.slice(0, 8)}…). The result is ffprobe-validated and its loudness measured before it is labeled.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not queue the production job.')
    } finally {
      setProducing(false)
    }
  }

  const deleteAsset = async (id: string) => {
    try {
      await beanFetch(`/api/gangzii/assets?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the asset.')
    }
  }

  const inputCls =
    'w-full rounded-md border border-[rgba(212,175,55,0.25)] bg-black/40 px-3 py-2 text-sm text-[#f5e7c1] placeholder:text-[#8a7326] focus:border-[rgba(212,175,55,0.6)] focus:outline-none'
  const btnCls =
    'inline-flex items-center gap-1.5 rounded-md border border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.12)] px-3 py-1.5 text-xs font-medium text-[#f0c75e] transition hover:bg-[rgba(212,175,55,0.2)] disabled:cursor-not-allowed disabled:opacity-40'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.08)] px-3 py-2 text-xs text-[#f0c75e]">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Upload */}
      <div className="rounded-xl border border-[rgba(212,175,55,0.2)] bg-black/30 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[#f5e7c1]">
          <UploadCloud className="h-4 w-4 text-[#d4af37]" />
          Audio library — your assets, your licenses
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-xs text-[#bfa860] file:mr-2 file:rounded-md file:border-0 file:bg-[rgba(212,175,55,0.15)] file:px-3 file:py-1.5 file:text-xs file:text-[#f0c75e]" />
            <select className={inputCls} value={kind} onChange={(e) => setKind(e.target.value as 'music' | 'sfx' | 'voiceover-upload')}>
              <option value="music">Music bed</option>
              <option value="sfx">Sound effect</option>
              <option value="voiceover-upload">Voiceover upload (pre-recorded)</option>
            </select>
          </div>
          <div className="space-y-2">
            <input className={inputCls} placeholder="License (e.g. CC-BY 4.0, Owned, Licensed — Epidemic Sound)" value={license} onChange={(e) => setLicense(e.target.value)} />
            <input className={inputCls} placeholder="Attribution (who made it / where it is from)" value={attribution} onChange={(e) => setAttribution(e.target.value)} />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <button className={btnCls} onClick={upload} disabled={uploading || !file}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
            Upload (≤25 MB, WAV/MP3/OGG/FLAC/M4A)
          </button>
          <button className={btnCls} onClick={() => void load()} aria-label="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Library */}
      {assets.length === 0 ? (
        <EmptyState icon={<Music className="h-6 w-6" />} title="No audio assets yet" hint="Upload music beds and sound effects you have the rights to use — GANGZII records license and attribution metadata with every asset." />
      ) : (
        <div className="rounded-xl border border-[rgba(212,175,55,0.2)] bg-black/30">
          <div className="border-b border-[rgba(212,175,55,0.12)] px-4 py-3 text-sm font-medium text-[#f5e7c1]">Library ({assets.length})</div>
          <div className="divide-y divide-[rgba(212,175,55,0.08)]">
            {assets.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-[#f5e7c1]">{a.displayName}</span>
                    <GoldBadge tone={a.kind === 'music' ? 'gold' : 'neutral'}>{a.kind}</GoldBadge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[#8a7326]">
                    {a.container} · {fmtBytes(a.bytes)}
                    {a.license ? ` · license: ${a.license}` : ' · license: not stated (user-provided)'}
                    {a.attribution ? ` · by ${a.attribution}` : ''}
                  </p>
                </div>
                {a.audioUrl && <audio controls preload="none" src={a.audioUrl} className="h-8 w-56 max-w-full" />}
                <button className={btnCls} onClick={() => void deleteAsset(a.id)} aria-label="Delete asset">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Production */}
      <div className="rounded-xl border border-[rgba(212,175,55,0.2)] bg-black/30 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[#f5e7c1]">
          <SlidersHorizontal className="h-4 w-4 text-[#d4af37]" />
          Production — real local processing with measured loudness
        </div>
        {assets.length === 0 ? (
          <p className="text-xs text-[#8a7326]">Upload an asset first — production always starts from a real stored asset.</p>
        ) : (
          <div className="space-y-3">
            <select className={inputCls} value={sourceAssetId} onChange={(e) => setSourceAssetId(e.target.value)}>
              <option value="">Choose source asset…</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName} ({a.kind})
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <label className="text-xs text-[#bfa860]">
                Trim start (s)
                <input type="number" min={0} step={0.1} className={inputCls} value={trimStart || ''} onChange={(e) => setTrimStart(Number(e.target.value) || 0)} placeholder="0" />
              </label>
              <label className="text-xs text-[#bfa860]">
                Trim end (s, 0 = keep)
                <input type="number" min={0} step={0.1} className={inputCls} value={trimEnd || ''} onChange={(e) => setTrimEnd(Number(e.target.value) || 0)} placeholder="0" />
              </label>
              <label className="text-xs text-[#bfa860]">
                Fade-in (s)
                <input type="number" min={0} max={10} step={0.1} className={inputCls} value={fadeIn || ''} onChange={(e) => setFadeIn(Number(e.target.value) || 0)} placeholder="0" />
              </label>
              <label className="text-xs text-[#bfa860]">
                Fade-out (s)
                <input type="number" min={0} max={10} step={0.1} className={inputCls} value={fadeOut || ''} onChange={(e) => setFadeOut(Number(e.target.value) || 0)} placeholder="0" />
              </label>
              <label className="text-xs text-[#bfa860]">
                Volume (×{gain.toFixed(2)})
                <input type="range" min={0} max={2} step={0.05} value={gain} onChange={(e) => setGain(Number(e.target.value))} className="w-full accent-[#d4af37]" />
              </label>
              <label className="text-xs text-[#bfa860]">
                Output format
                <select className={inputCls} value={outputFormat} onChange={(e) => setOutputFormat(e.target.value as 'wav' | 'mp3' | 'm4a')}>
                  <option value="wav">WAV master</option>
                  <option value="mp3">MP3 delivery</option>
                  <option value="m4a">M4A (AAC for video)</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-[#bfa860]">
                <span>Ducking</span>
                <select
                  className={inputCls + ' w-44'}
                  value={duckMode}
                  onChange={(e) => setDuckMode(e.target.value as 'none' | 'static' | 'dynamic')}
                >
                  <option value="none">None</option>
                  <option value="static">Static (whole track −65%)</option>
                  <option value="dynamic">Dynamic (timeline-aware)</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-[#bfa860]">
                <input type="checkbox" checked={loudnessTarget !== null} onChange={(e) => setLoudnessTarget(e.target.checked ? -16 : null)} className="accent-[#d4af37]" />
                Loudness normalize (one-pass loudnorm → −16 LUFS / −1.5 dBTP)
              </label>
            </div>
            {duckMode === 'dynamic' && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <label className="text-xs text-[#bfa860] sm:col-span-3">
                  Narration regions (seconds, "start-end", comma-separated — from the narration timing panel)
                  <input
                    className={inputCls}
                    value={duckRegions}
                    onChange={(e) => setDuckRegions(e.target.value)}
                    placeholder="1.5-4.5, 8.0-10.0"
                  />
                </label>
                <label className="text-xs text-[#bfa860]">
                  Depth (bed level under speech)
                  <input type="number" min={0.05} max={1} step={0.05} className={inputCls} value={duckDepth} onChange={(e) => setDuckDepth(Number(e.target.value) || 0.35)} />
                </label>
                <label className="text-xs text-[#bfa860]">
                  Attack (ms)
                  <input type="number" min={0} max={2000} step={10} className={inputCls} value={duckAttackMs} onChange={(e) => setDuckAttackMs(Number(e.target.value) || 0)} />
                </label>
                <label className="text-xs text-[#bfa860]">
                  Release (ms)
                  <input type="number" min={0} max={2000} step={10} className={inputCls} value={duckReleaseMs} onChange={(e) => setDuckReleaseMs(Number(e.target.value) || 0)} />
                </label>
                <label className="text-xs text-[#bfa860]">
                  Curve
                  <select className={inputCls} value={duckCurve} onChange={(e) => setDuckCurve(e.target.value as 'cosine' | 'linear')}>
                    <option value="cosine">Cosine (smooth)</option>
                    <option value="linear">Linear</option>
                  </select>
                </label>
                <p className="text-[11px] text-[#8a7326] sm:col-span-3">
                  Deterministic timeline automation from the declared narration regions — not sidechain compression. The applied plan
                  (regions, depth, attack, release, sampled curve) is recorded with the result and in the Trust receipt.
                </p>
              </div>
            )}
            <button className={btnCls} onClick={produce} disabled={producing}>
              {producing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SlidersHorizontal className="h-3.5 w-3.5" />}
              Queue production job
            </button>
          </div>
        )}
      </div>

      {/* Production history */}
      {jobs.length > 0 && (
        <div className="rounded-xl border border-[rgba(212,175,55,0.2)] bg-black/30">
          <div className="border-b border-[rgba(212,175,55,0.12)] px-4 py-3 text-sm font-medium text-[#f5e7c1]">Production history</div>
          <div className="divide-y divide-[rgba(212,175,55,0.08)]">
            {jobs.map((j) => (
              <div key={j.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <GoldBadge tone={j.status === 'completed' ? 'green' : j.status === 'failed' ? 'red' : 'gold'}>{j.status}</GoldBadge>
                  <span className="text-xs text-[#8a7326]">{j.result?.operations?.join(', ') ?? '—'}</span>
                  {j.status === 'completed' && j.result?.loudness?.integratedLufs !== null && j.result?.loudness?.integratedLufs !== undefined && (
                    <span className="text-xs text-[#7dd87d]">
                      measured {j.result.loudness.integratedLufs} LUFS{typeof j.result.loudness.truePeakDbtp === 'number' ? ` / ${j.result.loudness.truePeakDbtp} dBTP` : ''}
                    </span>
                  )}
                  {j.result?.masterLabel && <span className="text-[11px] text-[#8a7326]">{j.result.masterLabel}</span>}
                  {j.result?.ducking && Array.isArray(j.result.ducking) && j.result.ducking.length > 0 && (
                    <span className="text-[11px] text-[#7dd87d]">
                      dynamic ducking: {j.result.ducking[0].regions?.length ?? 0} region(s), depth {j.result.ducking[0].config?.duckTo}, attack {j.result.ducking[0].config?.attackMs} ms
                    </span>
                  )}
                </div>
                {j.status === 'failed' && <p className="mt-1 text-xs text-red-300">{j.errorMessage}{j.errorCode ? ` (${j.errorCode})` : ''}</p>}
                {j.result?.warnings && j.result.warnings.length > 0 && (
                  <p className="mt-1 text-[11px] text-[#bfa860]">{j.result.warnings.join(' ')}</p>
                )}
                {j.status === 'completed' && j.result?.audioUrl && (
                  <audio controls preload="none" src={j.result.audioUrl} className="mt-2 h-9 w-full max-w-xl" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-[#8a7326]">
        Mastering honesty: a track is labeled mastered ONLY when a mastering operation (loudness normalization / compression / limiting) actually ran —
        measured loudness values are recorded with the result and shown here. A plain transcode is labeled processed-audio. No aesthetic quality claim is
        ever made by automation; listen before publishing.
      </p>
    </div>
  )
}
