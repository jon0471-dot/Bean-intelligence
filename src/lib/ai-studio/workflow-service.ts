/**
 * BEAN Intelligence — M50.3 BEAN AI STUDIO workflow service (SERVER ONLY).
 *
 * Durable, owner-scoped workflow management over the M50.2 PURE graph core
 * (the sole authority for schema parsing, registry resolution, validation
 * and deterministic compilation — none of those contracts are duplicated
 * here). Mirrors the M49.x service discipline:
 *
 *  - every mutation requires an authenticated session and derives userId
 *    from the server session; caller-supplied ownership is never accepted;
 *  - every read/write is owner-scoped: rows matched by (id, userId); a miss
 *    is an honest NOT_FOUND (no existence leak across users);
 *  - strings and vocabularies are re-validated server-side (bounded);
 *  - multi-row changes run in transactions (publish freeze + supersede,
 *    monotonic version allocation);
 *  - version immutability: a published/superseded graph can never be
 *    mutated — edits go through NEW drafts (publish → supersede is atomic);
 *  - the per-owner definition cap counts ARCHIVED definitions too (archive
 *    cannot bypass the quota); the 50 value is the architecture's
 *    provisional, owner-confirmable guard;
 *  - deletion policy (the conservative M50.1 §8.1/§7.14 resolution): a
 *    definition with ANY historical WorkflowRun row cannot be physically
 *    deleted (honest 409 — archiving is offered); a definition with ACTIVE
 *    runs cannot be archived or deleted; with zero runs, deletion cascades
 *    its unused versions; AgentMission/AgentMissionTask history is never
 *    touched;
 *  - validate/preview are STRICTLY read-only: they perform findUnique reads
 *    of (definition, version) and then call the pure core — they never
 *    create missions, enqueue jobs, write Trust tasks or mutate workflow
 *    rows, and they never read an availability claim from the browser;
 *  - rate limits + audit records ride the existing metering/ratelimit.
 *
 * This service never executes workflows: no createMissionFromPlan, no
 * GenerationJob creation, no specialist adapters, no inference (M50.5).
 */

import { db } from '@/lib/db'
import { BeanApiError } from '@/lib/api/errors'
import { recordAudit } from '@/lib/observability/metering'
import { checkRateLimit } from '@/lib/auth/ratelimit'
import { Prisma } from '@prisma/client'
import { parseWorkflowGraph } from './schema'
import { validateWorkflowGraph } from './validate'
import { compileWorkflowToPlan } from './compile'
import type {
  AvailabilitySnapshot,
  CompiledWorkflowResult,
  StudioDiagnostic,
  StudioWorkflowGraph,
  WorkflowValidationOutcome,
} from './types'

// ---------------------------------------------------------------------------
// Bounded service policy (the architecture's provisional, owner-confirmable
// values — recorded in the M50.1 addendum; nothing here deletes data
// automatically and no retention TTL exists in M50.3).
// ---------------------------------------------------------------------------

export const WORKFLOW_SERVICE_LIMITS = {
  /** Provisional hard cap per owner (architecture §8; owner-confirmable).
   *  Archived definitions COUNT toward the cap. */
  maxDefinitionsPerOwner: 50,
  /** Stored graph JSON bound (mirrors WORKFLOW_LIMITS.graphJsonMaxChars). */
  graphJsonMaxChars: 65_536,
  nameMaxChars: 80,
  descriptionMaxChars: 600,
  changeNoteMaxChars: 300,
  /** WorkflowRun objective bound = the existing M41 objective limit. */
  objectiveMaxChars: 4_000,
  /** Mutation burst guard (creates, edits, archive, delete, duplicates,
   *  version create/edit/publish) per user per minute. */
  crudBurstLimit: 30,
  /** Read-only validate/preview burst guard per user per minute. */
  readBurstLimit: 30,
  /** Pagination bounds. */
  maxPageSize: 50,
  defaultPageSize: 20,
  /** A mission in these (real M41) statuses makes the run — and therefore
   *  the workflow — ACTIVE (mirror of the team-service rule). */
  activeRunStatuses: ['planned', 'running'] as const,
} as const

