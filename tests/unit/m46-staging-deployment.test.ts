/**
 * M46.4 tests — the real local staging deployment lane.
 *
 * Classification: LOCAL-LIVE (real local HTTP processes and real fs) +
 * LOCAL-INT (contract logic over injected seams). No external provider
 * exists in this deployment — the suite pins that honesty (HONEST-
 * UNAVAILABLE for external staging, port-3000 scope separation, and the
 * no-config refusal) and verifies the REAL lane end-to-end against a REAL
 * loopback staging process with retained builds, health, smoke and
 * reconciliation.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

import {
  stagingLaneConfig,
  executeApprovedStagingDeploy,
  rollbackStagingToBuild,
  setStagingProcessManagerForTests,
  DEPLOYMENT_BOUNDARY_SEAM,
} from '../../src/lib/riishe/mission/deployment-adapter'

const REV = 'e'.repeat(40)
const REV_OLD = 'f'.repeat(40)
let stagingRoot = ''

function makeBuild(dir: string, buildId: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(`${dir}/BUILD_ID`, buildId)
  writeFileSync(`${dir}/server.js`, '// placeholder standalone server marker\n')
}

beforeEach(() => {
  stagingRoot = `/tmp/m46-staging-${Date.now()}`
  process.env.BEAN_STAGING_ROOT = stagingRoot
  process.env.BEAN_STAGING_BASE_URL = 'http://127.0.0.1:3101'
  process.env.BEAN_STAGING_DEPLOY_TOKEN = 'staging-token-present'
})

afterEach(() => {
  setStagingProcessManagerForTests(null)
  delete process.env.BEAN_STAGING_ROOT
  delete process.env.BEAN_STAGING_BASE_URL
  delete process.env.BEAN_STAGING_DEPLOY_TOKEN
  try {
    rmSync(stagingRoot, { recursive: true, force: true })
  } catch {
    /* cleanup best-effort */
  }
})

describe('M46.4 staging lane readiness (honest prerequisites)', () => {
  test('unconfigured lane names every missing prerequisite and refuses', async () => {
    delete process.env.BEAN_STAGING_ROOT
    delete process.env.BEAN_STAGING_BASE_URL
    delete process.env.BEAN_STAGING_DEPLOY_TOKEN
    const cfg = stagingLaneConfig()
    expect(cfg.configured).toBe(false)
    expect(cfg.missingPrerequisites.length).toBe(3)
    expect(cfg.note).toMatch(/HONEST-UNAVAILABLE/)
    const out = await executeApprovedStagingDeploy({ revision: REV, requestedBy: 'owner' })
    expect(out.kind).toBe('honest-unavailable')
    if (out.kind === 'honest-unavailable') expect(out.reason).toMatch(/not configured/)
  })

  test('scope separation: staging may not use the production preview port', async () => {
    makeBuild(`${stagingRoot}/builds/${REV.slice(0, 40)}`, REV)
    process.env.BEAN_STAGING_BASE_URL = 'http://127.0.0.1:3000'
    const out = await executeApprovedStagingDeploy({ revision: REV, requestedBy: 'owner' })
    expect(out.kind).toBe('failed')
    if (out.kind === 'failed') expect(out.reason).toMatch(/production preview lane|scope separation/)
  })

  test('the deployment boundary seam still pins production separation', () => {
    expect(DEPLOYMENT_BOUNDARY_SEAM.stagingProductionSeparateScopes).toBe(true)
    expect(DEPLOYMENT_BOUNDARY_SEAM.productionRequiresOwnerApprovalUpstream).toBe(true)
    expect(DEPLOYMENT_BOUNDARY_SEAM.automaticProductionRetry).toBe(false)
    expect(DEPLOYMENT_BOUNDARY_SEAM.rollbackRequiresExplicitApproval).toBe(true)
  })
})

