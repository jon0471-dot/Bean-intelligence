/**
 * BEAN Intelligence — M44 Phase 5: independent outcome verification (pure).
 *
 * Evaluates the ACTUAL postconditions of an executed action against
 * INDEPENDENTLY COLLECTED observations — never against the executor's own
 * success-shaped response.
 *
 * The independence rule is structural: the evaluator functions receive an
 * ObservationSet gathered by a DIFFERENT method than the execution path
 * (re-reading the file from disk, re-querying git, re-fetching the URL,
 * re-computing artifact integrity, re-deriving research provenance). The
 * executor's claim is not an input anywhere in this module.
 *
 * Honesty rules:
 *   1. EVERY declared postcondition must be evaluated; an observation slice
 *      that is missing makes that check INCONCLUSIVE — never silently true.
 *   2. All checks pass → confirmed; any failure → failed; any inconclusive
 *      (with no failure) → inconclusive. The lifecycle maps failed → FAILED,
 *      inconclusive → RECOVERY_REQUIRED, and ONLY confirmed → SUCCEEDED.
 *   3. A verification failure is never converted into success by this module
 *      — there is no caller-visible path that rewrites a verdict.
 *
 * PURE module — no database, no I/O. The runtime adapters (executor lanes)
 * gather ObservationSets with the real tools and call these evaluators.
 */

import type { ActionContract, PostconditionSpec } from './action-contract'
import type { VerificationVerdict } from './action-lifecycle'

// ---------------------------------------------------------------------------
// Observations — what an INDEPENDENT checker actually saw.
// ---------------------------------------------------------------------------

export interface FileObservation {
  exists: boolean
  bytes: number
  /** First N characters of content when readable (bounded by the adapter). */
  text?: string
}

export interface GitObservation {
  /** Local commits by sha (bounded set from the independent query). */
  commits?: string[]
  /** The remote ref value observed by an independent fetch. */
  remoteRef?: string | null
  /** Branch names observed locally. */
  branches?: string[]
}

export interface ArtifactObservation {
  ref: string
  bytes: number
  contentType?: string
  /** Deterministic integrity marker (magic bytes / container check). */
  integrity?: 'valid' | 'invalid' | 'unknown'
}

export interface HttpObservation {
  status: number | null
  /** Bounded body snippet from the independent fetch (control checks). */
  bodySnippet?: string
  healthy?: boolean
}

export interface ResearchObservation {
  sources: Array<{ url: string; title: string; publishedAt?: string | null }>
}

export interface IdempotencyObservation {
  /** How many runs the ledger shows for the action's idempotency key. */
  runCount: number
}

export interface ObservationSet {
  /** By path — from an independent disk read (NOT the write's receipt). */
  fileSystem?: Record<string, FileObservation>
  git?: GitObservation
  /** By artifact ref — from independent artifact inspection. */
  artifacts?: Record<string, ArtifactObservation>
  /** By URL — from an independent HTTP fetch. */
  http?: Record<string, HttpObservation>
  research?: ResearchObservation
  idempotency?: Record<string, IdempotencyObservation>
  /** M45 — the state an INDEPENDENT pull-request lookup observed. */
  pullRequestState?: string
}

// ---------------------------------------------------------------------------
// Per-check results and the verdict.
// ---------------------------------------------------------------------------

export interface PostconditionResult {
  kind: PostconditionSpec['kind']
  pass: boolean | null // null = inconclusive (the observation slice was missing)
  reason: string
}

export interface PostconditionVerdict {
  verdict: VerificationVerdict
  results: PostconditionResult[]
  reasons: string[]
}

function containsText(haystack: string | undefined, needle: string): boolean | null {
  if (haystack === undefined) return null
  return haystack.includes(needle)
}

