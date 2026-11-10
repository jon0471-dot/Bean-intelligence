/**
 * BEAN Intelligence — provider credential management (secret type A).
 *
 * EXTERNAL AI PROVIDER credentials: the admin-supplied API keys that let the
 * unified gateway call third-party inference providers. Stored AES-256-GCM
 * encrypted (see crypto.ts); the master key lives in the environment, never
 * in the database.
 *
 * Rules enforced here (work order Part 3):
 *  - every write and read path is admin-gated by the CALLING route;
 *  - the plaintext is returned by exactly ONE function (decryptForUse) which
 *    is called ONLY by server-side gateway adapters at request time;
 *  - list/read paths return masked views (maskedHint, no ciphertext either —
 *    the ciphertext itself is internal state, never shipped to clients);
 *  - revocation is immediate and authoritative for adapter resolution;
 *  - master-key rotation re-encrypts every active row in one transaction-ish
 *    sweep (best-effort per row, failures reported honestly, never silent);
 *  - no credential material is ever logged (logger contract) and errors
 *    surfaced to clients carry zero key fragments.
 */
import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import {
  encryptSecret,
  decryptSecret,
  rotateSecretEnvelope,
  maskedHint,
  isCredentialEncryptionConfigured,
  CredentialsNotConfiguredError,
  DecryptionFailedError,
} from './crypto'
import { validateProviderBaseUrl } from './url-guard'

/** Registered external provider kinds the gateway genuinely implements. */
export const REGISTERED_PROVIDERS = ['openai-compatible'] as const
export type RegisteredProvider = (typeof REGISTERED_PROVIDERS)[number]

/** The decrypted payload shape inside the encrypted envelope. */
export interface ProviderSecretPayload {
  apiKey: string
}

export interface CreateCredentialInput {
  adminId: string
  provider: string
  label: string
  apiKey: string
  baseUrl?: string | null
}

export interface CredentialView {
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

export function isProviderRegistered(provider: string): boolean {
  return (REGISTERED_PROVIDERS as readonly string[]).includes(provider)
}

export async function createProviderCredential(input: CreateCredentialInput): Promise<CredentialView> {
  if (!isProviderRegistered(input.provider)) {
    throw new BeanApiError(
      'VALIDATION_ERROR',
      `Unsupported provider "${input.provider}". Supported: ${REGISTERED_PROVIDERS.join(', ')}.`,
    )
  }
  // W6 SEC-W6-01 (SSRF): the base URL drives a server-side fetch WITH the
  // credential attached — validate BEFORE anything else (also before the
  // master-key gate, so a configuration mistake surfaces as a typed 400
  // instead of being masked by the 503 fail-closed state).
  if (input.baseUrl?.trim()) {
    const guard = validateProviderBaseUrl(input.baseUrl)
    if (!guard.ok) throw new BeanApiError('VALIDATION_ERROR', `Provider base URL rejected: ${guard.reason}`)
  }
  if (!isCredentialEncryptionConfigured()) {
    throw new CredentialsNotConfiguredError()
  }
  const apiKey = input.apiKey.trim()
  if (apiKey.length < 8) {
    throw new BeanApiError('VALIDATION_ERROR', 'The provider API key looks too short to be valid.')
  }
  const label = input.label.trim().slice(0, 100)
  if (!label) throw new BeanApiError('VALIDATION_ERROR', 'A credential label is required.')
  const row = await db.providerCredential.create({
    data: {
      provider: input.provider,
      label,
      encrypted: encryptSecret(JSON.stringify({ apiKey } satisfies ProviderSecretPayload)),
      maskedHint: maskedHint(apiKey),
      baseUrl: input.baseUrl?.trim() || null,
      createdBy: input.adminId,
    },
  })
  return toView(row)
}

/** Masked view — the ONLY shape credential endpoints may return. */
function toView(row: {
  id: string
  provider: string
  label: string
  maskedHint: string
  baseUrl: string | null
  status: string
  createdAt: Date
  updatedAt: Date
  lastUsedAt: Date | null
}): CredentialView {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    maskedHint: row.maskedHint,
    baseUrl: row.baseUrl,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  }
}

export async function listProviderCredentials(): Promise<CredentialView[]> {
  const rows = await db.providerCredential.findMany({ orderBy: { createdAt: 'desc' } })
  return rows.map(toView)
}

/**
 * Replace a credential's secret (authorized replacement — never read back).
 * Optionally updates the label/baseUrl in the same call.
 */
