/**
 * BEAN Intelligence — CONTROLLED UPSTREAM MODEL DISCOVERY (M36-A, SERVER ONLY).
 *
 * Where a provider exposes its available models through a REAL API, this
 * module lists them with the operator's configured credential. Where it does
 * not, callers fall back to the verified operator-maintained catalogue (the
 * backend registry's `modelIdentity`) — nothing is ever invented.
 *
 * Policy (brief §4B / §5):
 *  - discovery is CREDENTIAL-GATED: without a configured credential the
 *    provider reports honestly that it cannot be queried;
 *  - discovery NEVER changes routing by itself — the result is a verified
 *    catalogue for operator/diagnostics surfaces; routing still resolves
 *    adapters through the backend registry;
 *  - results are cached briefly (5 min) to keep probe volume negligible;
 *  - values are never logged; failures are classified without secrets.
 */

import { resolveOpenAiCompatibleRuntimeCredential, resolveAnthropicRuntimeCredential } from './credentials'
import { decryptProviderCredential } from '@/lib/security/provider-credentials'
import { validateProviderBaseUrl } from '@/lib/security/url-guard'

export type DiscoveredBy = 'provider-api' | 'operator-catalogue'

export interface DiscoveredModel {
  /** Model identifier exactly as the provider's API reports it. */
  id: string
  /** Human display name when the provider reports one (often null). */
  displayName: string | null
}

export interface DiscoveryResult {
  providerId: 'openai-compatible' | 'anthropic'
  /** How the list was obtained. */
  source: DiscoveredBy
  /** 'provider-api' results carry the endpoint that answered. */
  queriedUrl: string | null
  models: DiscoveredModel[]
  checkedAt: string
  /** Non-fatal note (e.g. dormant slot, partial list). */
  note: string | null
}

const DISCOVERY_TTL_MS = 5 * 60_000

interface CacheEntry {
  result: DiscoveryResult
  at: number
}

const cache = new Map<string, CacheEntry>()

function readCache(key: string): DiscoveryResult | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > DISCOVERY_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.result
}

function writeCache(key: string, result: DiscoveryResult): void {
  cache.set(key, { result, at: Date.now() })
}

/** Test seam. */
export function resetDiscoveryCacheForTests(): void {
  cache.clear()
}

async function credFromVaultOrEnv(
  vaultProviderId: 'openai-compatible' | 'anthropic',
  envResolved: { origin: 'admin-vault' | 'env-configured'; baseUrl: string; apiKey: string; credentialId: string | null },
): Promise<{ apiKey: string; baseUrl: string } | null> {
  if (envResolved.origin === 'admin-vault' && envResolved.credentialId) {
    const { payload, baseUrl } = await decryptProviderCredential(envResolved.credentialId)
    if (!baseUrl) return null
    return { apiKey: payload.apiKey, baseUrl: baseUrl.replace(/\/+$/, '') }
  }
  const guard = validateProviderBaseUrl(envResolved.baseUrl)
  if (!guard.ok) return null
  return { apiKey: envResolved.apiKey, baseUrl: envResolved.baseUrl.replace(/\/+$/, '') }
}

/** One authenticated GET against a provider's models endpoint. */
async function fetchModelList(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<{ ok: true; models: DiscoveredModel[] } | { ok: false; note: string }> {
  let res: Response
  try {
    res = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, note: `models endpoint unreachable: ${msg.slice(0, 160)}` }
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return {
      ok: false,
      note:
        res.status === 429
          ? 'models endpoint rate-limited (HTTP 429) — try again later'
          : `models endpoint returned HTTP ${res.status}: ${body.slice(0, 120)}`,
    }
  }
  let json: unknown
  try {
    json = await res.json()
  } catch {
    return { ok: false, note: 'models endpoint returned a non-JSON body' }
  }
  // OpenAI shape: { data: [{ id, ... }] }; Anthropic shape: { data: [{ id, display_name, ... }] }
  const data = (json as { data?: unknown })?.data
  if (!Array.isArray(data)) return { ok: false, note: 'models endpoint response missing a data[] array' }
  const models: DiscoveredModel[] = []
  for (const entry of data) {
    if (!entry || typeof entry !== 'object') continue
    const rec = entry as Record<string, unknown>
    if (typeof rec.id !== 'string' || rec.id.length === 0) continue
    models.push({
      id: rec.id,
      displayName: typeof rec.display_name === 'string' ? rec.display_name : typeof rec.name === 'string' ? rec.name : null,
    })
  }
  return { ok: true, models }
}