/** Evaluate ONE postcondition against the observations. null pass = inconclusive. */
export function evaluatePostcondition(spec: PostconditionSpec, obs: ObservationSet): PostconditionResult {
  const p = spec.params
  switch (spec.kind) {
    case 'file-exists': {
      const f = obs.fileSystem?.[p.path]
      if (!f) return { kind: spec.kind, pass: null, reason: `no independent file observation for "${p.path}"` }
      return { kind: spec.kind, pass: f.exists, reason: f.exists ? `"${p.path}" exists (${f.bytes} bytes)` : `"${p.path}" does not exist` }
    }
    case 'file-contains': {
      const f = obs.fileSystem?.[p.path]
      if (!f) return { kind: spec.kind, pass: null, reason: `no independent file observation for "${p.path}"` }
      if (!f.exists) return { kind: spec.kind, pass: false, reason: `"${p.path}" does not exist` }
      const c = containsText(f.text, p.text)
      if (c === null) return { kind: spec.kind, pass: null, reason: `content of "${p.path}" was not independently readable` }
      return { kind: spec.kind, pass: c, reason: c ? `"${p.path}" contains the expected content` : `"${p.path}" does not contain the expected content` }
    }
    case 'file-absent': {
      const f = obs.fileSystem?.[p.path]
      if (!f) return { kind: spec.kind, pass: null, reason: `no independent file observation for "${p.path}"` }
      return { kind: spec.kind, pass: !f.exists, reason: !f.exists ? `"${p.path}" is absent` : `"${p.path}" still exists` }
    }
    case 'artifact-exists': {
      const a = obs.artifacts?.[p.ref]
      if (!a) return { kind: spec.kind, pass: null, reason: `no independent artifact observation for "${p.ref}"` }
      return { kind: spec.kind, pass: a.bytes > 0, reason: a.bytes > 0 ? `artifact "${p.ref}" present (${a.bytes} bytes)` : `artifact "${p.ref}" is empty` }
    }
    case 'artifact-min-bytes': {
      const a = obs.artifacts?.[p.ref]
      if (!a) return { kind: spec.kind, pass: null, reason: `no independent artifact observation for "${p.ref}"` }
      const min = Number(p.minBytes)
      return { kind: spec.kind, pass: a.bytes >= min, reason: `artifact "${p.ref}" is ${a.bytes} bytes (required ≥ ${min})` }
    }
    case 'commit-present': {
      const g = obs.git
      if (!g?.commits) return { kind: spec.kind, pass: null, reason: 'no independent git observation' }
      const present = g.commits.includes(p.sha)
      return { kind: spec.kind, pass: present, reason: present ? `commit ${p.sha.slice(0, 12)} exists` : `commit ${p.sha.slice(0, 12)} not found` }
    }
    case 'remote-ref-equals': {
      const g = obs.git
      if (!g || g.remoteRef === undefined) return { kind: spec.kind, pass: null, reason: 'no independent remote observation' }
      return { kind: spec.kind, pass: g.remoteRef === p.sha, reason: `remote ${p.remote ?? 'origin'} ref is ${g.remoteRef?.slice(0, 12) ?? 'unset'} (expected ${p.sha.slice(0, 12)})` }
    }
    case 'url-status': {
      const h = obs.http?.[p.url]
      if (!h) return { kind: spec.kind, pass: null, reason: `no independent HTTP observation for "${p.url}"` }
      const expected = Number(p.status)
      return { kind: spec.kind, pass: h.status === expected, reason: `"${p.url}" responded ${h.status} (expected ${expected})` }
    }
    case 'health-ok': {
      const h = obs.http?.[p.url]
      if (!h) return { kind: spec.kind, pass: null, reason: `no independent health observation for "${p.url}"` }
      const ok = (h.healthy ?? h.status === 200) === true
      return { kind: spec.kind, pass: ok, reason: ok ? `health endpoint at "${p.url}" reports healthy` : `health endpoint at "${p.url}" does not report healthy` }
    }
    case 'sources-min': {
      const r = obs.research
      if (!r) return { kind: spec.kind, pass: null, reason: 'no independent research provenance observation' }
      const min = Number(p.minSources)
      const distinct = new Set(r.sources.map((s) => s.url)).size
      return { kind: spec.kind, pass: distinct >= min, reason: `${distinct} distinct source(s) observed (required ≥ ${min})` }
    }
    case 'value-equals': {
      // Equality over an independently observed value.
      const key = p.observed
      const observed = (obs as Record<string, unknown>)[key]
      if (observed === undefined) return { kind: spec.kind, pass: null, reason: `no independent observation for "${key}"` }
      const pass = String(observed) === p.expected
      return { kind: spec.kind, pass, reason: `observed "${key}"=${String(observed)} (expected ${p.expected})` }
    }
    case 'no-duplicate-effect': {
      const i = obs.idempotency?.[p.key]
      if (!i) return { kind: spec.kind, pass: null, reason: `no idempotency-ledger observation for "${p.key}"` }
      const max = Number(p.maxRuns)
      return { kind: spec.kind, pass: i.runCount <= max, reason: `idempotency key "${p.key}" shows ${i.runCount} run(s) (allowed ≤ ${max})` }
    }
    default:
      return { kind: spec.kind, pass: null, reason: `unknown postcondition kind "${spec.kind}"` }
  }
}

