/**
 * BEAN Intelligence — M26 lane-manager reliability regression tests.
 *
 * Pins the M26 AUDIT §4.1 remediations WITHOUT spawning any real process:
 *  - LANE-1 duplicate-spawn mutex: concurrent ensures for the same lane share
 *    ONE in-flight attempt (spawn fn invoked exactly once);
 *  - LANE-2 cross-lane RAM admission: MemAvailable minus pending spawn
 *    reservations feeds the same documented gate; the reservation is held
 *    for the whole spawn window and released afterwards;
 *  - LANE-3 spawn cleanup: a spawn that never opens its port reports honest
 *    failure (the production spawn path terminates its own never-answered
 *    child — process-level behavior, verified live in scripts/m26/);
 *  - probe cache + adopt path remain exactly as documented (M25 contract).
 *
 * All tests run through ensureLaneServerWithDeps with fake probes/spawns —
 * pure orchestration tests, no ports, no processes, no sleeps (fake timers
 * not needed: the injected spawn resolves immediately).
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test'
import {
  ensureLaneServerWithDeps,
  pendingLaneSpawnRamMb,
  resetLaneManagerForTests,
  type LaneConfig,
} from '../../src/lib/providers/llamacpp'

const LANE: LaneConfig = {
  laneId: 'riishe-chat',
  port: 8081,
  baseUrl: 'http://127.0.0.1:8081/v1',
  modelPath: '/models/chat.gguf',
  ctxSize: 8192,
  minFreeRamMb: 1900,
  bin: null,
  logDir: null,
}

function deps(overrides: {
  probe?: (lane: LaneConfig) => Promise<boolean>
  hardware?: () => Promise<{ freeRamMb: number }>
  fileExists?: (p: string) => boolean
  spawn?: (lane: LaneConfig) => Promise<{ started: boolean; pid: number | null }>
  spawnLog?: Array<string>
}) {
  const spawnLog = overrides.spawnLog ?? []
  return {
    spawnLog,
    deps: {
      probe: mock(overrides.probe ?? (async () => false)),
      hardware: mock(overrides.hardware ?? (async () => ({ freeRamMb: 8_192 }))),
      fileExists: mock(overrides.fileExists ?? (() => true)),
      spawn: mock(
        overrides.spawn ??
          (async (lane: LaneConfig) => {
            spawnLog.push(lane.laneId)
            return { started: true, pid: 4242 }
          }),
      ),
    },
  }
}

beforeEach(() => {
  resetLaneManagerForTests()
})

describe('LANE-1 duplicate-spawn mutex', () => {
  test('N concurrent ensures for a down lane share ONE spawn attempt', async () => {
    const { deps: d, spawnLog } = deps({})
    // 5 concurrent callers race on the same down lane
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ensureLaneServerWithDeps(LANE, d)),
    )
    expect(d.spawn.mock.calls.length).toBe(1)
    // every caller observes the SAME single outcome
    for (const r of results) {
      expect(r.spawned).toBe(true)
      expect(r.up).toBe(true)
    }
    // spawn ledger counts ONE attempt, not five
    expect(spawnLog).toEqual(['riishe-chat'])
  })

  test('different lanes spawn independently (mutex is per lane, not global)', async () => {
    const codeLane: LaneConfig = { ...LANE, laneId: 'giftz-code', port: 8082, baseUrl: 'http://127.0.0.1:8082/v1' }
    const { deps: d, spawnLog } = deps({})
    await Promise.all([ensureLaneServerWithDeps(LANE, d), ensureLaneServerWithDeps(codeLane, d)])
    expect(d.spawn.mock.calls.length).toBe(2)
    expect(spawnLog.sort()).toEqual(['giftz-code', 'riishe-chat'])
  })

  test('after a failed spawn completes, a NEW ensure may retry (mutex is in-flight only)', async () => {
    let spawnCalls = 0
    const { deps: d } = deps({
      spawn: async () => {
        spawnCalls++
        return { started: false, pid: null }
      },
    })
    const first = await ensureLaneServerWithDeps(LANE, d)
    expect(first.spawned).toBe(false)
    expect(first.detail).toContain('did not open its port')
    const second = await ensureLaneServerWithDeps(LANE, d)
    expect(second.spawned).toBe(false)
    expect(spawnCalls).toBe(2)
  })

  test('an answering server is adopted and never spawned (cached probe honored)', async () => {
    const { deps: d } = deps({ probe: async () => true })
    const first = await ensureLaneServerWithDeps(LANE, d)
    expect(first).toEqual({ up: true, adopted: true, spawned: false, detail: expect.stringContaining('answering') })
    // second call inside the probe TTL takes the cached path (probe called once)
    await ensureLaneServerWithDeps(LANE, d)
    expect(d.probe.mock.calls.length).toBe(1)
    expect(d.spawn.mock.calls.length).toBe(0)
  })
})

describe('LANE-2 cross-lane spawn-RAM admission', () => {
  test('a pending spawn reservation reduces the RAM seen by OTHER lanes', async () => {
    let releaseFirstSpawn!: () => void
    const firstSpawnGate = new Promise<void>((resolve) => {
      releaseFirstSpawn = resolve
    })
    const seenRam: Array<number> = []
    const { deps: d1 } = deps({
      spawn: async () => {
        // Hold the chat lane's spawn window open until the code lane decided
        await firstSpawnGate
        return { started: true, pid: 1 }
      },
    })
    const chatStart = ensureLaneServerWithDeps(LANE, d1)
    // wait until the chat reservation is actually held (poll the ledger)
    while (pendingLaneSpawnRamMb() === 0) await new Promise((r) => setTimeout(r, 5))
    expect(pendingLaneSpawnRamMb()).toBe(1900) // the chat lane's minFreeRamMb is reserved

    const { deps: d2 } = deps({
      hardware: async () => {
        const hw = { freeRamMb: 2_400 }
        seenRam.push(hw.freeRamMb)
        return hw
      },
      spawn: async () => ({ started: true, pid: 2 }),
    })
    // Host has 2400 MB measured: chat lane reserved 1900 → only 500 admissible
    // → the code lane (min 800) must be REFUSED, not admitted against stale RAM.
    const codeLane: LaneConfig = { ...LANE, laneId: 'giftz-code', port: 8082, baseUrl: 'http://127.0.0.1:8082/v1', minFreeRamMb: 800 }
    const codeResult = await ensureLaneServerWithDeps(codeLane, d2)
    expect(codeResult.spawned).toBe(false)
    expect(codeResult.up).toBe(false)
    expect(codeResult.detail).toContain('RAM')
    releaseFirstSpawn()
    const chatResult = await chatStart
    expect(chatResult.spawned).toBe(true)
    // reservation released after the spawn window
    expect(pendingLaneSpawnRamMb()).toBe(0)
    expect(d2.spawn.mock.calls.length).toBe(0)
  })

  test('reservation is released on spawn FAILURE too (no permanent admission shrink)', async () => {
    const { deps: d } = deps({ spawn: async () => ({ started: false, pid: null }) })
    const r = await ensureLaneServerWithDeps(LANE, d)
    expect(r.spawned).toBe(false)
    expect(pendingLaneSpawnRamMb()).toBe(0)
  })

  test('both lanes can spawn when RAM admits them (1900+800 <= 4096)', async () => {
    const { deps: d } = deps({ hardware: async () => ({ freeRamMb: 4_096 }) })
    const codeLane: LaneConfig = { ...LANE, laneId: 'giftz-code', port: 8082, baseUrl: 'http://127.0.0.1:8082/v1', minFreeRamMb: 800 }
    const [chat, code] = await Promise.all([
      ensureLaneServerWithDeps(LANE, d),
      ensureLaneServerWithDeps(codeLane, d),
    ])
    expect(chat.spawned).toBe(true)
    expect(code.spawned).toBe(true)
    expect(d.spawn.mock.calls.length).toBe(2)
  })
})