/**
 * Discover models for the operator-configured OpenAI-compatible slot.
 * Dormant slot → operator-catalogue fallback (the configured model id only).
 */
export async function discoverOpenAiCompatibleModels(timeoutMs = 10_000): Promise<DiscoveryResult> {
  const cached = readCache('openai-compatible')
  if (cached) return cached
  const envResolved = await resolveOpenAiCompatibleRuntimeCredential()
  const base: DiscoveryResult = {
    providerId: 'openai-compatible',
    source: 'operator-catalogue',
    queriedUrl: null,
    models: [],
    checkedAt: new Date().toISOString(),
    note: null,
  }
  if (!envResolved) {
    base.note = 'slot dormant: no credential configured, so the endpoint cannot be queried'
    return base
  }
  const cred = await credFromVaultOrEnv('openai-compatible', envResolved)
  if (!cred) {
    base.note = 'slot credential present but its base URL failed the SSRF policy — endpoint not queried'
    return base
  }
  const result = await fetchModelList(`${cred.baseUrl}/models`, { Authorization: `Bearer ${cred.apiKey}` }, timeoutMs)
  if (result.ok) {
    base.source = 'provider-api'
    base.queriedUrl = cred.baseUrl
    base.models = result.models
    base.note = null
  } else {
    base.note = result.note
  }
  writeCache('openai-compatible', base)
  return base
}

/**
 * Discover models for the operator-configured Anthropic Messages slot.
 * Official endpoint: GET {baseUrl}/v1/models with x-api-key + version header.
 */
export async function discoverAnthropicModels(timeoutMs = 10_000): Promise<DiscoveryResult> {
  const cached = readCache('anthropic')
  if (cached) return cached
  const envResolved = await resolveAnthropicRuntimeCredential()
  const base: DiscoveryResult = {
    providerId: 'anthropic',
    source: 'operator-catalogue',
    queriedUrl: null,
    models: [],
    checkedAt: new Date().toISOString(),
    note: null,
  }
  if (!envResolved) {
    base.note = 'slot dormant: no credential configured, so the endpoint cannot be queried'
    return base
  }
  const cred = await credFromVaultOrEnv('anthropic', envResolved)
  if (!cred) {
    base.note = 'slot credential present but its base URL failed the SSRF policy — endpoint not queried'
    return base
  }
  const result = await fetchModelList(
    `${cred.baseUrl}/v1/models`,
    { 'x-api-key': cred.apiKey, 'anthropic-version': '2023-06-01' },
    timeoutMs,
  )
  if (result.ok) {
    base.source = 'provider-api'
    base.queriedUrl = cred.baseUrl
    base.models = result.models
    base.note = null
  } else {
    base.note = result.note
  }
  writeCache('anthropic', base)
  return base
}

/**
 * Discovery for every provider that supports it (admin diagnostics surface).
 * Providers without a queryable list (z-ai platform gateway, llama.cpp lanes)
 * resolve to the operator-maintained catalogue and are listed with
 * `source: 'operator-catalogue'` and a note.
 */
export async function discoverAllProviderModels(): Promise<DiscoveryResult[]> {
  const [openai, anthropic] = await Promise.all([discoverOpenAiCompatibleModels(), discoverAnthropicModels()])
  return [openai, anthropic]
}