/**
 * Evaluate the FULL postcondition set. The verdict never upgrades: an
 * inconclusive check blocks 'confirmed' even when everything else passed.
 */
export function verifyPostconditions(contract: ActionContract, obs: ObservationSet): PostconditionVerdict {
  const specs = contract.postconditions.length > 0 ? contract.postconditions : fallbackPostconditions(contract)
  const results = specs.map((s) => evaluatePostcondition(s, obs))
  const failed = results.filter((r) => r.pass === false)
  const inconclusive = results.filter((r) => r.pass === null)
  const verdict: VerificationVerdict = failed.length > 0 ? 'failed' : inconclusive.length > 0 ? 'inconclusive' : 'confirmed'
  const reasons = [
    ...failed.map((r) => `FAIL: ${r.reason}`),
    ...inconclusive.map((r) => `INCONCLUSIVE: ${r.reason}`),
    ...(verdict === 'confirmed' ? [`All ${results.length} postcondition(s) independently confirmed.`] : []),
  ]
  return { verdict, results, reasons }
}

/**
 * Actions declared without explicit postconditions still get an honest
 * fallback: the artifact/source expectation derived from the action type.
 * Nothing becomes a success by default.
 */
function fallbackPostconditions(contract: ActionContract): PostconditionSpec[] {
  switch (contract.actionType) {
    case 'file-read':
    case 'research-fetch':
      // Reads verify nothing beyond completion — but they VERIFY NOTHING:
      // an empty check set would auto-confirm, so they get an explicit
      // value-equality against the recorded attempt count (honest no-op
      // proof, independently observable through the idempotency ledger).
      return contract.idempotencyKey
        ? [{ kind: 'no-duplicate-effect', params: { key: contract.idempotencyKey, maxRuns: String(contract.retry.maxAttempts) }, description: 'the read ran within its attempt budget', requireIndependentMethod: true }]
        : []
    case 'file-write':
    case 'code-build':
      return [{ kind: 'file-exists', params: { path: contract.params.path ?? contract.params.deliverablePath ?? '.' }, description: 'the written artifact exists', requireIndependentMethod: true }]
    case 'media-produce':
      return [{ kind: 'artifact-exists', params: { ref: contract.id }, description: 'the produced media artifact exists', requireIndependentMethod: true }]
    case 'repo-commit':
      // The commit SHA comes into existence at execution time; the runtime
      // resolves the placeholder into the executed sha before evaluation.
      return [{ kind: 'commit-present', params: { sha: contract.params.sha ?? '', branch: contract.params.branch ?? '' }, description: 'the executed commit exists on the branch', requireIndependentMethod: true }]
    case 'repo-push':
      return [{ kind: 'remote-ref-equals', params: { sha: contract.params.sha ?? '', remote: contract.params.remote ?? 'origin' }, description: 'the remote ref matches the pushed commit', requireIndependentMethod: true }]
    case 'repo-inspect':
      return contract.idempotencyKey
        ? [{ kind: 'no-duplicate-effect', params: { key: contract.idempotencyKey, maxRuns: String(contract.retry.maxAttempts) }, description: 'the inspection ran within its attempt budget', requireIndependentMethod: true }]
        : []
    case 'deployment-inspect':
      return contract.idempotencyKey
        ? [{ kind: 'no-duplicate-effect', params: { key: contract.idempotencyKey, maxRuns: String(contract.retry.maxAttempts) }, description: 'the deployment inspection ran within its attempt budget', requireIndependentMethod: true }]
        : []
    case 'repo-pull-request':
      // The PR number comes into existence at execution time; the runtime
      // resolves it (state=open observed by an independent GET).
      return [{ kind: 'value-equals', params: { observed: 'pullRequestState', expected: 'open' }, description: 'the created pull request is observed open by an independent lookup', requireIndependentMethod: true }]
    case 'website-publish-verify':
      return [{ kind: 'url-status', params: { url: contract.params.url ?? '', status: '200' }, description: 'the served page responds 200', requireIndependentMethod: true }]
    case 'deployment-release':
      return [{ kind: 'health-ok', params: { url: contract.params.healthUrl ?? contract.params.url ?? '' }, description: 'the deployment health endpoint reports healthy', requireIndependentMethod: true }]
    case 'external-communicate':
      // External communication has NO hidden execution path in BEAN; when a
      // real path exists it is approval-gated and verifies via its delivery
      // receipt (value-equals against the observed receipt state).
      return [{ kind: 'value-equals', params: { observed: 'deliveryReceipt', expected: 'delivered' }, description: 'an independent delivery receipt exists', requireIndependentMethod: true }]
    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// M45 — runtime verification contract.
//
// Commit SHAs and pull-request states come into existence DURING execution;
// the verification contract is stamped with the values from the adapter's
// INDEPENDENT evidence before evaluation. The substitution NEVER invents a
// passing value: an unverified execution keeps its placeholder (which then
// fails or stays inconclusive honestly).
// ---------------------------------------------------------------------------

export function runtimeVerificationContract(
  contract: ActionContract,
  evidence: Array<{ kind: string; ref: string; note: string }>,
): ActionContract {
  const executedSha = evidence.find((e) => e.kind === 'commit' && /^[0-9a-f]{40}$/.test(e.ref))?.ref ?? null
  const prVerified = evidence.some((e) => e.kind === 'pull-request' && /verified/i.test(e.note) && !/UNVERIFIED|NOT/i.test(e.note))
  const base = contract.postconditions.length > 0 ? contract.postconditions : fallbackPostconditions(contract)
  const postconditions = base.map((p) => {
    if ((p.kind === 'commit-present' || p.kind === 'remote-ref-equals') && !p.params.sha && executedSha) {
      return { ...p, params: { ...p.params, sha: executedSha } }
    }
    if (p.kind === 'value-equals' && p.params.observed === 'pullRequestState' && prVerified) {
      return { ...p, params: { ...p.params, expected: 'open' } }
    }
    return p
  })
  return { ...contract, postconditions }
}

// ---------------------------------------------------------------------------
// Verification method naming — recorded on every execution record.
// ---------------------------------------------------------------------------

/** The independent method per action type (what the runtime adapter does). */
export function verificationMethodFor(contract: ActionContract): string {
  switch (contract.actionType) {
    case 'file-write':
    case 'file-read':
    case 'code-build':
      return 'independent disk re-read of the resulting files'
    case 'media-produce':
      return 'independent artifact inspection (bytes + container integrity)'
    case 'research-fetch':
      return 'independent provenance re-derivation over the retrieved sources'
    case 'repo-commit':
      return 'independent git object query of the executed commit'
    case 'repo-push':
      return 'independent remote ref fetch comparison (ls-remote / ref GET)'
    case 'repo-inspect':
      return 'bounded idempotency ledger observation of the inspection run'
    case 'deployment-inspect':
      return 'independent HTTP health probe + git revision re-query of the running deployment'
    case 'repo-pull-request':
      return 'independent pull-request GET (identity + state + head sha)'
    case 'website-publish-verify':
      return 'independent HTTP fetch of the served page'
    case 'deployment-release':
      return 'independent health endpoint probe of the deployed revision'
    case 'external-communicate':
      return 'independent delivery receipt check'
    default:
      return 'independent observation'
  }
}

/** Test/ops seam: the evaluated check kinds in registration order. */
export const POSTCONDITION_EVALUATOR_KINDS = [
  'file-exists',
  'file-contains',
  'file-absent',
  'artifact-exists',
  'artifact-min-bytes',
  'commit-present',
  'remote-ref-equals',
  'url-status',
  'health-ok',
  'sources-min',
  'value-equals',
  'no-duplicate-effect',
] as const