export async function replaceProviderCredential(
  credentialId: string,
  input: { apiKey: string; label?: string; baseUrl?: string | null },
): Promise<CredentialView> {
  // W6 SEC-W6-01: URL validation first (see createProviderCredential).
  if (input.baseUrl?.trim()) {
    const guard = validateProviderBaseUrl(input.baseUrl)
    if (!guard.ok) throw new BeanApiError('VALIDATION_ERROR', `Provider base URL rejected: ${guard.reason}`)
  }
  if (!isCredentialEncryptionConfigured()) throw new CredentialsNotConfiguredError()
  const row = await db.providerCredential.findUnique({ where: { id: credentialId } })
  if (!row || row.status !== 'active') {
    throw new BeanApiError('NOT_FOUND', 'Provider credential not found.')
  }
  const apiKey = input.apiKey.trim()
  if (apiKey.length < 8) {
    throw new BeanApiError('VALIDATION_ERROR', 'The provider API key looks too short to be valid.')
  }
  const updated = await db.providerCredential.update({
    where: { id: credentialId },
    data: {
      encrypted: encryptSecret(JSON.stringify({ apiKey } satisfies ProviderSecretPayload)),
      maskedHint: maskedHint(apiKey),
      ...(input.label !== undefined ? { label: input.label.trim().slice(0, 100) || row.label } : {}),
      ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl?.trim() || null } : {}),
    },
  })
  return toView(updated)
}

export async function revokeProviderCredential(credentialId: string): Promise<void> {
  const row = await db.providerCredential.findUnique({ where: { id: credentialId } })
  if (!row) throw new BeanApiError('NOT_FOUND', 'Provider credential not found.')
  await db.providerCredential.update({
    where: { id: credentialId },
    data: { status: 'revoked' },
  })
}

/**
 * THE only decryption path. Called by the gateway adapter at request time,
 * server-side. Marks lastUsedAt best-effort (usage tracking must not break
 * an inference call). Revoked rows are rejected before decryption.
 */
export async function decryptProviderCredential(
  credentialId: string,
): Promise<{ payload: ProviderSecretPayload; baseUrl: string | null; provider: string }> {
  const row = await db.providerCredential.findUnique({ where: { id: credentialId } })
  if (!row || row.status !== 'active') {
    throw new BeanApiError('NO_BACKEND', 'No active credential is configured for this provider.')
  }
  // Defense-in-depth (W6 SEC-W6-01): a hand-edited DB row can carry a URL
  // that never passed write-time validation — re-check before any fetch.
  if (row.baseUrl) {
    const guard = validateProviderBaseUrl(row.baseUrl)
    if (!guard.ok) {
      throw new BeanApiError('PRODUCT_UNAVAILABLE', 'The configured provider base URL is not allowed by the SSRF policy; fix or replace the credential.')
    }
  }
  let payload: ProviderSecretPayload
  try {
    payload = JSON.parse(decryptSecret(row.encrypted)) as ProviderSecretPayload
  } catch (e) {
    if (e instanceof CredentialsNotConfiguredError || e instanceof DecryptionFailedError) {
      // Honest operator-facing failure: the credential cannot be used.
      throw new BeanApiError(
        'PROVIDER_UNAVAILABLE',
        'The configured provider credential could not be decrypted (missing or rotated master key). Contact an administrator.',
      )
    }
    throw e
  }
  if (!payload?.apiKey) {
    throw new BeanApiError('PROVIDER_UNAVAILABLE', 'The configured provider credential is empty.')
  }
  await db.providerCredential
    .update({ where: { id: credentialId }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined)
  return { payload, baseUrl: row.baseUrl, provider: row.provider }
}

/**
 * Master-key rotation sweep: re-encrypt every active credential under the
 * CURRENT environment master key (run AFTER the operator has rotated the env
 * value and it still decrypts the OLD envelopes — i.e. the sweep runs with
 * the old key value while the new one is staged, or rows are migrated one
 * operator step at a time). Row-level failures are reported, never swallowed.
 */
export async function rotateAllCredentials(): Promise<{ reencrypted: number; failed: number; errors: string[] }> {
  if (!isCredentialEncryptionConfigured()) throw new CredentialsNotConfiguredError()
  const rows = await db.providerCredential.findMany({ where: { status: 'active' } })
  let reencrypted = 0
  let failed = 0
  const errors: string[] = []
  for (const row of rows) {
    try {
      const { encrypted, keyVersion } = rotateSecretEnvelope(row.encrypted)
      await db.providerCredential.update({
        where: { id: row.id },
        data: { encrypted, keyVersion },
      })
      reencrypted += 1
    } catch (e) {
      failed += 1
      errors.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { reencrypted, failed, errors }
}

/**
 * The active credential for a provider (adapter resolution). Prefers the
 * most recently updated active row. Null when none — callers report the
 * honest 'awaiting-credentials' configuration state.
 */
export async function getActiveCredentialId(provider: string): Promise<string | null> {
  const row = await db.providerCredential.findFirst({
    where: { provider, status: 'active' },
    orderBy: { updatedAt: 'desc' },
  })
  return row?.id ?? null
}
