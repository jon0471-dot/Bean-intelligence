import { describe, expect, test } from 'bun:test'

import {
  EXECUTION_LIFECYCLE_ORDER,
  OPERATIONAL_LIFECYCLE_STAGES,
  executionLifecycle,
  executionLifecycleForBackend,
  isOperationalLifecycleStage,
  type ExecutionLifecycleEvidence,
} from '@/lib/registry/capability-records'

/** Evidence that satisfies every gate — the "fully verified" fixture. */
const FULL: ExecutionLifecycleEvidence = {
  discovered: true,
  registered: true,
  compatible: true,
  credentialConfigured: true,
  runtimeInstalled: true,
  hardwareCompatible: true,
  downloadApproved: true,
  integrityVerified: true,
  executionTested: true,
  outputValidated: true,
  operationallyServing: true,
}

describe('M38-B2 execution lifecycle ladder', () => {
  test('ladder contains the exact M38 §B2 stages in order', () => {
    expect([...EXECUTION_LIFECYCLE_ORDER]).toEqual([
      'discovered',
      'registered',
      'compatible',
      'credential-configured',
      'runtime-installed',
      'hardware-compatible',
      'download-approved',
      'integrity-verified',
      'execution-tested',
      'output-validated',
      'operational',
    ])
  })

  test('empty evidence stays at "discovered" — nothing beyond discovery is claimed', () => {
    const r = executionLifecycle({})
    expect(r.stage).toBe('discovered')
    expect(r.blockedBy).toBe('registered')
    expect(r.depth).toBe(0)
    expect(r.explanation).toContain('registered')
    expect(isOperationalLifecycleStage(r.stage)).toBe(false)
  })

  test('explicitly denied discovery reports the bottom of the ladder honestly', () => {
    const r = executionLifecycle({ ...FULL, discovered: false })
    expect(r.stage).toBe('discovered')
    expect(r.blockedBy).toBe('discovered')
    expect(r.explanation).toContain('Nothing beyond discovery')
  })

  test('a gate can never be skipped: unmet integrity caps the stage at download-approved', () => {
    const r = executionLifecycle({ ...FULL, integrityVerified: false })
    expect(r.stage).toBe('download-approved')
    expect(r.blockedBy).toBe('integrity-verified')
    // execution-tested was "claimed" in the evidence but the ladder does not honor it
    expect(isOperationalLifecycleStage(r.stage)).toBe(false)
  })

  test('the last verified stage is the result — for every gate position', () => {
    const keys = Object.keys(FULL) as (keyof ExecutionLifecycleEvidence)[]
    for (let i = 0; i < keys.length; i++) {
      const broken = { ...FULL }
      broken[keys[i]] = false
      const r = executionLifecycle(broken)
      // stage is exactly the last gate satisfied (index i-1); the blocker is gate i
      expect(EXECUTION_LIFECYCLE_ORDER[r.depth]).toBe(r.stage)
      expect(r.depth).toBe(i - 1 >= 0 ? i - 1 : 0)
      const gateRequirement = keys[i].replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
      expect(r.blockedBy).toBe(gateRequirement)
      // no stage beyond the blocked gate may be operational-representable
      if (r.depth < 8) expect(isOperationalLifecycleStage(r.stage)).toBe(false)
    }
  })

  test('fully verified evidence reaches operational with no blocker', () => {
    const r = executionLifecycle(FULL)
    expect(r.stage).toBe('operational')
    expect(r.blockedBy).toBeNull()
    expect(r.depth).toBe(EXECUTION_LIFECYCLE_ORDER.length - 1)
    expect(isOperationalLifecycleStage(r.stage)).toBe(true)
  })

  test('only the terminal verified stages may be represented as operational', () => {
    expect([...OPERATIONAL_LIFECYCLE_STAGES]).toEqual(['execution-tested', 'output-validated', 'operational'])
    for (const stage of EXECUTION_LIFECYCLE_ORDER) {
      expect(isOperationalLifecycleStage(stage)).toBe(
        stage === 'execution-tested' || stage === 'output-validated' || stage === 'operational',
      )
    }
  })

  test('output-validated without operational serving is NOT operational-representable as serving', () => {
    const r = executionLifecycle({ ...FULL, operationallyServing: false })
    expect(r.stage).toBe('output-validated')
    expect(r.blockedBy).toBe('operationally-serving')
  })

  test('execution-tested claims without output validation stop honestly at execution-tested', () => {
    const r = executionLifecycle({ ...FULL, outputValidated: false, operationallyServing: false })
    expect(r.stage).toBe('execution-tested')
    expect(r.blockedBy).toBe('output-validated')
    // execution-tested IS representable (a real run happened and all its gates
    // passed) — but output validation and serving remain honestly unclaimed.
    expect(isOperationalLifecycleStage(r.stage)).toBe(true)
  })
})

describe('M38-B2 lifecycle for registry backends', () => {
  test('unknown backend id claims only discovery', () => {
    const r = executionLifecycleForBackend('bean-not-a-real-backend')
    expect(r.stage).toBe('discovered')
    expect(r.blockedBy).toBe('registered')
    expect(r.explanation).toContain('not present in the private registry')
  })

  test('a registered backend without adapter evidence stops at "registered"', () => {
    // bean-llm-hosted-primary exists in BACKEND_REGISTRY but this convenience
    // call supplies no adapter map — registry presence alone must not prove
    // an executable binding.
    const r = executionLifecycleForBackend('bean-llm-hosted-primary')
    expect(r.stage).toBe('registered')
    expect(r.blockedBy).toBe('compatible')
  })

  test('handler-dispatched backends count as compatible by documented path', () => {
    const r = executionLifecycleForBackend('bean-video-composition-local')
    // compatible gate passes (documented dispatch); the next honest stop is
    // credentials until lane evidence is supplied.
    expect(r.stage).toBe('compatible')
    expect(r.blockedBy).toBe('credential-configured')
  })

  test('lane evidence advances the ladder without bypassing gates', () => {
    // MODNet-style lane: no credentials, runtime installed, hardware ok,
    // download approved, integrity verified (pinned SHA-256), real execution
    // measured, matte validated — but caller does not claim serving here.
    const r = executionLifecycleForBackend('bean-image-local-segmentation', {
      compatible: true,
      credentialConfigured: true,
      runtimeInstalled: true,
      hardwareCompatible: true,
      downloadApproved: true,
      integrityVerified: true,
      executionTested: true,
      outputValidated: true,
    })
    expect(r.stage).toBe('output-validated')
    expect(r.blockedBy).toBe('operationally-serving')
  })

  test('execution-tested without integrity verification is impossible for any lane', () => {
    const r = executionLifecycleForBackend('bean-image-local-segmentation', {
      compatible: true,
      credentialConfigured: true,
      runtimeInstalled: true,
      hardwareCompatible: true,
      downloadApproved: true,
      integrityVerified: false,
      executionTested: true,
      outputValidated: true,
      operationallyServing: true,
    })
    expect(r.stage).toBe('download-approved')
    expect(r.blockedBy).toBe('integrity-verified')
    expect(isOperationalLifecycleStage(r.stage)).toBe(false)
  })
})
