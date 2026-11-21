/**
 * Milestone E2E receipt seeding — drives the REAL Trust Engine adapters
 * against the REAL database (not mocks) so the receipts UI can be inspected
 * and the shared-ledger behavior verified end-to-end. Every call is a
 * settlement exactly as the workers perform it.
 */
import {
  recordMediaJobFailure,
  recordMediaJobCompletion,
  recordMediaJobCancelled,
} from '../../src/lib/trust/adapters/media'
import { createCodeGiftzBackgroundRecorder } from '../../src/lib/trust/adapters/code-giftz'

async function main() {
  const userId = 'cmwp5g4go0000oeoe46e6mkko'
  const jobId = (s: string) => `e2e-${s}-${Date.now().toString(36)}`

  // 1. LAXII image-generation failure (real class + sanitized reason)
  await recordMediaJobFailure(
    { userId, product: 'laxii', kind: 'image-generation', jobId: jobId('laxii-fail'), backendId: 'bean-image-hosted-primary', requestPreview: 'E2E inspection — a harbor at dawn, watercolor style' },
    { errorCode: 'BACKEND_TIMEOUT', errorClass: 'timeout', errorMessage: 'Generation exceeded the time limit and was stopped.' },
  )
  console.log('seeded: laxii image-generation failure receipt')

  // 2. LAXII enhancement completion with measured preservation facts
  await recordMediaJobCompletion(
    { userId, product: 'laxii', kind: 'image-enhancement', jobId: jobId('laxii-enh'), backendId: 'bean-image-selfhosted-diffusers', requestPreview: 'E2E inspection — sharpen the stars, keep the rest identical' },
    {
      artifactUrl: '/api/laxii/images/e2e-enhancement',
      width: 1024, height: 768, format: 'png', bytes: 512000, durationMs: 3400,
      preservation: { pipeline: 'deterministic-sharp', generativeUsed: false, exactPreservedPct: 96.4, changedPct: 3.6, dimensionsChanged: false, summary: '96.4% bit-exact original pixels preserved' },
      sourceUrl: '/api/laxii/images/e2e-source',
      diffUrl: '/api/laxii/images/e2e-diff',
    },
  )
  console.log('seeded: laxii enhancement completion receipt (measured preservation)')

  // 3. JAZMII video-generation stop-tracking cancellation
  await recordMediaJobCancelled(
    { userId, product: 'jazmii', kind: 'video-generation', jobId: jobId('jazmii-cancel'), backendId: 'bean-video-hosted-primary', requestPreview: 'E2E inspection — a lighthouse in moving fog' },
    'before it finished (stop-tracking: the provider exposes no cancel API, so its upstream task may still complete — BEAN stopped tracking it and no output will be stored)',
  )
  console.log('seeded: jazmii video stop-tracking cancellation receipt')

  // 4. CODE GIFTZ background coding turn — failed before mutations
  const trust = createCodeGiftzBackgroundRecorder({
    userId,
    projectId: 'e2e-project-inspect',
    projectName: 'E2E Inspection Project',
    jobId: jobId('giftz-fail'),
    requestPreview: 'E2E inspection — add a config module with typed defaults',
    filesInspected: 6,
  })
  await trust.begin()
  await trust.failed(
    { code: 'UPSTREAM_RATE_LIMITED', message: 'The coding backend is rate-limited right now (HTTP 429). Try again shortly.' },
    null,
    true,
  )
  console.log('seeded: code-giftz background failed receipt')

  // 5. CODE GIFTZ background coding turn — success with files + version
  const trust2 = createCodeGiftzBackgroundRecorder({
    userId,
    projectId: 'e2e-project-inspect',
    projectName: 'E2E Inspection Project',
    jobId: jobId('giftz-ok'),
    requestPreview: 'E2E inspection — write main.js printing a greeting',
    filesInspected: 6,
  })
  await trust2.begin()
  await trust2.executed({
    changes: [{ path: 'main.js', change: 'added' }, { path: 'src/config.ts', change: 'modified' }],
    versionSeq: 3,
    verification: null,
    verificationSkippedReason: 'self-verification is disabled by the operator configuration',
    continuations: 1,
    durationMs: 18400,
  })
  console.log('seeded: code-giftz background success receipt (unverified → limited)')

  process.exit(0)
}

main().catch((e) => {
  console.error('E2E seeding failed:', e instanceof Error ? e.message : e)
  process.exit(1)
})
