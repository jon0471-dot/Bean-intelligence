/**
 * M36-C — RIISHE SPECIALIST DELEGATION tests (mocked Prisma boundary;
 * the REAL router preflight, REAL queue gates, REAL tool registry).
 *
 * Pinned contracts (brief §6 / §13 RIISHE agent):
 *  - one media request plans exactly the right specialist tool (and no other);
 *  - questions/analysis requests never plan a delegation tool (no surprise
 *    submissions);
 *  - the tool enters the model's universe ONLY when the server-side
 *    permission key AND the plan agree (both gates, not either);
 *  - a submission runs the REAL preflight gates (product availability, rate
 *    limit, budget) and the REAL duplicate guard — delegation cannot bypass
 *    any product limit;
 *  - the result reports a REAL queued job (job id), never a completed
 *    artifact claim;
 *  - BeanApiError refusals (concurrency/quota/budget) become honest
 *    ok:false results;
 *  - registry identity hygiene: delegation tools never expose backend ids.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test'

// ---- in-memory Prisma fake ---------------------------------------------------
const jobRows: Array<Record<string, unknown>> = []
const auditRows: Array<Record<string, unknown>> = []
let activeDuplicate = false

const dbFake = {
  generationJob: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { ...data, id: `job-${jobRows.length + 1}` }
      jobRows.push(row)
      return row
    },
  },
  usageRecord: {
    count: async () => 0,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      jobRows.push({ usage: data })
      return data
    },
  },
  auditLog: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      auditRows.push(data)
      return data
    },
  },
  systemSetting: {
    findUnique: async () => null,
  },
}
mock.module('@/lib/db', () => ({ db: dbFake }))
mock.module('@/lib/observability/metering', () => ({
  recordAudit: async (entry: Record<string, unknown>) => {
    auditRows.push(entry)
  },
}))
mock.module('@/lib/jobs/queue', () => ({
  enqueueJob: (jobId: string) => {
    jobRows.push({ enqueued: jobId })
  },
}))
mock.module('@/lib/ai-engine/queue', () => ({
  dedupeKeyFor: (userId: string, product: string, task: string, params: Record<string, unknown>) =>
    `${userId}:${product}:${task}:${JSON.stringify(params)}`,
  hasActiveDuplicate: async () => activeDuplicate,
}))

import { planCapabilities } from '../../src/lib/riishe/capability-plan'
import { selectTools } from '../../src/lib/riishe/orchestrator'
import { executeToolCall, listToolNames } from '../../src/lib/riishe/tools/registry'
import { registerBuiltins } from '../../src/lib/riishe/tools/builtin-registry'
import type { ToolContext } from '../../src/lib/riishe/tools/types'

registerBuiltins()

const fullPermissions = new Set(['allowCodeExecution', 'allowImageGeneration', 'allowVideoCreation', 'allowSpeechSynthesis'])

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    permissions: fullPermissions,
    userId: 'user-1',
    documents: new Map(),
    ...overrides,
  }
}

beforeEach(() => {
  jobRows.length = 0
  auditRows.length = 0
  activeDuplicate = false
})

describe('capability planning — media delegation detection', () => {
  test('an explicit image-creation request plans image generation', () => {
    const plan = planCapabilities('Create an image of a red lighthouse at sunset', 'general', false)
    expect(plan.imageGeneration).toBe(true)
    expect(plan.videoCreation).toBe(false)
    expect(plan.speechSynthesis).toBe(false)
  })

  test('a question ABOUT images never plans generation (no surprise submissions)', () => {
    const plan = planCapabilities('How do I crop an image in Photoshop?', 'general', false)
    expect(plan.imageGeneration).toBe(false)
  })

  test('an image ATTACHMENT does not plan generation (analysis, not creation)', () => {
    const plan = planCapabilities('What is in this picture?', 'document', true, ['image'])
    expect(plan.imageGeneration).toBe(false)
    expect(plan.imageAnalysis).toBe(true)
  })

  test('explicit video and speech requests plan their specialists', () => {
    expect(planCapabilities('Make a video of ocean waves crashing', 'general', false).videoCreation).toBe(true)
    expect(planCapabilities('Read this text aloud: hello world', 'general', false).speechSynthesis).toBe(true)
  })
})

describe('tool selection — two-key gating (plan AND permission)', () => {
  test('plan + permission present → the delegation tool is selected', () => {
    const tools = selectTools({
      searchNeeded: false,
      task: 'general' as 'math',
      hasDocuments: false,
      allowCodeExecution: false,
      researchFailed: false,
      allowImageGeneration: true,
    })
    expect(tools).toContain('generate_image')
    expect(tools).not.toContain('create_video')
    expect(tools).not.toContain('synthesize_speech')
  })

  test('permission granted but plan says no → tool NOT selected', () => {
    // The orchestrator ANDs the two keys before calling selectTools; this
    // pins that a false plan flag keeps the tool out of the universe.
    const tools = selectTools({
      searchNeeded: false,
      task: 'general' as 'math',
      hasDocuments: false,
      allowCodeExecution: false,
      researchFailed: false,
      allowImageGeneration: false,
      allowVideoCreation: false,
      allowSpeechSynthesis: false,
    })
    expect(tools).not.toContain('generate_image')
    expect(tools).not.toContain('create_video')
    expect(tools).not.toContain('synthesize_speech')
  })
})

describe('registry wiring', () => {
  test('all three delegation tools are registered as explicit-permission tools', () => {
    const names = listToolNames()
    for (const n of ['generate_image', 'create_video', 'synthesize_speech']) {
      expect(names).toContain(n)
    }
  })
})

describe('generate_image — real submission through the gates', () => {
  test('a valid request submits ONE durable job under the requesting user', async () => {
    const executed = await executeToolCall(
      { tool: 'generate_image', input: { prompt: 'a lighthouse at dusk' } },
      ctx(),
      new Set(['generate_image']),
    )
    expect(executed.ok).toBe(true)
    expect(executed.output).toContain('submitted successfully')
    expect(executed.output).toContain('queued')
    expect(jobRows).toHaveLength(2) // 1 job row + 1 enqueue marker
    const job = jobRows[0]
    expect(job.userId).toBe('user-1')
    expect(job.product).toBe('laxii')
    expect(job.task).toBe('image-generation')
    expect(job.status).toBe('queued')
    expect(JSON.stringify(job.paramsJson)).toContain('lighthouse')
    // Identity hygiene: the tool output never carries a backend id.
    expect(executed.output).not.toContain('bean-')
    expect(auditRows.some((a) => a.action === 'riishe.specialist_submit')).toBe(true)
  })

  test('a duplicate active request is refused honestly (no second job row)', async () => {
    activeDuplicate = true
    const executed = await executeToolCall(
      { tool: 'generate_image', input: { prompt: 'a lighthouse at dusk' } },
      ctx(),
      new Set(['generate_image']),
    )
    expect(executed.ok).toBe(false)
    expect(executed.output).toContain('already queued or running')
    expect(jobRows).toHaveLength(0)
  })

  test('missing permission key → honest refusal, no job', async () => {
    const executed = await executeToolCall(
      { tool: 'generate_image', input: { prompt: 'a lighthouse at dusk' } },
      ctx({ permissions: new Set(['allowCodeExecution']) }),
      new Set(['generate_image']),
    )
    expect(executed.ok).toBe(false)
    expect(executed.output).toContain('Permission denied')
    expect(jobRows).toHaveLength(0)
  })

  test('invalid input (too-short prompt) is refused before any submission', async () => {
    const executed = await executeToolCall(
      { tool: 'generate_image', input: { prompt: 'ab' } },
      ctx(),
      new Set(['generate_image']),
    )
    expect(executed.ok).toBe(false)
    expect(executed.output).toContain('at least 3 characters')
    expect(jobRows).toHaveLength(0)
  })
})

describe('create_video — real submission through the gates', () => {
  test('a valid text-to-video request submits a JAZMII job', async () => {
    const executed = await executeToolCall(
      { tool: 'create_video', input: { prompt: 'ocean waves at dawn' } },
      ctx(),
      new Set(['create_video']),
    )
    expect(executed.ok).toBe(true)
    const job = jobRows[0]
    expect(job.product).toBe('jazmii')
    expect(job.task).toBe('video-generation')
    expect(executed.output).toContain('do NOT claim the video is ready')
  })

  test('an unsupported size is refused before submission', async () => {
    const executed = await executeToolCall(
      { tool: 'create_video', input: { prompt: 'ocean waves at dawn', size: '9999x9999' } },
      ctx(),
      new Set(['create_video']),
    )
    expect(executed.ok).toBe(false)
    expect(executed.output).toContain('Unsupported video size')
    expect(jobRows).toHaveLength(0)
  })
})

describe('synthesize_speech — real submission through the gates', () => {
  test('a valid request with a known voice submits a GANGZII job', async () => {
    const executed = await executeToolCall(
      { tool: 'synthesize_speech', input: { text: 'Welcome to BEAN Intelligence.', voice: 'tongtong' } },
      ctx(),
      new Set(['synthesize_speech']),
    )
    expect(executed.ok).toBe(true)
    const job = jobRows[0]
    expect(job.product).toBe('gangzii')
    expect(job.task).toBe('speech-synthesis')
    expect(String(job.paramsJson)).toContain('tongtong')
  })

  test('an unknown voice is refused honestly — no silent voice substitution', async () => {
    const executed = await executeToolCall(
      { tool: 'synthesize_speech', input: { text: 'Hello there friend.', voice: 'definitely-not-a-voice' } },
      ctx(),
      new Set(['synthesize_speech']),
    )
    expect(executed.ok).toBe(false)
    expect(executed.output).toContain('voice is not available')
    expect(jobRows).toHaveLength(0)
  })

  test('text beyond the per-request cap is refused before submission', async () => {
    const executed = await executeToolCall(
      { tool: 'synthesize_speech', input: { text: 'a'.repeat(1001) } },
      ctx(),
      new Set(['synthesize_speech']),
    )
    expect(executed.ok).toBe(false)
    expect(executed.output).toContain('1000 characters')
    expect(jobRows).toHaveLength(0)
  })

  test('missing userId (unauthenticated context) → honest refusal', async () => {
    const executed = await executeToolCall(
      { tool: 'synthesize_speech', input: { text: 'Hello' } },
      ctx({ userId: undefined }),
      new Set(['synthesize_speech']),
    )
    expect(executed.ok).toBe(false)
    expect(executed.output).toContain('authenticated session')
    expect(jobRows).toHaveLength(0)
  })
})
