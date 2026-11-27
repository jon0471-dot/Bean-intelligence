/**
 * M44 Phase 7 — the shared verified-action runner (units over fakes).
 *
 * Covers: dependency-ordered execution, gate enforcement inside the runner
 * (blocked / awaiting-approval), approval consumption recording, REAL
 * file-write with independent re-read verification, REAL research-fetch with
 * provenance verification, HONEST UNAVAILABILITY for action types without a
 * real execution path (never simulated, never success-shaped), the false
 * tool success detected by independent verification, cancellation, and the
 * observation adapters.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'

import {
  buildActionContract,
  buildActionPlan,
  type ActionContract,
} from '../../src/lib/riishe/mission/action-contract'
import {
  runActionPlan,
  dispatchAction,
  executionOrder,
  setActionResearchRunnerForTests,
  type ActionFileStore,
} from '../../src/lib/riishe/mission/action-runner'
import { observationFromFiles, observationFromIdempotency, observationFromResearch } from '../../src/lib/riishe/mission/observations'
import { verifyPostconditions } from '../../src/lib/riishe/mission/outcome-verification'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function memoryStore(seed: Record<string, string> = {}): ActionFileStore & { files: Map<string, string> } {
  const files = new Map(Object.entries(seed))
  return {
    files,
    async read(_projectId, path) {
      const content = files.get(path)
      return content === undefined ? null : { path, content }
    },
    async readAll(_projectId) {
      return [...files.entries()].map(([path, content]) => ({ path, content }))
    },
    async write(_projectId, path, content) {
      files.set(path, content)
    },
  }
}

function writeAction(extra: Partial<Parameters<typeof buildActionContract>[0]> = {}): ActionContract {
  return buildActionContract({
    id: 'write-config',
    actionType: 'file-write',
    title: 'Write the deployment config',
    description: 'Persist the reviewed deployment config into the user project',
    params: { path: 'deploy/config.yaml', content: 'region: eu-central\nreplicas: 2' },
    authScope: 'project-write',
    idempotencyKey: 'write:deploy-config:v1',
    postconditions: [
      { kind: 'file-exists', params: { path: 'deploy/config.yaml' }, description: 'the config file exists', requireIndependentMethod: true },
      { kind: 'file-contains', params: { path: 'deploy/config.yaml', text: 'region: eu-central' }, description: 'the config pins the approved region', requireIndependentMethod: true },
    ],
    ...extra,
  })
}

const IDENTITY = { identity: 'runner-agent', scopes: ['project-write', 'asset-create', 'retrieval-read'] }

beforeEach(() => {
  setActionResearchRunnerForTests(null)
})

describe('m44 runner: real file-write with independent verification', () => {
  test('an authorized reversible write succeeds ONLY through VERIFYING', async () => {
    const store = memoryStore()
    const contract = writeAction()
    const plan = buildActionPlan('Persist the reviewed deployment config', [contract])
    const recorded: string[] = []
    const result = await runActionPlan({
      plan,
      identity: IDENTITY,
      grantor: null,
      trustTaskId: null,
      approvals: [],
      cancelRequested: false,
      projectId: 'p1',
      store,
      onRecord: (r) => {
        recorded.push(r.state)
      },
    })
    expect(result.status).toBe('completed')
    const final = result.records[0]
    expect(final.state).toBe('SUCCEEDED')
    expect(final.verificationVerdict).toBe('confirmed')
    expect(final.verificationMethod).toMatch(/disk re-read/)
    expect(recorded.join('→')).not.toMatch(/EXECUTING→SUCCEEDED/)
    // The real effect exists in the store (independently re-checkable).
    expect(store.files.get('deploy/config.yaml')).toContain('eu-central')
    expect(result.summary).toMatch(/1\/1 action/)
  })

  test('a write that does not produce the declared content ends FAILED', async () => {
    const brokenStore = memoryStore()
    // Sabotage the real path AFTER dispatch: wrap write to drop the content.
    const sabotaged: ActionFileStore = {
      async read(p, path) {
        return path === 'deploy/config.yaml' ? { path, content: 'region: us-east' } : null
      },
      async readAll() {
        return []
      },
      async write() {
        brokenStore.files.set('deploy/config.yaml', 'region: us-east')
      },
    }
    const contract = writeAction()
    const plan = buildActionPlan('Persist the reviewed deployment config', [contract])
    const result = await runActionPlan({
      plan,
      identity: IDENTITY,
      grantor: null,
      trustTaskId: null,
      approvals: [],
      cancelRequested: false,
      projectId: 'p1',
      store: sabotaged,
    })
    expect(result.status).toBe('failed')
    expect(result.records[0].state).toBe('FAILED')
    expect(result.records[0].verificationVerdict).toBe('failed')
    expect(result.records[0].resultSummary).toMatch(/Wrote/)
  })

  test('out-of-scope identity is blocked before any write happens', async () => {
    const store = memoryStore()
    const contract = writeAction()
    const plan = buildActionPlan('Persist the reviewed deployment config', [contract])
    const result = await runActionPlan({
      plan,
      identity: { identity: 'limited-agent', scopes: [] },
      grantor: null,
      trustTaskId: null,
      approvals: [],
      cancelRequested: false,
      projectId: 'p1',
      store,
    })
    expect(result.status).toBe('blocked')
    expect(result.records[0].state).toBe('BLOCKED')
    expect(store.files.size).toBe(0)
  })

  test('policy self-modification shapes are blocked before the gate', async () => {
    const store = memoryStore()
    const evil = writeAction({
      id: 'evil-write',
      params: { path: 'deploy/config.yaml', content: 'allowMissionDelegation=true' },
    })
    const plan = buildActionPlan('Persist the config', [evil])
    const result = await runActionPlan({
      plan,
      identity: IDENTITY,
      grantor: null,
      trustTaskId: null,
      approvals: [],
      cancelRequested: false,
      projectId: 'p1',
      store,
    })
    expect(result.status).toBe('blocked')
    expect(result.records[0].note).toMatch(/safety polic|grant permissions/)
    expect(store.files.size).toBe(0)
  })
})

describe('m44 runner: approvals and honest unavailability', () => {
  test('a human-class action without approval lands in awaiting-approval with a bound digest', async () => {
    const contract = buildActionContract({
      id: 'push-branch',
      actionType: 'repo-push',
      title: 'Push the reviewed branch',
      description: 'Publish the reviewed migration branch to the remote',
      params: { sha: 'abc123def456' },
      authScope: 'project-write',
      idempotencyKey: 'push:feat-x:v1',
    })
    const plan = buildActionPlan('Publish the migration', [contract])
    const result = await runActionPlan({
      plan,
      identity: IDENTITY,
      grantor: null,
      trustTaskId: null,
      approvals: [],
      cancelRequested: false,
      projectId: 'p1',
      store: memoryStore(),
    })
    expect(result.status).toBe('awaiting-approval')
    expect(result.approvalsRequested).toHaveLength(1)
    expect(result.approvalsRequested[0].approvalDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(result.records[0].state).toBe('AWAITING_APPROVAL')
    expect(result.records[0].note).toMatch(/Awaiting owner approval/)
  })

  test('an approval-gated action with a valid granted approval STILL refuses honestly when no real path exists', async () => {
    const contract = buildActionContract({
      id: 'push-branch',
      actionType: 'repo-push',
      title: 'Push the reviewed branch',
      description: 'Publish the reviewed migration branch to the remote',
      params: { sha: 'abc123def456' },
      authScope: 'project-write',
      idempotencyKey: 'push:feat-x:v1',
    })
    const plan = buildActionPlan('Publish the migration', [contract])
    const payload = {
      m44: 'action-approval' as const,
      actionType: contract.actionType,
      title: contract.title,
      description: contract.description,
      params: contract.params,
      authScope: contract.authScope,
      riskClass: contract.riskClass,
      reversibility: contract.reversibility,
      idempotencyKey: contract.idempotencyKey,
      planVersion: plan.planVersion,
      planDigest: plan.digest,
      actionId: contract.id,
    }
    const { approvalDigest } = await import('../../src/lib/riishe/mission/authorization')
    const result = await runActionPlan({
      plan,
      identity: IDENTITY,
      grantor: null,
      trustTaskId: null,
      approvals: [{ id: 'ap1', actionDigest: approvalDigest(payload), actionJson: JSON.stringify(payload), status: 'granted' }],
      cancelRequested: false,
      projectId: 'p1',
      store: memoryStore(),
    })
    expect(result.status).toBe('failed')
    expect(result.records[0].state).toBe('FAILED')
    expect(result.records[0].note).toMatch(/not simulated/)
    expect(result.records[0].verificationVerdict).toBeNull()
  })

  test('cancellation stops the plan before the next action', async () => {
    const store = memoryStore()
    const first = writeAction()
    const second = writeAction({ id: 'write-second', params: { path: 'deploy/second.yaml', content: 'x: 1' }, idempotencyKey: 'write:second:v1' })
    second.dependsOn.length = 0
    const plan = buildActionPlan('Persist two configs', [first, second])
    const result = await runActionPlan({
      plan,
      identity: IDENTITY,
      grantor: null,
      trustTaskId: null,
      approvals: [],
      cancelRequested: true,
      projectId: 'p1',
      store,
    })
    expect(result.status).toBe('cancelled')
    expect(result.records).toHaveLength(0)
  })

  test('execution order respects dependencies', () => {
    const a = writeAction()
    const b = writeAction({ id: 'write-b', idempotencyKey: 'k:b', dependsOn: ['write-config'] })
    const c = writeAction({ id: 'write-c', idempotencyKey: 'k:c', dependsOn: ['write-b'] })
    const plan = buildActionPlan('Chain', [c, a, b])
    expect(executionOrder(plan)).toEqual(['write-config', 'write-b', 'write-c'])
  })
})

describe('m44 runner: real research lane with provenance verification', () => {
  test('research-fetch verifies distinct sources independently', async () => {
    setActionResearchRunnerForTests({ run: async () => ({
      sources: [
        { url: 'https://a.example/1', title: 'Source A' },
        { url: 'https://b.example/2', title: 'Source B' },
        { url: 'https://c.example/3', title: 'Source C' },
      ],
      degraded: [],
    }) })
    const contract = buildActionContract({
      id: 'gather-sources',
      actionType: 'research-fetch',
      title: 'Gather cited evidence',
      description: 'Research the migration topic and collect real attributable sources',
      params: { objective: 'Gather sources on zero-downtime warehouse migrations' },
      authScope: 'retrieval-read',
    })
    const plan = buildActionPlan('Gather evidence for the migration decision', [contract])
    const result = await runActionPlan({
      plan,
      identity: { identity: 'research-agent', scopes: ['retrieval-read'] },
      grantor: null,
      trustTaskId: null,
      approvals: [],
      cancelRequested: false,
      store: memoryStore(),
    })
    // No explicit postconditions: the research fallback (sources-min over the
    // read-only idempotency note) is an honest no-op check, so the run
    // verifies through it — read-only work never claims artifact success.
    expect(result.status).toBe('completed')
    expect(result.records[0].state).toBe('SUCCEEDED')
    expect(result.records[0].resultSummary).toMatch(/3 source/)
  })

  test('a duplicate-source pack fails a declared distinct-sources postcondition', async () => {
    setActionResearchRunnerForTests({ run: async () => ({
      sources: [
        { url: 'https://a.example/1', title: 'Source A' },
        { url: 'https://a.example/1', title: 'Source A (mirror)' },
      ],
      degraded: [],
    }) })
    const contract = buildActionContract({
      id: 'gather-sources',
      actionType: 'research-fetch',
      title: 'Gather cited evidence',
      description: 'Research the migration topic and collect real attributable sources',
      params: { objective: 'Gather sources on warehouse migrations' },
      authScope: 'retrieval-read',
      postconditions: [
        { kind: 'sources-min', params: { minSources: '3' }, description: 'at least three distinct sources', requireIndependentMethod: true },
      ],
    })
    const plan = buildActionPlan('Gather evidence', [contract])
    const result = await runActionPlan({
      plan,
      identity: { identity: 'research-agent', scopes: ['retrieval-read'] },
      grantor: null,
      trustTaskId: null,
      approvals: [],
      cancelRequested: false,
      store: memoryStore(),
    })
    expect(result.status).toBe('failed')
    expect(result.records[0].state).toBe('FAILED')
  })

  test('dispatchAction refuses unknown types', async () => {
    const outcome = await dispatchAction({ actionType: 'quantum-tunnel', params: {}, id: 'x', description: 'd' }, memoryStore())
    expect(outcome.kind).toBe('failed')
  })
})

describe('m44 observations: adapters', () => {
  test('file observations mark absent paths as not existing', () => {
    const obs = observationFromFiles([{ path: 'a.txt', content: 'hello' }], ['a.txt', 'missing.txt'])
    expect(obs!['a.txt']).toEqual({ exists: true, bytes: 5, text: 'hello' })
    expect(obs!['missing.txt']).toEqual({ exists: false, bytes: 0 })
  })

  test('research observations carry sources through', () => {
    const obs = observationFromResearch([{ url: 'https://a', title: 'A' }])
    expect(obs.sources).toHaveLength(1)
  })

  test('idempotency observations shape the ledger read', () => {
    const obs = observationFromIdempotency([{ key: 'k', runCount: 2 }])
    expect(obs!['k'].runCount).toBe(2)
  })

  test('verdict uses the observation set, not the execution claim', () => {
    const contract = writeAction()
    const verdict = verifyPostconditions(contract, {
      fileSystem: observationFromFiles([{ path: 'deploy/config.yaml', content: 'region: us-east' }], ['deploy/config.yaml']),
    })
    expect(verdict.verdict).toBe('failed')
  })
})
