/**
 * BEAN Intelligence — unit tests for the local llama.cpp lane manager
 * (resolveLaneConfigs / chatBodyExtrasFor / lane routing + EnsureResult
 * contract guards). Pure-function tests only: no process spawns, no ports.
 */
import { describe, expect, test } from 'bun:test'
import {
  chatBodyExtrasFor,
  planLaneStart,
  resolveLaneConfigs,
  resolveLaneEndpoint,
  type LaneConfig,
} from '../../src/lib/providers/llamacpp'

const ORIGINAL_ENV = { ...process.env }

function withEnv(env: Record<string, string | undefined>, fn: () => void): void {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    fn()
  } finally {
    for (const k of Object.keys(env)) {
      const restored = ORIGINAL_ENV[k]
      if (restored === undefined) delete process.env[k]
      else process.env[k] = restored
    }
  }
}

describe('llamacpp lane configuration', () => {
  test('dormant without the SSRF opt-in or base URL', () => {
    withEnv(
      {
        BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS: undefined,
        BEAN_LLAMACPP_BASE_URL: undefined,
        BEAN_LLAMACPP_CODE_BASE_URL: undefined,
      },
      () => {
        expect(resolveLaneConfigs()).toEqual({ riishe: null, code: null })
      },
    )
  })

  test('opt-in without base URL stays dormant (both gates required)', () => {
    withEnv(
      {
        BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS: '1',
        BEAN_LLAMACPP_BASE_URL: undefined,
      },
      () => {
        expect(resolveLaneConfigs().riishe).toBeNull()
      },
    )
  })

  test('chat lane resolves with measured defaults; code lane only when configured', () => {
    withEnv(
      {
        BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS: '1',
        BEAN_LLAMACPP_BASE_URL: 'http://127.0.0.1:8081/v1',
        BEAN_LLAMACPP_CODE_BASE_URL: undefined,
      },
      () => {
        const lanes = resolveLaneConfigs()
        expect(lanes.riishe).not.toBeNull()
        expect(lanes.riishe!.port).toBe(8081)
        expect(lanes.riishe!.baseUrl).toBe('http://127.0.0.1:8081/v1')
        expect(lanes.riishe!.ctxSize).toBe(8192) // measured: grounded turns are ~4.4k tokens (intel live acceptance 2026-11-08)
        expect(lanes.riishe!.minFreeRamMb).toBe(1900)
        expect(lanes.riishe!.modelPath).toContain('Qwen3-1.7B-Q4_K_M.gguf')
        expect(lanes.code).toBeNull()
      },
    )
  })

  test('code lane mirrors its own port/model/RAM gate', () => {
    withEnv(
      {
        BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS: '1',
        BEAN_LLAMACPP_BASE_URL: 'http://127.0.0.1:8081/v1',
        BEAN_LLAMACPP_CODE_BASE_URL: 'http://127.0.0.1:8082/v1',
      },
      () => {
        const code = resolveLaneConfigs().code
        expect(code).not.toBeNull()
        expect(code!.port).toBe(8082)
        expect(code!.modelPath).toContain('qwen2.5-coder-1.5b-instruct-q4_k_m.gguf')
        expect(code!.minFreeRamMb).toBe(800)
        expect(code!.ctxSize).toBe(8192)
      },
    )
  })

  test('non-local base URLs are not forced local here (adapter resolveLlamaCred guards loopback)', () => {
    withEnv(
      {
        BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS: '1',
        BEAN_LLAMACPP_BASE_URL: 'http://127.0.0.1:8081/v1',
        BEAN_LLAMACPP_CODE_BASE_URL: 'http://10.0.0.5:8082/v1',
      },
      () => {
        // Private-range code lane is a valid operator deployment (LAN GPU host).
        expect(resolveLaneConfigs().code?.port).toBe(8082)
      },
    )
  })
})

describe('qwen3 thinking control', () => {
  test('qwen3 models get thinking disabled (matches hosted lane policy)', () => {
    const extras = chatBodyExtrasFor('qwen3-0.6b-instruct')
    expect(extras).toEqual({ chat_template_kwargs: { enable_thinking: false } })
  })

  test('non-qwen3 models get no template kwargs', () => {
    expect(chatBodyExtrasFor('qwen2.5-coder-0.5b-instruct')).toEqual({})
  })
})

describe('lane routing contract', () => {
  test('code lane config is distinct from chat lane (ports 8081/8082)', () => {
    withEnv(
      {
        BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS: '1',
        BEAN_LLAMACPP_BASE_URL: 'http://127.0.0.1:8081/v1',
        BEAN_LLAMACPP_CODE_BASE_URL: 'http://127.0.0.1:8082/v1',
      },
      () => {
        const lanes = resolveLaneConfigs()
        const lanesById = new Map<string, LaneConfig | null>([
          ['riishe', lanes.riishe],
          ['code', lanes.code],
        ])
        expect(lanesById.get('riishe')!.port).toBe(8081)
        expect(lanesById.get('code')!.port).toBe(8082)
      },
    )
  })
})