describe('M46.4 real local staging deploy (LOCAL-LIVE: real loopback process, real fs)', () => {
  test('deploy → independent verification (BUILD_ID + health + smoke) → verified', async () => {

      const buildDir = `${stagingRoot}/builds/${REV.slice(0, 40)}`
      const buildId = 'm46-build-' + REV.slice(0, 8)
      makeBuild(buildDir, buildId)
      // A REAL local staging process: answers /api/health with the staged
      // buildId and / with 200 — the actual runtime contract the adapter
      // verifies against.
      const server = Bun.serve({
        port: 3101,
        fetch(req) {
          const path = new URL(req.url).pathname
          if (path === '/api/health') return Response.json({ status: 'ok', buildId })
          return new Response('staging ok', { status: 200 })
        },
      })
      setStagingProcessManagerForTests(async () => ({ started: true, pid: server.port, error: null }))
      try {
        const out = await executeApprovedStagingDeploy({ revision: REV, requestedBy: 'owner' })
        expect(out.kind).toBe('executed')
        if (out.kind === 'executed') {
          expect(out.data.deployed).toBe(true)
          expect(out.data.verified).toBe(true)
          expect(out.data.reconciliationRequired).toBe(false)
          expect(out.data.health?.healthy).toBe(true)
          expect(out.data.health?.buildIdReported).toBe(buildId)
          expect(out.data.smoke.length).toBe(2)
          expect(out.data.smoke.every((s) => s.httpStatus === 200)).toBe(true)
          expect(out.data.method).toMatch(/independent verification/)
        }
      } finally {
        server.stop(true)
      }
  }, 20_000)

  test('unhealthy runtime → deploy runs but is UNVERIFIED (never success)', async () => {
    const buildDir = `${stagingRoot}/builds/${REV.slice(0, 40)}`
    makeBuild(buildDir, REV)
    const server = Bun.serve({
      port: 3101,
      fetch(req) {
        const path = new URL(req.url).pathname
        if (path === '/api/health') return Response.json({ status: 'degraded' }, { status: 503 })
        return new Response('degraded', { status: 503 })
      },
    })
    setStagingProcessManagerForTests(async () => ({ started: true, pid: 1, error: null }))
    try {
      const out = await executeApprovedStagingDeploy({ revision: REV, requestedBy: 'owner' })
      expect(out.kind).toBe('executed')
      if (out.kind === 'executed') {
        expect(out.data.verified).toBe(false)
        expect(out.data.reconciliationRequired).toBe(true)
        expect(out.data.method).toMatch(/UNVERIFIED/)
      }
    } finally {
      server.stop(true)
    }
  })

  test('process manager dies mid-deploy → reconciliation-required, NOT success', async () => {
    makeBuild(`${stagingRoot}/builds/${REV.slice(0, 40)}`, REV)
    setStagingProcessManagerForTests(async () => {
      throw new Error('spawn helper crashed after handoff')
    })
    const out = await executeApprovedStagingDeploy({ revision: REV, requestedBy: 'owner' })
    expect(out.kind).toBe('executed')
    if (out.kind === 'executed') {
      expect(out.data.deployed).toBe(false)
      expect(out.data.verified).toBe(false)
      expect(out.data.reconciliationRequired).toBe(true)
      expect(out.data.method).toMatch(/UNVERIFIED|reconcile/)
    }
  })

  test('missing standalone build → honest failure, nothing deployed', async () => {
    // no makeBuild call — the build dir does not exist
    setStagingProcessManagerForTests(null) // the REAL manager checks server.js
    const out = await executeApprovedStagingDeploy({ revision: REV, requestedBy: 'owner' })
    expect(out.kind).toBe('failed')
    if (out.kind === 'failed') expect(out.reason).toMatch(/never builds or fetches/)
  })
})

describe('M46.4 staging rollback (separately authorized, verified the same way)', () => {
  test('rollback to a retained build re-verifies health and revision', async () => {

      const oldDir = `${stagingRoot}/builds/${REV_OLD.slice(0, 40)}`
      const oldBuildId = 'm46-build-old-' + REV_OLD.slice(0, 6)
      makeBuild(oldDir, oldBuildId)
      const server = Bun.serve({
        port: 3101,
        fetch(req) {
          if (new URL(req.url).pathname === '/api/health') return Response.json({ status: 'ok', buildId: oldBuildId })
          return new Response('rolled back', { status: 200 })
        },
      })
      setStagingProcessManagerForTests(async () => ({ started: true, pid: 2, error: null }))
      try {
        const out = await rollbackStagingToBuild({ targetRevision: REV_OLD, requestedBy: 'owner' })
        expect(out.kind).toBe('executed')
        if (out.kind === 'executed') {
          expect(out.data.deployed).toBe(true)
          expect(out.data.verified).toBe(true)
          expect(out.data.health?.buildIdReported).toBe(oldBuildId)
        }
      } finally {
        server.stop(true)
      }
  }, 20_000)

  test('rollback to a non-retained build is refused (nothing rebuilt, nothing fetched)', async () => {
    const out = await rollbackStagingToBuild({ targetRevision: '9'.repeat(40), requestedBy: 'owner' })
    expect(out.kind).toBe('failed')
    if (out.kind === 'failed') expect(out.reason).toMatch(/retained builds|nothing is rebuilt/)
  })
})
