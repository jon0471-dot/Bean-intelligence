/**
 * M45 Phase 4 tests — the deployment adapter.
 *
 * Classification: LOCAL INTEGRATION TESTS — the health probe runs against a
 * REAL local HTTP server (Bun.serve) and config/revision inspection reads
 * the REAL deployment root. No external provider is contacted; the
 * honest-unavailability of provider history/staging execution is pinned as
 * behavior (that honesty IS the contract in this deployment).
 */
import { describe, test, expect, afterAll } from 'bun:test'

import {
  inspectDeploymentConfig,
  inspectDeployedRevision,
  inspectDeploymentHistory,
  probeRuntimeHealth,
  inspectDeploymentLogs,
  executeApprovedDeployment,
  DEPLOYMENT_BOUNDARY_SEAM,
} from '../../src/lib/riishe/mission/deployment-adapter'
import { dispatchDeploymentInspection, dispatchDeploymentRelease } from '../../src/lib/riishe/mission/action-runner'

// A REAL local HTTP server for the health probe (live loopback traffic).
let healthyBuild = 'build-abc-123'
const server = Bun.serve({
  port: 0,
  fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/api/health') {
      return Response.json({ status: 'ok', buildId: healthyBuild })
    }
    if (url.pathname === '/unhealthy') {
      return Response.json({ status: 'degraded', buildId: healthyBuild }, { status: 503 })
    }
    return new Response('nope', { status: 404 })
  },
})

afterAll(() => {
  server.stop(true)
})

describe('M45 deployment inspection (local integration)', () => {
  test('config inspection reads the REAL deployment root honestly', async () => {
    const out = await inspectDeploymentConfig()
    expect(out.kind).toBe('executed')
    if (out.kind === 'executed') {
      expect(out.data.scope).toBe('local-preview')
      expect(out.data.provider).toBeNull()
      // The repo carries a Caddyfile reverse-proxying localhost:3000.
      expect(typeof out.data.caddyPresent).toBe('boolean')
      expect(typeof out.data.buildCommandPresent).toBe('boolean')
    }
  })

  test('revision inspection identifies build + serving commit via an independent git query', async () => {
    const out = await inspectDeployedRevision()
    expect(out.kind).toBe('executed')
    if (out.kind === 'executed') {
      // Either a real sha (git available) or an honest null — never invented.
      expect(out.data.servingCommitSha === null || /^[0-9a-f]{40}$/.test(out.data.servingCommitSha)).toBe(true)
      expect(out.data.method).toContain('independent')
    }
  })

  test('the health probe reports the REAL status of a REAL local server (healthy)', async () => {
    const prev = process.env.BEAN_DEPLOY_BASE_URL
    process.env.BEAN_DEPLOY_BASE_URL = `http://localhost:${server.port}`
    try {
      const out = await probeRuntimeHealth('/api/health')
      expect(out.kind).toBe('executed')
      if (out.kind === 'executed') {
        expect(out.data.httpStatus).toBe(200)
        expect(out.data.healthy).toBe(true)
        expect(out.data.buildIdReported).toBe(healthyBuild)
      }
    } finally {
      if (prev === undefined) delete process.env.BEAN_DEPLOY_BASE_URL
      else process.env.BEAN_DEPLOY_BASE_URL = prev
    }
  })

  test('an UNHEALTHY runtime is reported unhealthy (never converted to success)', async () => {
    const prev = process.env.BEAN_DEPLOY_BASE_URL
    process.env.BEAN_DEPLOY_BASE_URL = `http://localhost:${server.port}`
    try {
      const out = await probeRuntimeHealth('/unhealthy')
      expect(out.kind).toBe('executed')
      if (out.kind === 'executed') {
        expect(out.data.httpStatus).toBe(503)
        expect(out.data.healthy).toBe(false)
      }
    } finally {
      if (prev === undefined) delete process.env.BEAN_DEPLOY_BASE_URL
      else process.env.BEAN_DEPLOY_BASE_URL = prev
    }
  })

  test('an unreachable runtime reports healthy=null (honest, never a pass)', async () => {
    const prev = process.env.BEAN_DEPLOY_BASE_URL
    process.env.BEAN_DEPLOY_BASE_URL = 'http://localhost:9' // discard port — closed
    try {
      const out = await probeRuntimeHealth('/api/health')
      expect(out.kind).toBe('executed')
      if (out.kind === 'executed') expect(out.data.healthy).toBeNull()
    } finally {
      if (prev === undefined) delete process.env.BEAN_DEPLOY_BASE_URL
      else process.env.BEAN_DEPLOY_BASE_URL = prev
    }
  })

  test('provider history is honestly unavailable when no provider is configured', async () => {
    const prevProvider = process.env.BEAN_DEPLOY_PROVIDER
    const prevToken = process.env.BEAN_DEPLOY_TOKEN
    delete process.env.BEAN_DEPLOY_PROVIDER
    delete process.env.BEAN_DEPLOY_TOKEN
    try {
      const out = await inspectDeploymentHistory()
      expect(out.kind).toBe('honest-unavailable')
      if (out.kind === 'honest-unavailable') expect(out.reason).toContain('provider')
    } finally {
      if (prevProvider !== undefined) process.env.BEAN_DEPLOY_PROVIDER = prevProvider
      if (prevToken !== undefined) process.env.BEAN_DEPLOY_TOKEN = prevToken
    }
  })
})