/** Documented empty-editor placeholder for a brand-new blank draft. It
 *  parses cleanly as schema version 1 but is NOT a publishable workflow
 *  (validation refuses an empty graph until real nodes exist). */
export const EMPTY_EDITOR_GRAPH_JSON = '{"schemaVersion":1,"nodes":[],"edges":[]}'

const AUDIT = {
  create: 'ai-studio.workflow_create',
  update: 'ai-studio.workflow_update',
  archive: 'ai-studio.workflow_archive',
  restore: 'ai-studio.workflow_restore',
  delete: 'ai-studio.workflow_delete',
  duplicate: 'ai-studio.workflow_duplicate',
  versionCreate: 'ai-studio.version_create',
  versionEdit: 'ai-studio.version_edit',
  versionPublish: 'ai-studio.version_publish',
} as const

// ---------------------------------------------------------------------------
// Customer-safe view shapes (no internals, no Prisma types)
// ---------------------------------------------------------------------------

export interface WorkflowVersionSummary {
  version: number
  status: 'draft' | 'published' | 'superseded'
  changeNote: string
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface WorkflowDefinitionView {
  id: string
  name: string
  description: string
  status: 'active' | 'archived'
  createdAt: string
  updatedAt: string
  /** Derived from REAL rows — never drifting counters. */
  versionSummary: {
    total: number
    latest: { version: number; status: WorkflowVersionSummary['status'] } | null
    publishedVersion: number | null
    draftVersion: number | null
  }
  runCount: number
}

export interface WorkflowVersionView extends WorkflowVersionSummary {
  id: string
  definitionId: string
}

export interface Paginated<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

interface DefinitionRow {
  id: string
  userId: string
  name: string
  description: string
  status: string
  createdAt: Date
  updatedAt: Date
}

interface VersionRow {
  id: string
  definitionId: string
  version: number
  status: string
  graphJson: string
  changeNote: string
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

// ---------------------------------------------------------------------------
// Bounded input normalization (server-side; client JSON is never trusted)
// ---------------------------------------------------------------------------

function boundedName(name: string): string {
  const n = name.trim()
  if (n.length < 1 || n.length > WORKFLOW_SERVICE_LIMITS.nameMaxChars) {
    throw new BeanApiError('VALIDATION_ERROR', `Workflow name must be 1-${WORKFLOW_SERVICE_LIMITS.nameMaxChars} characters.`)
  }
  return n
}

function boundedOptional(value: string | undefined, max: number, field: string): string {
  const v = (value ?? '').trim()
  if (v.length > max) {
    throw new BeanApiError('VALIDATION_ERROR', `Workflow ${field} must be at most ${max} characters.`)
  }
  return v
}

function clampPage(page: number | undefined): number {
  return page !== undefined && Number.isInteger(page) && page >= 1 ? Math.min(page, 10_000) : 1
}

function clampPageSize(pageSize: number | undefined): number {
  if (pageSize === undefined) return WORKFLOW_SERVICE_LIMITS.defaultPageSize
  if (!Number.isInteger(pageSize) || pageSize < 1) return WORKFLOW_SERVICE_LIMITS.defaultPageSize
  return Math.min(pageSize, WORKFLOW_SERVICE_LIMITS.maxPageSize)
}

/** A version-number path segment: strictly a positive integer string. */
function parseVersionNumber(raw: string): number {
  if (!/^[1-9][0-9]{0,5}$/.test(raw)) {
    throw new BeanApiError('NOT_FOUND', 'Workflow version not found.')
  }
  const v = Number.parseInt(raw, 10)
  if (!Number.isInteger(v) || v < 1 || v > 999_999) {
    throw new BeanApiError('NOT_FOUND', 'Workflow version not found.')
  }
  return v
}

// ---------------------------------------------------------------------------
// Rate limiting (the existing sliding-window limiter; the limiter keeps its
// own established state — it is NOT a workflow business record)
// ---------------------------------------------------------------------------

function crudRateLimit(userId: string): void {
  const rl = checkRateLimit(`ai-studio-workflows:${userId}`, WORKFLOW_SERVICE_LIMITS.crudBurstLimit, 60_000)
  if (!rl.allowed) {
    throw new BeanApiError('RATE_LIMITED', 'Too many workflow changes in a short time. Please slow down and try again shortly.', undefined, {
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    })
  }
}

function readRateLimit(userId: string): void {
  const rl = checkRateLimit(`ai-studio-validate-preview:${userId}`, WORKFLOW_SERVICE_LIMITS.readBurstLimit, 60_000)
  if (!rl.allowed) {
    throw new BeanApiError('RATE_LIMITED', 'Too many validation or preview requests in a short time. Please slow down.', undefined, {
      headers: { 'Retry-After': String(rl.retryAfterSec) },
    })
  }
}

// ---------------------------------------------------------------------------
// Owner-scoped row lookups (a foreign id is an honest NOT_FOUND — always)
// ---------------------------------------------------------------------------

async function getDefinitionRow(userId: string, definitionId: string): Promise<DefinitionRow> {
  const row = await db.workflowDefinition.findFirst({
    where: { id: definitionId, userId },
  })
  if (!row) throw new BeanApiError('NOT_FOUND', 'Workflow not found.')
  if (!isDefinitionStatus(row.status)) throw new BeanApiError('INTERNAL_ERROR', 'Workflow record has an inconsistent status.')
  return row as DefinitionRow & { status: DefinitionStatus }
}

async function getVersionRow(userId: string, definitionId: string, version: number): Promise<VersionRow> {
  // The definition scoping comes FIRST: a foreign definition id never
  // reveals whether a version number exists behind it.
  await getDefinitionRow(userId, definitionId)
  const row = await db.workflowVersion.findFirst({
    where: { definitionId, version },
  })
  if (!row) throw new BeanApiError('NOT_FOUND', 'Workflow version not found.')
  return row
}

function isDefinitionStatus(s: string): s is 'active' | 'archived' {
  return s === 'active' || s === 'archived'
}

function isVersionStatus(s: string): s is WorkflowVersionSummary['status'] {
  return s === 'draft' || s === 'published' || s === 'superseded'
}

// ---------------------------------------------------------------------------
// Graph storage discipline: strict parse FIRST, then store the canonical
// JSON of the parsed graph — stored bytes are always schema-clean, and
// graph payloads are bounded BEFORE parsing.
// ---------------------------------------------------------------------------

function canonicalGraphJson(graphText: string): string {
  if (typeof graphText !== 'string') {
    throw new BeanApiError('VALIDATION_ERROR', 'The workflow graph must be a JSON string.')
  }
  if (graphText.length > WORKFLOW_SERVICE_LIMITS.graphJsonMaxChars) {
    throw new BeanApiError('PAYLOAD_TOO_LARGE', `The workflow graph is too large (limit ${WORKFLOW_SERVICE_LIMITS.graphJsonMaxChars} characters).`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(graphText)
  } catch {
    throw new BeanApiError('UNSUPPORTED_CONTENT', 'The workflow graph is not valid JSON.')
  }
  const parsed = parseWorkflowGraph(raw)
  if (!parsed.ok) {
    const first = parsed.outcome.diagnostics[0]
    throw new BeanApiError('UNSUPPORTED_CONTENT', first?.message ?? 'The workflow graph does not match the supported schema.')
  }
  return JSON.stringify(parsed.graph)
}

/** Parse a STORED graph back into the validated shape. A stored graph was
 *  canonical on write; a parse failure here is an integrity defect and is
 *  surfaced honestly instead of being papered over. */
function parseStoredGraph(graphJson: string, versionLabel: string): { ok: true; graph: StudioWorkflowGraph } {
  let raw: unknown
  try {
    raw = JSON.parse(graphJson)
  } catch {
    throw new BeanApiError('INTERNAL_ERROR', `Stored graph for ${versionLabel} is not readable JSON.`)
  }
  const parsed = parseWorkflowGraph(raw)
  if (!parsed.ok) {
    throw new BeanApiError('INTERNAL_ERROR', `Stored graph for ${versionLabel} no longer matches the supported schema.`)
  }
  return parsed
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function versionSummary(v: VersionRow): WorkflowVersionSummary {
  if (!isVersionStatus(v.status)) {
    throw new BeanApiError('INTERNAL_ERROR', 'Workflow version record has an inconsistent status.')
  }
  return {
    version: v.version,
    status: v.status,
    changeNote: v.changeNote,
    publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  }
}

async function buildDefinitionView(row: DefinitionRow): Promise<WorkflowDefinitionView> {
  const [versions, runCount] = await Promise.all([
    db.workflowVersion.findMany({
      where: { definitionId: row.id },
      orderBy: { version: 'desc' },
      select: { version: true, status: true },
    }),
    db.workflowRun.count({ where: { definitionId: row.id } }),
  ])
  const published = versions.find((v) => v.status === 'published')
  const draft = versions.find((v) => v.status === 'draft')
  const latest = versions[0]
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: isDefinitionStatus(row.status) ? row.status : 'active',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    versionSummary: {
      total: versions.length,
      latest: latest ? { version: latest.version, status: isVersionStatus(latest.status) ? latest.status : 'draft' } : null,
      publishedVersion: published ? published.version : null,
      draftVersion: draft ? draft.version : null,
    },
    runCount,
  }
}

// ---------------------------------------------------------------------------
// Active-run / historical-run protection (deletion policy §5.4)
// ---------------------------------------------------------------------------

async function activeRunCount(definitionId: string): Promise<number> {
  return db.workflowRun.count({
    where: { definitionId, status: { in: [...WORKFLOW_SERVICE_LIMITS.activeRunStatuses] } },
  })
}

async function assertArchivable(userId: string, definitionId: string): Promise<void> {
  const active = await activeRunCount(definitionId)
  if (active > 0) {
    throw new BeanApiError(
      'EDIT_CONFLICT',
      'This workflow has a run in progress — wait for it to finish before archiving or deleting it.',
    )
  }
}

async function assertDeletable(userId: string, definitionId: string): Promise<void> {
  await assertArchivable(userId, definitionId)
  const historical = await db.workflowRun.count({ where: { definitionId } })
  if (historical > 0) {
    throw new BeanApiError(
      'EDIT_CONFLICT',
      'This workflow has run history that must be preserved, so it cannot be deleted. Archive it instead — archived workflows stay listed and their history stays intact.',
    )
  }
}

// ---------------------------------------------------------------------------
// Definition operations
// ---------------------------------------------------------------------------

export async function listWorkflowDefinitions(
  userId: string,
  options: { status?: 'active' | 'archived'; page?: number; pageSize?: number } = {},
): Promise<Paginated<WorkflowDefinitionView>> {
  const page = clampPage(options.page)
  const pageSize = clampPageSize(options.pageSize)
  const where: Prisma.WorkflowDefinitionWhereInput = { userId, ...(options.status ? { status: options.status } : {}) }
  const [rows, total] = await Promise.all([
    db.workflowDefinition.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.workflowDefinition.count({ where }),
  ])
  const items = await Promise.all(rows.map((r) => buildDefinitionView(r as DefinitionRow)))
  return { items, page, pageSize, total }
}

async function assertDefinitionQuota(userId: string): Promise<void> {
  // Archived definitions COUNT — archiving can never be used to bypass the cap.
  const used = await db.workflowDefinition.count({ where: { userId } })
  if (used >= WORKFLOW_SERVICE_LIMITS.maxDefinitionsPerOwner) {
    throw new BeanApiError(
      'QUOTA_EXCEEDED',
      `You have reached the limit of ${WORKFLOW_SERVICE_LIMITS.maxDefinitionsPerOwner} saved workflows. Delete an unused workflow (one without run history) to free a slot.`,
    )
  }
}

export interface CreateWorkflowInput {
  name: string
  description?: string
  /** Optional initial graph JSON (strict schema + size checked). */
  graphJson?: string
}

export async function createWorkflowDefinition(userId: string, input: CreateWorkflowInput): Promise<WorkflowDefinitionView> {
  crudRateLimit(userId)
  const name = boundedName(input.name)
  const description = boundedOptional(input.description, WORKFLOW_SERVICE_LIMITS.descriptionMaxChars, 'description')
  await assertDefinitionQuota(userId)
  // An initial graph is stored ONLY after the strict schema + size checks;
  // a blank draft uses the documented empty-editor placeholder and is never
  // required to be publishable.
  const graphJson = input.graphJson !== undefined ? canonicalGraphJson(input.graphJson) : EMPTY_EDITOR_GRAPH_JSON
  const created = await db.$transaction(async (tx) => {
    const def = await tx.workflowDefinition.create({
      data: { userId, name, description },
    })
    await tx.workflowVersion.create({
      data: { definitionId: def.id, version: 1, status: 'draft', graphJson, changeNote: 'Initial draft' },
    })
    return def
  })
  await recordAudit({ actorId: userId, action: AUDIT.create, target: created.id, meta: { name } })
  return buildDefinitionView(created as DefinitionRow)
}

export async function getWorkflowDefinition(userId: string, definitionId: string): Promise<WorkflowDefinitionView> {
  const row = await getDefinitionRow(userId, definitionId)
  return buildDefinitionView(row)
}

export interface UpdateWorkflowInput {
  name?: string
  description?: string
  /** 'archived' → archive (refused with an active run); 'active' → restore. */
  status?: 'active' | 'archived'
}

export async function updateWorkflowDefinition(userId: string, definitionId: string, input: UpdateWorkflowInput): Promise<WorkflowDefinitionView> {
  crudRateLimit(userId)
  const row = await getDefinitionRow(userId, definitionId)
  const data: { name?: string; description?: string; status?: 'active' | 'archived' } = {}
  let archived = false
  let restored = false
  if (input.name !== undefined) data.name = boundedName(input.name)
  if (input.description !== undefined) data.description = boundedOptional(input.description, WORKFLOW_SERVICE_LIMITS.descriptionMaxChars, 'description')
  if (input.status !== undefined && input.status !== row.status) {
    // Only the two honest transitions exist; there is no arbitrary status write.
    if (input.status === 'archived') {
      await assertArchivable(userId, definitionId)
      data.status = 'archived'
      archived = true
    } else {
      data.status = 'active'
      restored = true
    }
  }
  if (Object.keys(data).length > 0) {
    await db.workflowDefinition.update({ where: { id: row.id }, data })
  }
  const action = archived ? AUDIT.archive : restored ? AUDIT.restore : AUDIT.update
  await recordAudit({ actorId: userId, action, target: row.id, meta: { fields: Object.keys(data) } })
  return getWorkflowDefinition(userId, definitionId)
}

export async function deleteWorkflowDefinition(userId: string, definitionId: string): Promise<{ deleted: true }> {
  crudRateLimit(userId)
  const row = await getDefinitionRow(userId, definitionId)
  await assertDeletable(userId, definitionId)
  // Zero runs (asserted above): the cascade removes this definition's
  // versions — all of them unused — and nothing else. Mission history is
  // never touched (WorkflowRun.missionId is a loose reference; no FK).
  await db.workflowDefinition.delete({ where: { id: row.id } })
  await recordAudit({ actorId: userId, action: AUDIT.delete, target: row.id, meta: { name: row.name } })
  return { deleted: true }
}

export async function duplicateWorkflowDefinition(userId: string, definitionId: string): Promise<WorkflowDefinitionView> {
  crudRateLimit(userId)
  const source = await getDefinitionRow(userId, definitionId)
  await assertDefinitionQuota(userId)
  // The copied graph comes from the LATEST version (draft if one exists,
  // else the highest version). Run and version HISTORY are never copied.
  const latest = await db.workflowVersion.findFirst({
    where: { definitionId: source.id },
    orderBy: { version: 'desc' },
  })
  const graphJson = latest
    ? latest.graphJson // already canonical (schema-clean) on write
    : EMPTY_EDITOR_GRAPH_JSON
  const copyName = source.name.length + 7 <= WORKFLOW_SERVICE_LIMITS.nameMaxChars
    ? `${source.name} (copy)`
    : `${source.name.slice(0, Math.max(1, WORKFLOW_SERVICE_LIMITS.nameMaxChars - 7))} (copy)`
  const created = await db.$transaction(async (tx) => {
    const def = await tx.workflowDefinition.create({
      data: { userId, name: copyName, description: source.description },
    })
    await tx.workflowVersion.create({
      data: { definitionId: def.id, version: 1, status: 'draft', graphJson, changeNote: `Copied from "${source.name}"` },
    })
    return def
  })
  await recordAudit({ actorId: userId, action: AUDIT.duplicate, target: created.id, meta: { sourceId: source.id } })
  return buildDefinitionView(created as DefinitionRow)
}

// ---------------------------------------------------------------------------
// Version operations
// ---------------------------------------------------------------------------

export async function listWorkflowVersions(
  userId: string,
  definitionId: string,
  options: { page?: number; pageSize?: number } = {},
): Promise<Paginated<WorkflowVersionView>> {
  const row = await getDefinitionRow(userId, definitionId)
  const page = clampPage(options.page)
  const pageSize = clampPageSize(options.pageSize)
  const [rows, total] = await Promise.all([
    db.workflowVersion.findMany({
      where: { definitionId: row.id },
      orderBy: { version: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.workflowVersion.count({ where: { definitionId: row.id } }),
  ])
  return {
    items: rows.map((v) => ({ ...(versionSummary(v as VersionRow)), id: v.id, definitionId: v.definitionId })),
    page,
    pageSize,
    total,
  }
}

/** One version WITH its stored graph (the canvas load path). */
export async function getWorkflowVersion(userId: string, definitionId: string, versionRaw: string): Promise<WorkflowVersionView & { graphJson: string }> {
  const version = parseVersionNumber(versionRaw)
  const row = await getVersionRow(userId, definitionId, version)
  return { ...(versionSummary(row)), id: row.id, definitionId: row.definitionId, graphJson: row.graphJson }
}

export interface CreateVersionInput {
  /** Explicit source version to branch from (defaults: latest published,
   *  else the highest version, else the empty-editor placeholder). */
  sourceVersion?: number
  /** Replacement graph for the NEW draft (strict schema + size checked).
   *  When omitted, the source version's stored graph is carried over. */
  graphJson?: string
  changeNote?: string
}

export async function createWorkflowVersion(userId: string, definitionId: string, input: CreateVersionInput): Promise<WorkflowVersionView> {
  crudRateLimit(userId)
  const def = await getDefinitionRow(userId, definitionId)
  const changeNote = boundedOptional(input.changeNote, WORKFLOW_SERVICE_LIMITS.changeNoteMaxChars, 'change note')
  if (input.sourceVersion !== undefined && (!Number.isInteger(input.sourceVersion) || input.sourceVersion < 1)) {
    throw new BeanApiError('VALIDATION_ERROR', 'The source version must be a positive version number.')
  }

  // One-draft policy: a new draft requires an empty drafting table (an
  // existing draft is edited in place, not duplicated).
  const existingDraft = await db.workflowVersion.findFirst({
    where: { definitionId: def.id, status: 'draft' },
    orderBy: { version: 'desc' },
  })
  if (existingDraft) {
    throw new BeanApiError(
      'EDIT_CONFLICT',
      `Version ${existingDraft.version} is already a draft of this workflow — edit that draft (or publish it) instead of creating another one.`,
    )
  }

  // Source resolution (default: latest published, else highest version).
  let sourceGraphJson: string
  if (input.graphJson !== undefined) {
    sourceGraphJson = canonicalGraphJson(input.graphJson)
  } else if (input.sourceVersion !== undefined) {
    const source = await getVersionRow(userId, definitionId, input.sourceVersion)
    sourceGraphJson = source.graphJson
  } else {
    const published = await db.workflowVersion.findFirst({
      where: { definitionId: def.id, status: 'published' },
      orderBy: { version: 'desc' },
    })
    const latest = published
      ? published
      : await db.workflowVersion.findFirst({ where: { definitionId: def.id }, orderBy: { version: 'desc' } })
    sourceGraphJson = latest ? latest.graphJson : EMPTY_EDITOR_GRAPH_JSON
  }

  try {
    const created = await db.$transaction(async (tx) => {
      // Monotonic numbering inside the transaction; the (definitionId,
      // version) UNIQUE constraint is the database-level race backstop.
      const agg = await tx.workflowVersion.aggregate({
        _max: { version: true },
        where: { definitionId: def.id },
      })
      const nextVersion = (agg._max.version ?? 0) + 1
      return tx.workflowVersion.create({
        data: { definitionId: def.id, version: nextVersion, status: 'draft', graphJson: sourceGraphJson, changeNote },
      })
    })
    await recordAudit({ actorId: userId, action: AUDIT.versionCreate, target: def.id, meta: { version: created.version } })
    return { ...(versionSummary(created)), id: created.id, definitionId: created.definitionId }
  } catch (e) {
    // Concurrent creation raced to the same version number → honest 409.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new BeanApiError('EDIT_CONFLICT', 'Another request created a version at the same time — reload and try again.')
    }
    throw e
  }
}

export interface UpdateVersionInput {
  graphJson?: string
  changeNote?: string
}

export async function updateWorkflowVersion(userId: string, definitionId: string, versionRaw: string, input: UpdateVersionInput): Promise<WorkflowVersionView> {
  crudRateLimit(userId)
  const version = parseVersionNumber(versionRaw)
  const row = await getVersionRow(userId, definitionId, version)
  if (!isVersionStatus(row.status)) {
    throw new BeanApiError('INTERNAL_ERROR', 'Workflow version record has an inconsistent status.')
  }
  if (row.status !== 'draft') {
    // IMMUTABILITY: published and superseded graphs are frozen forever.
    throw new BeanApiError(
      'EDIT_CONFLICT',
      `Version ${version} is ${row.status === 'published' ? 'published' : 'archived as superseded'} and can no longer be edited. Create a new draft to continue working.`,
    )
  }
  const data: { graphJson?: string; changeNote?: string } = {}
  if (input.graphJson !== undefined) data.graphJson = canonicalGraphJson(input.graphJson)
  if (input.changeNote !== undefined) data.changeNote = boundedOptional(input.changeNote, WORKFLOW_SERVICE_LIMITS.changeNoteMaxChars, 'change note')
  if (Object.keys(data).length > 0) {
    await db.workflowVersion.update({ where: { id: row.id }, data })
  }
  await recordAudit({ actorId: userId, action: AUDIT.versionEdit, target: definitionId, meta: { version, fields: Object.keys(data) } })
  const fresh = await getVersionRow(userId, definitionId, version)
  return { ...(versionSummary(fresh)), id: fresh.id, definitionId: fresh.definitionId }
}

// ---------------------------------------------------------------------------
// READ-ONLY validate / preview (M50.3 Phase 8 — the zero-write contract)
// ---------------------------------------------------------------------------

export interface ValidateWorkflowVersionResult {
  definitionId: string
  version: number
  status: WorkflowVersionSummary['status']
  outcome: WorkflowValidationOutcome
}

export async function validateWorkflowVersion(
  userId: string,
  definitionId: string,
  versionRaw: string,
  availability?: AvailabilitySnapshot,
): Promise<ValidateWorkflowVersionResult> {
  readRateLimit(userId)
  const version = parseVersionNumber(versionRaw)
  const row = await getVersionRow(userId, definitionId, version)
  if (!isVersionStatus(row.status)) {
    throw new BeanApiError('INTERNAL_ERROR', 'Workflow version record has an inconsistent status.')
  }
  const parsed = parseStoredGraph(row.graphJson, `version ${version}`)
  const outcome = validateWorkflowGraph(parsed.graph, { availability })
  return { definitionId: row.definitionId, version, status: row.status, outcome }
}

export interface PreviewWorkflowVersionResult {
  definitionId: string
  version: number
  status: WorkflowVersionSummary['status']
  compiled: CompiledWorkflowResult
}

export async function previewWorkflowVersion(
  userId: string,
  definitionId: string,
  versionRaw: string,
  availability?: AvailabilitySnapshot,
): Promise<PreviewWorkflowVersionResult> {
  readRateLimit(userId)
  const version = parseVersionNumber(versionRaw)
  const row = await getVersionRow(userId, definitionId, version)
  if (!isVersionStatus(row.status)) {
    throw new BeanApiError('INTERNAL_ERROR', 'Workflow version record has an inconsistent status.')
  }
  const parsed = parseStoredGraph(row.graphJson, `version ${version}`)
  const compiled = compileWorkflowToPlan(parsed.graph, undefined, availability)
  return { definitionId: row.definitionId, version, status: row.status, compiled }
}

// ---------------------------------------------------------------------------
// Publishing (validate-and-freeze, atomic supersede)
// ---------------------------------------------------------------------------

export interface PublishVersionResult {
  definitionId: string
  version: number
  status: 'published'
  publishedAt: string
  /** The version number this publication superseded (null when this is the
   *  workflow's first publication). */
  supersededVersion: number | null
  /** Non-blocking diagnostics (warnings/info) recorded at publication —
   *  availability evidence stays visible but never blocks a valid graph. */
  diagnostics: StudioDiagnostic[]
}

export async function publishWorkflowVersion(userId: string, definitionId: string, versionRaw: string): Promise<PublishVersionResult> {
  crudRateLimit(userId)
  const version = parseVersionNumber(versionRaw)
  const def = await getDefinitionRow(userId, definitionId)
  if (def.status !== 'active') {
    throw new BeanApiError('EDIT_CONFLICT', 'Restore this workflow from the archive before publishing a version.')
  }
  const row = await getVersionRow(userId, definitionId, version)
  if (!isVersionStatus(row.status)) {
    throw new BeanApiError('INTERNAL_ERROR', 'Workflow version record has an inconsistent status.')
  }
  if (row.status === 'published') {
    throw new BeanApiError('EDIT_CONFLICT', `Version ${version} is already published.`)
  }
  if (row.status === 'superseded') {
    throw new BeanApiError('EDIT_CONFLICT', `Version ${version} has been superseded and can no longer be published. Create a new draft from a published version.`)
  }
  // Validation gate BEFORE the freeze — a graph with hard errors never
  // publishes; warnings and info stay visible without blocking.
  const parsed = parseStoredGraph(row.graphJson, `version ${version}`)
  const outcome = validateWorkflowGraph(parsed.graph)
  if (!outcome.valid) {
    const first = outcome.diagnostics.find((d) => d.severity === 'error')
    throw new BeanApiError('UNSUPPORTED_CONTENT', first?.message ?? 'This draft still has problems to fix before it can be published.')
  }

  let supersededVersion: number | null = null
  const publishedAt = await db.$transaction(async (tx) => {
    // Re-read the draft inside the transaction (a concurrent publish/edit
    // would already have changed its status).
    const fresh = await tx.workflowVersion.findFirst({ where: { id: row.id, definitionId: def.id } })
    if (!fresh || fresh.status !== 'draft') {
      throw new BeanApiError('EDIT_CONFLICT', 'This draft changed while it was being published — reload and try again.')
    }
    const previous = await tx.workflowVersion.findFirst({
      where: { definitionId: def.id, status: 'published' },
      orderBy: { version: 'desc' },
    })
    if (previous) {
      await tx.workflowVersion.update({ where: { id: previous.id }, data: { status: 'superseded' } })
      supersededVersion = previous.version
    }
    const now = new Date()
    await tx.workflowVersion.update({
      where: { id: row.id },
      data: { status: 'published', publishedAt: now },
    })
    return now
  })
  await recordAudit({
    actorId: userId,
    action: AUDIT.versionPublish,
    target: definitionId,
    meta: { version, supersededVersion },
  })
  return {
    definitionId: def.id,
    version,
    status: 'published',
    publishedAt: publishedAt.toISOString(),
    supersededVersion,
    diagnostics: outcome.diagnostics,
  }
}