const CHAT_LANE: LaneConfig = {
  laneId: 'riishe-chat',
  port: 8081,
  baseUrl: 'http://127.0.0.1:8081/v1',
  modelPath: '/home/z/bean-models/Qwen3-1.7B-Q4_K_M.gguf',
  ctxSize: 8192,
  minFreeRamMb: 1900,
  bin: null,
  logDir: null,
}

describe('lane endpoint routing (chat vs code lanes)', () => {
  test('chat lane uses BEAN_LLAMACPP_BASE_URL; code lane its own URL when configured', () => {
    withEnv(
      {
        BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS: '1',
        BEAN_LLAMACPP_BASE_URL: 'http://127.0.0.1:8081/v1',
        BEAN_LLAMACPP_CODE_BASE_URL: 'http://127.0.0.1:8082/v1',
      },
      () => {
        expect(resolveLaneEndpoint('chat')).toBe('http://127.0.0.1:8081/v1')
        expect(resolveLaneEndpoint('code')).toBe('http://127.0.0.1:8082/v1')
      },
    )
  })

  test('BACKWARD COMPAT: without a code base URL, coding rides the chat lane', () => {
    withEnv(
      {
        BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS: '1',
        BEAN_LLAMACPP_BASE_URL: 'http://127.0.0.1:8081/v1',
        BEAN_LLAMACPP_CODE_BASE_URL: undefined,
      },
      () => {
        expect(resolveLaneEndpoint('code')).toBe('http://127.0.0.1:8081/v1')
      },
    )
  })

  test('dormant without the SSRF opt-in (both lanes)', () => {
    withEnv(
      {
        BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS: undefined,
        BEAN_LLAMACPP_BASE_URL: 'http://127.0.0.1:8081/v1',
      },
      () => {
        expect(resolveLaneEndpoint('chat')).toBeNull()
        expect(resolveLaneEndpoint('code')).toBeNull()
      },
    )
  })

  test('a malformed code URL falls back to the chat lane (same as unset)', () => {
    withEnv(
      {
        BEAN_ALLOW_LOCAL_PROVIDER_ENDPOINTS: '1',
        BEAN_LLAMACPP_BASE_URL: 'http://127.0.0.1:8081/v1',
        BEAN_LLAMACPP_CODE_BASE_URL: 'not-a-url',
      },
      () => {
        expect(resolveLaneEndpoint('code')).toBe('http://127.0.0.1:8081/v1')
      },
    )
  })
})

describe('planLaneStart (documented spawn contract)', () => {
  const UP_FACTS = {
    serverAnswering: false,
    spawnsLastHour: 0,
    modelFileExists: true,
    freeRamMb: 2072, // measured MemAvailable on the deployment host
    loopback: true,
  }

  test('an answering server is ADOPTED, never re-spawned', () => {
    expect(planLaneStart(CHAT_LANE, { ...UP_FACTS, serverAnswering: true })).toEqual({
      action: 'adopt',
      reason: 'llama-server already answering at http://127.0.0.1:8081/v1',
    })
  })

  test('all gates passed → spawn', () => {
    expect(planLaneStart(CHAT_LANE, UP_FACTS).action).toBe('spawn')
  })

  test('non-loopback lanes are never spawned (operator-managed remote inference)', () => {
    const plan = planLaneStart(CHAT_LANE, { ...UP_FACTS, loopback: false })
    expect(plan.action).toBe('skip')
    expect(plan.reason).toContain('operator-managed')
  })

  test('third spawn within the hour is refused (crash-loop protection, documented 3/hour/lane)', () => {
    const plan = planLaneStart(CHAT_LANE, { ...UP_FACTS, spawnsLastHour: 3 })
    expect(plan.action).toBe('refuse')
    expect(plan.reason).toContain('3 starts/hour')
  })

  test('missing GGUF weights are refused with the measured path', () => {
    const plan = planLaneStart(CHAT_LANE, { ...UP_FACTS, modelFileExists: false })
    expect(plan.action).toBe('refuse')
    expect(plan.reason).toContain(CHAT_LANE.modelPath)
  })

  test('a spawn that would push the host toward OOM is refused with the measured RAM', () => {
    // The documented failure mode: MemFree (os.freemem) ≈ 201 MB hides that
    // MemAvailable is 2.1 GB — the gate must reason over AVAILABLE memory.
    const plan = planLaneStart(CHAT_LANE, { ...UP_FACTS, freeRamMb: 1899 })
    expect(plan.action).toBe('refuse')
    expect(plan.reason).toContain('1900')
    expect(plan.reason).toContain('1899')
  })

  test('RAM gate is per-lane: the coder lane needs less than the chat lane', () => {
    const CODE_LANE: LaneConfig = { ...CHAT_LANE, laneId: 'giftz-code', port: 8082, modelPath: '/home/z/bean-models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf', minFreeRamMb: 800 }
    expect(planLaneStart(CODE_LANE, { ...UP_FACTS, freeRamMb: 1000 }).action).toBe('spawn')
    expect(planLaneStart(CHAT_LANE, { ...UP_FACTS, freeRamMb: 1000 }).action).toBe('refuse')
  })
})
