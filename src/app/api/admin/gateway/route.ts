/**
 * BEAN Intelligence — GET /api/admin/gateway (🛡️ admin session only)
 * Operator diagnostics for the unified AI gateway: provider credentials as
 * MASKED views (no ciphertext, no plaintext — the encrypted envelope is
 * internal state), gateway request-log summary, active key metadata counts.
 *
 * POST /api/admin/gateway credentials — create / replace / revoke are here:
 *  POST {action: 'create-credential'|'replace-credential'|'revoke-credential'|'rotate-master-key'}
 * Secrets are accepted in the request body over HTTPS and immediately
 * encrypted; responses contain masked hints only.
 */
import { z } from 'zod'
import { handle, ok } from '@/lib/api/errors'
import { parseBody } from '@/lib/api/validate'
import { requireAdmin } from '@/lib/auth/session'
import { db } from '@/lib/db'
import { recordAudit } from '@/lib/observability/metering'
import { cachedHealth } from '@/lib/adapters/health-cache'
import { hostedLlmAdapter } from '@/lib/adapters/hosted-llm'
import {
  createProviderCredential,
  replaceProviderCredential,
  revokeProviderCredential,
  listProviderCredentials,
  rotateAllCredentials,
  REGISTERED_PROVIDERS,
} from '@/lib/security/provider-credentials'
import { isCredentialEncryptionConfigured } from '@/lib/security/crypto'
import { getGatewayModels } from '@/lib/registry/models'
import { probeOpenAICompatible } from '@/lib/ai-gateway/providers/openai-compatible'

export async function GET() {
  return handle(async () => {
    const admin = await requireAdmin()

    // The llm health probe MUST complete BEFORE getGatewayModels runs:
    // getGatewayModels calls its health callback synchronously per backend,
    // and the callback reads llmHealth. Inlining the probe into the same
    // Promise.all created a temporal-dead-zone reference (the callback could
    // run before the destructuring assignment) — an unconditional 500 on
    // this endpoint since W5 (caught by the closure-work live E2E, never
    // covered by unit tests).
    const llmHealth = await cachedHealth('llm-hosted-primary', () => hostedLlmAdapter.health())
    const [credentials, keyRows, recentRequests, models] = await Promise.all([
      listProviderCredentials(),
      db.apiKey.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: { id: true, name: true, prefix: true, keyHash: true, permissions: true, status: true, rateLimitPerMin: true, requestCount: true, lastUsedAt: true, createdAt: true, expiresAt: true, revokedAt: true },
      }),
      db.gatewayRequestLog.findMany({ orderBy: { createdAt: 'desc' }, take: 25 }),
      getGatewayModels({ health: () => llmHealth }),
    ])

    // External provider probe (only meaningful with an active credential).
    const externalCred = credentials.find((c) => c.provider === 'openai-compatible' && c.status === 'active')
    const externalProbe = externalCred
      ? await probeOpenAICompatible(externalCred.id).catch(() => null)
      : null

    await recordAudit({ actorId: admin.id, action: 'admin.view_gateway' })

    return ok({
      credentialEncryption: isCredentialEncryptionConfigured() ? 'configured' : 'not-configured',
      registeredProviders: REGISTERED_PROVIDERS,
      credentials,
      externalProbe,
      models: models.map((m) => ({
        id: m.id,
        displayName: m.displayName,
        provider: m.provider,
        capabilities: m.capabilities,
        enabled: m.enabled,
        configurationStatus: m.configurationStatus,
        unavailableReason: m.unavailableReason,
        health: m.backendHealth,
      })),
      apiKeys: keyRows.map((k) => ({
        id: k.id,
        name: k.name,
        fingerprint: `${k.prefix}…${k.keyHash.slice(0, 4)}`,
        permissions: JSON.parse(k.permissions) as string[],
        status: k.status,
        rateLimitPerMin: k.rateLimitPerMin,
        requestCount: k.requestCount,
        lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
        expiresAt: k.expiresAt?.toISOString() ?? null,
        revokedAt: k.revokedAt?.toISOString() ?? null,
        createdAt: k.createdAt.toISOString(),
      })),
      recentRequests: recentRequests.map((r) => ({
        id: r.id,
        authKind: r.authKind,
        provider: r.provider,
        model: r.model,
        endpoint: r.endpoint,
        status: r.status,
        errorCode: r.errorCode,
        streamed: r.streamed,
        durationMs: r.durationMs,
        createdAt: r.createdAt.toISOString(),
      })),
    })
  })
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create-credential'),
    provider: z.string().min(1),
    label: z.string().min(1).max(100),
    apiKey: z.string().min(8).max(400),
    baseUrl: z.string().url().max(300).nullable().optional(),
  }),
  z.object({
    action: z.literal('replace-credential'),
    id: z.string().min(1),
    apiKey: z.string().min(8).max(400),
    label: z.string().max(100).optional(),
    baseUrl: z.string().url().max(300).nullable().optional(),
  }),
  z.object({ action: z.literal('revoke-credential'), id: z.string().min(1) }),
  z.object({ action: z.literal('rotate-master-key') }),
])

export async function POST(request: Request) {
  return handle(async () => {
    const admin = await requireAdmin()
    const body = await parseBody(request, actionSchema)
    switch (body.action) {
      case 'create-credential': {
        const view = await createProviderCredential({
          adminId: admin.id,
          provider: body.provider,
          label: body.label,
          apiKey: body.apiKey,
          baseUrl: body.baseUrl ?? null,
        })
        await recordAudit({ actorId: admin.id, action: 'gateway.credential_created', target: view.id, meta: { provider: view.provider } })
        return ok({ credential: view })
      }
      case 'replace-credential': {
        const view = await replaceProviderCredential(body.id, {
          apiKey: body.apiKey,
          label: body.label,
          baseUrl: body.baseUrl,
        })
        await recordAudit({ actorId: admin.id, action: 'gateway.credential_replaced', target: body.id })
        return ok({ credential: view })
      }
      case 'revoke-credential': {
        await revokeProviderCredential(body.id)
        await recordAudit({ actorId: admin.id, action: 'gateway.credential_revoked', target: body.id })
        return ok({ revoked: true, id: body.id })
      }
      case 'rotate-master-key': {
        // Re-encrypts all active credentials under the CURRENT env master key.
        const result = await rotateAllCredentials()
        await recordAudit({ actorId: admin.id, action: 'gateway.masterkey_rotation', meta: { reencrypted: result.reencrypted, failed: result.failed } })
        return ok({
          reencrypted: result.reencrypted,
          failed: result.failed,
          ...(result.errors.length > 0 ? { errors: result.errors } : {}),
        })
      }
    }
  })
}