describe('M45 deployment boundaries', () => {
  test('staging execution is honestly unavailable without infrastructure', async () => {
    const prev = process.env.BEAN_STAGING_DEPLOY_TOKEN
    delete process.env.BEAN_STAGING_DEPLOY_TOKEN
    try {
      const out = await executeApprovedDeployment({ revision: 'a'.repeat(40), scope: 'staging', requestedBy: 'test' })
      expect(out.kind).toBe('honest-unavailable')
      if (out.kind === 'honest-unavailable') expect(out.reason).toContain('never simulated')
    } finally {
      if (prev !== undefined) process.env.BEAN_STAGING_DEPLOY_TOKEN = prev
    }
  })

  test('production execution is refused outright when not explicitly enabled', async () => {
    const prev = process.env.BEAN_PRODUCTION_DEPLOY_ENABLED
    delete process.env.BEAN_PRODUCTION_DEPLOY_ENABLED
    try {
      const out = await executeApprovedDeployment({ revision: 'a'.repeat(40), scope: 'production', requestedBy: 'test' })
      expect(out.kind).toBe('failed')
      if (out.kind === 'failed') expect(out.reason).toContain('Production deployment is disabled')
    } finally {
      if (prev !== undefined) process.env.BEAN_PRODUCTION_DEPLOY_ENABLED = prev
    }
  })

  test('the boundary seam pins the invariants', () => {
    expect(DEPLOYMENT_BOUNDARY_SEAM.stagingProductionSeparateScopes).toBe(true)
    expect(DEPLOYMENT_BOUNDARY_SEAM.productionRequiresOwnerApprovalUpstream).toBe(true)
    expect(DEPLOYMENT_BOUNDARY_SEAM.automaticProductionRetry).toBe(false)
    expect(DEPLOYMENT_BOUNDARY_SEAM.dnsDomainBillingChanges).toBe(false)
    expect(DEPLOYMENT_BOUNDARY_SEAM.rollbackRequiresExplicitApproval).toBe(true)
  })
})

describe('M45 deployment dispatch through the runner', () => {
  test('deployment-inspect routes by operation and reports honestly', async () => {
    const out = await dispatchDeploymentInspection({ actionType: 'deployment-inspect', params: { operation: 'revision' }, id: 'd1', description: 'inspect revision' })
    expect(out.kind).toBe('executed')
    if (out.kind === 'executed') expect(out.resultSummary).toContain('Deployed revision')

    const cfg = await dispatchDeploymentInspection({ actionType: 'deployment-inspect', params: { operation: 'config' }, id: 'd2', description: 'inspect config' })
    expect(cfg.kind).toBe('executed')

    const hist = await dispatchDeploymentInspection({ actionType: 'deployment-inspect', params: { operation: 'history' }, id: 'd3', description: 'inspect history' })
    expect(hist.kind).toBe('honest-unavailable')
  })

  test('an approved deployment-release without infrastructure is honest-unavailable, never success-shaped', async () => {
    const prev = process.env.BEAN_STAGING_DEPLOY_TOKEN
    delete process.env.BEAN_STAGING_DEPLOY_TOKEN
    try {
      const out = await dispatchDeploymentRelease({ actionType: 'deployment-release', params: { revision: 'b'.repeat(40), scope: 'staging' }, id: 'd4', description: 'deploy staging' })
      expect(out.kind).toBe('honest-unavailable')
    } finally {
      if (prev !== undefined) process.env.BEAN_STAGING_DEPLOY_TOKEN = prev
    }
  })

  test('log inspection fails honestly when no log file exists (or reports filtered content)', async () => {
    const out = await inspectDeploymentLogs(5)
    // Either state is honest; the excerpt must never contain raw secrets.
    if (out.kind === 'executed') {
      expect(out.data.excerpt).not.toMatch(/sk-[A-Za-z0-9_-]{8,}/)
      expect(out.data.excerpt).not.toMatch(/gh[pousr]_[A-Za-z0-9]{20,}/)
    } else {
      expect(out.kind).toBe('failed')
    }
  })
})
