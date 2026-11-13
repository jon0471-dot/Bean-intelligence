/**
 * BEAN Intelligence — developer portal ownership enforcement (Phase 1).
 *
 * Central, shared guards for /api/portal/* — NOT per-route ad hoc checks.
 * Semantics:
 *  - Unauthenticated (no session): 401 UNAUTHENTICATED (via requireSessionPrincipal).
 *  - API-key principals: 403 FORBIDDEN (keys never manage keys or projects).
 *  - Cross-user or unknown Project / key / usage / log access: 404 NOT_FOUND —
 *    existence is never revealed to non-owners (IDOR-safe by construction).
 *
 * Single-owner tenancy: a Project belongs to exactly one user; every nested
 * resource (key, usage view, log view) resolves through its owning Project,
 * so an ownership check on the project transitively bounds the whole tree.
 */
import { BeanApiError } from '@/lib/api/errors'
import { db } from '@/lib/db'
import { requireSessionPrincipal, type GatewayPrincipal } from './gateway-auth'

export interface OwnedProject {
  principal: GatewayPrincipal & { kind: 'session' }
  project: {
    id: string
    userId: string
    name: string
    status: string
    createdAt: Date
    updatedAt: Date
  }
}

/** Resolve a project the caller owns, or NOT_FOUND (never 403/200). */
export async function requireOwnedProject(request: Request, projectId: string): Promise<OwnedProject> {
  const principal = await requireSessionPrincipal(request)
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project || project.userId !== principal.userId) {
    throw new BeanApiError('NOT_FOUND', 'Project not found.')
  }
  return { principal, project }
}

/** Resolve an API key that belongs to the caller AND to the named project. */
export async function requireOwnedProjectKey(request: Request, projectId: string, keyId: string) {
  const owned = await requireOwnedProject(request, projectId)
  const key = await db.apiKey.findUnique({ where: { id: keyId } })
  // The key must live in THIS project and be owned by THIS user. A legacy
  // administrator key (projectId = null) is unreachable through portal
  // project routes by construction.
  if (!key || key.projectId !== projectId || key.userId !== owned.principal.userId) {
    throw new BeanApiError('NOT_FOUND', 'API key not found.')
  }
  return { ...owned, key }
}

/** Safe metadata projection for a project — never any key material. */
export function projectView(project: OwnedProject['project']) {
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}
