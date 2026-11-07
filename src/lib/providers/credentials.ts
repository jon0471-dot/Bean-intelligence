/**
 * BEAN Intelligence — provider credential resolution (SERVER ONLY).
 *
 * ⚠️ Never import from client components. This module decides whether an
 * authorized provider's credentials are PRESENT — it never logs, returns or
 * transmits credential VALUES to anything except the server-side adapter
 * that uses them in an Authorization header.
 *
 * Resolution order for the openai-compatible fallback provider:
 *  1. 'admin-vault'      — an ACTIVE credential row in the encrypted
 *     provider-credential store (AES-256-GCM at rest; created/rotated/revoked
 *     by administrators in the gateway console — the brief's "admin-only
 *     provider configuration"). Presence = getActiveCredentialId() resolves.
 *  2. 'env-configured'   — operator-set environment variables
 *     (BEAN_PROVIDER_OPENAI_API_KEY + optional BASE_URL / MODEL) for
 *     deployments managed purely by runtime environment.
 *  3. 'not-configured'   — no credential source: the provider stays dormant
 *     and the routing layer reports the slot honestly.
 *
 * The z-ai gateway is 'platform-managed': the platform runtime provisions
 * its config file; presence is checked without reading values.
 */

import { readFileSync, existsSync } from 'node:fs'
import { getActiveCredentialId } from '@/lib/security/provider-credentials'

export type CredentialStatus = 'platform-managed' | 'admin-vault' | 'env-configured' | 'not-configured'

export interface CredentialResolution {
  providerId: string
  status: CredentialStatus
  /** True when the routing layer may attempt this provider. */
  present: boolean
  /** Human-safe source description (paths / env-var NAMES only). */
  source: string
  /** Human-safe note for admin UI / reports (never contains values). */
  detail: string
}

/** Platform-managed gateway config locations the SDK itself consults. */
const ZAI_CONFIG_PATHS = ['/etc/.z-ai-config', '.z-ai-config']

function platformGatewayPresent(): boolean {
  for (const p of ZAI_CONFIG_PATHS) {
    try {
      if (!existsSync(p)) continue
      const raw = readFileSync(p, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      // Presence check only — the values stay unread by this module.
      if (typeof parsed.apiKey === 'string' && parsed.apiKey.length > 0 && typeof parsed.baseUrl === 'string') {
        return true
      }
    } catch {
      // unreadable/malformed — keep checking other locations
    }
  }
  return false
}

export interface OpenAiCompatibleCredential {
  present: boolean
  /** Where the credential came from (audit/admin display). */
  origin: 'admin-vault' | 'env-configured'
  baseUrl: string
  apiKey: string
  model: string
  /** Encrypted-store credential id when origin is the admin vault. */
  credentialId: string | null
}

const ENV_SOURCE =
  'BEAN_PROVIDER_OPENAI_API_KEY (+ optional BEAN_PROVIDER_OPENAI_BASE_URL / BEAN_PROVIDER_OPENAI_MODEL)'

/**
 * Full runtime material for the fallback provider (SERVER ONLY — the apiKey
 * is meant exclusively for the adapter's Authorization header; it is never
 * logged, persisted or included in any client response).
 * Order: admin vault (encrypted DB credential) → env vars.
 */
export async function resolveOpenAiCompatibleRuntimeCredential(): Promise<OpenAiCompatibleCredential | null> {
  // 1. Admin-managed encrypted credential (active row in the vault).
  try {
    const id = await getActiveCredentialId('openai-compatible')
    if (id) {
      const model = process.env.BEAN_PROVIDER_OPENAI_MODEL?.trim() || 'gpt-4o-mini'
      // baseUrl: the credential row carries it (SSRF-validated at write AND
      // decrypt time); env BASE_URL can specialize the model per deployment
      // but never overrides an explicitly configured credential URL.
      return { present: true, origin: 'admin-vault', baseUrl: '', apiKey: '', model, credentialId: id }
    }
  } catch {
    // Vault unavailable (e.g. tests without the table) — fall through to env.
  }
  // 2. Environment-provisioned credential.
  const envKey = process.env.BEAN_PROVIDER_OPENAI_API_KEY
  if (typeof envKey === 'string' && envKey.trim().length > 0) {
    return {
      present: true,
      origin: 'env-configured',
      baseUrl: (process.env.BEAN_PROVIDER_OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
      apiKey: envKey.trim(),
      model: process.env.BEAN_PROVIDER_OPENAI_MODEL?.trim() || 'gpt-4o-mini',
      credentialId: null,
    }
  }
  return null
}

/**
 * Sync presence check for the ENV source only (registry evaluation at module
 * load; the DB vault is checked asynchronously at routing time).
 */
export function resolveOpenAiCompatibleCredential(): { present: boolean } {
  const k = process.env.BEAN_PROVIDER_OPENAI_API_KEY
  return { present: typeof k === 'string' && k.trim().length > 0 }
}

/** Resolve (never expose) the credential state for a known provider id. */
export async function resolveProviderCredentials(providerId: string): Promise<CredentialResolution> {
  switch (providerId) {
    case 'zai-gateway':
      if (platformGatewayPresent()) {
        return {
          providerId,
          status: 'platform-managed',
          present: true,
          source: ZAI_CONFIG_PATHS.join(' | '),
          detail: 'Authorized gateway credentials are provisioned by the platform runtime.',
        }
      }
      return {
        providerId,
        status: 'not-configured',
        present: false,
        source: ZAI_CONFIG_PATHS.join(' | '),
        detail: 'No platform gateway configuration found — chat/video/image/audio/search providers are dormant.',
      }
    case 'openai-compatible': {
      // Admin vault first (async), env second.
      try {
        const id = await getActiveCredentialId('openai-compatible')
        if (id) {
          return {
            providerId,
            status: 'admin-vault',
            present: true,
            source: 'encrypted provider-credential store (admin gateway console)',
            detail: 'An administrator configured an active encrypted credential — the fallback may serve when the primary provider fails an upstream-class check.',
          }
        }
      } catch {
        // Vault table unavailable — env path below decides.
      }
      if (resolveOpenAiCompatibleCredential().present) {
        return {
          providerId,
          status: 'env-configured',
          present: true,
          source: ENV_SOURCE,
          detail: 'Fallback chat provider configured via runtime environment by the operator.',
        }
      }
      return {
        providerId,
        status: 'not-configured',
        present: false,
        source: `admin gateway console | ${ENV_SOURCE}`,
        detail:
          'Prepared fallback awaiting credentials — an administrator can add an encrypted openai-compatible credential in the gateway console, or set the env vars. Dormant until then; no purchase is made automatically.',
      }
    }
    default:
      return {
        providerId,
        status: 'not-configured',
        present: false,
        source: '—',
        detail: 'Unknown provider id.',
      }
  }
}

/** Which provider id serves a given backend id (single source of truth). */
export function providerIdForBackend(backendId: string): string {
  if (backendId === 'bean-llm-openai-compatible') return 'openai-compatible'
  // Every current hosted backend (LLM, image, edit, video, code) rides the
  // platform-managed z-ai gateway.
  return 'zai-gateway'
}
