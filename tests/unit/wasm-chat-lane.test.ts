/**
 * M39 §B — universal live runtime: the CPU/WASM chat lane.
 *
 * Pinned behaviors:
 *  - the registered WASM/GGUF chat entry carries its REAL measured facts
 *    (size, SHA-256 pin, revision, license) and serves 'chat.on-device';
 *  - selectExecutionPath: GPU-first when a WebGPU adapter exists; the CPU
 *    lane is the honest step-2 answer on devices without one; cpu-only mode
 *    NEVER selects the GPU lane (battery/thermal preference respected);
 *  - ensureOnDeviceChatReady: a GPU-class load failure (device lost /
 *    WebGPU unavailable / OOM) automatically falls back to the CPU lane
 *    when the device can serve it — and the CPU path requires the user's
 *    explicit download approval for the bean-managed artifact;
 *  - streamOnDeviceChat routes to whichever engine is ACTUALLY loaded
 *    (residency), never claims a target the engine did not run on;
 *  - WasmChatClient protocol: worker events map to honest results, worker
 *    crash fails every pending call, unload disposes residency.
 *
 * The wllama runtime itself is exercised with REAL inference in the browser
 * acceptance phase (headless Chromium, WASM SIMD) — these unit tests pin the
 * selection/protocol contracts, not the native wasm execution.
 */
import { describe, test, expect, beforeEach } from 'bun:test'
import {
  DeviceCapabilityManager,
  CHAT_MODEL_ID,
  CHAT_CPU_MODEL_ID,
  wasmChatResidency,
  webLlmResidency,
  setChatClientSeamsForTests,
  type ChatClientSeams,
} from '@/lib/client-compute/inference/device-capability-manager'
import { ensureProbesResolved, resetRuntimeProbesForTests } from '@/lib/client-compute/inference/runtime-probes'
import { resetDeviceSettingsForTests, setDeviceSettings } from '@/lib/client-compute/inference/device-settings'
import { setConsent } from '@/lib/client-compute/privacy'
import { AiErrorImpl } from '@/lib/client-compute/inference/errors'
import { WasmChatClient } from '@/lib/client-compute/inference/wasm-chat-client'
import { getDefaultModelRegistry } from '@/lib/client-compute/model-registry'
import { getClientCompute } from '@/lib/client-compute/index'
import type { CapabilitySnapshot } from '@/lib/client-compute/types'

function snapshot(overrides: Partial<CapabilitySnapshot> = {}): CapabilitySnapshot {
  return {
    environment: 'browser',
    secureContext: true,
    webgpu: { supported: false, adapterAvailable: false, features: [], limits: null, fallbackAdapter: null },
    webgl: { webgl2: false, webgl1: false, maxTextureSize: null },
    wasm: { supported: true, simd: true },
    workers: true,
    offscreenCanvas: true,
    sharedArrayBuffer: false,
    crossOriginIsolated: false,
    hardwareConcurrency: 4,
    deviceMemoryGb: 8,
    storage: null,
    browser: { family: 'Test', mobileHint: false },
    detectedAt: Date.now(),
    ...overrides,
  }
}

beforeEach(() => {
  resetRuntimeProbesForTests()
  resetDeviceSettingsForTests()
  setDeviceSettings({ mode: 'auto' })
  setConsent(true, false)
  setChatClientSeamsForTests({})
  webLlmResidency.current = null
  wasmChatResidency.current = null
  // Seed the client-compute singleton with the browser snapshot the probes
  // will also resolve from (production detects for real; tests seed the same
  // MEASURED facts they assert against).
  getClientCompute().setSnapshotForTests(snapshot())
})

describe('M39 §B — WASM/GGUF chat model registration', () => {
  test('the CPU chat entry is registered with its REAL measured facts', () => {
    const entry = getDefaultModelRegistry().getEntry(CHAT_CPU_MODEL_ID)
    expect(entry).toBeTruthy()
    expect(entry!.runtime).toBe('wasm-binary')
    expect(entry!.cpuCompatible).toBe(true)
    expect(entry!.gpuCompatible).toBe(false)
    expect(entry!.qualityClass).toBe('minimal')
    expect(entry!.sha256).toBe('74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db')
    expect(entry!.sizeBytes).toBe(491_400_032)
    expect(entry!.sizeUnverified).toBe(false)
    expect(entry!.integrity).toBe('pinned-artifact-sha256')
    expect(entry!.downloadPath).toBe('bean-managed-cache')
    expect(entry!.revision).toBe('9217f5db79a29953eb74d5343926648285ec7e67')
    expect(entry!.sourceUrl.startsWith('https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/')).toBe(true)
    expect(entry!.supportedTasks).toContain('chat.on-device')
    expect(entry!.limitations.length).toBeGreaterThan(0)
  })

  test('the runtime probe gates the wasm-binary runtime on measured facts', async () => {
    await ensureProbesResolved(snapshot())
    const entry = getDefaultModelRegistry().getEntry(CHAT_CPU_MODEL_ID)!
    expect(entry.runtimeAvailable()).toBe(true)
    // Without SIMD the honest answer is false (refuse, never assume).
    await ensureProbesResolved(snapshot({ wasm: { supported: true, simd: false } }))
    expect(entry.runtimeAvailable()).toBe(false)
  })
})

describe('M39 §B — selection policy with the CPU lane', () => {
  test('no WebGPU adapter: the chat lane selects the CPU/WASM model (working low-spec path)', async () => {
    await ensureProbesResolved(snapshot())
    const manager = new DeviceCapabilityManager()
    const d = manager.selectExecutionPath('chat.on-device')
    expect(d.target).toBe('client-cpu')
    expect(d.modelId).toBe(CHAT_CPU_MODEL_ID)
  })

  test('WebGPU adapter available: the GPU lane stays first (no silent downgrade of the stronger local runtime)', async () => {
    const gpu = snapshot({ webgpu: { supported: true, adapterAvailable: true, features: [], limits: null, fallbackAdapter: null } })
    getClientCompute().setSnapshotForTests(gpu)
    await ensureProbesResolved(gpu)
    const manager = new DeviceCapabilityManager()
    const d = manager.selectExecutionPath('chat.on-device')
    expect(d.target).toBe('client-gpu')
    expect(d.modelId).toBe(CHAT_MODEL_ID)
  })

  test('cpu-only mode: the GPU chat lane is skipped even with a WebGPU adapter', async () => {
    const gpu = snapshot({ webgpu: { supported: true, adapterAvailable: true, features: [], limits: null, fallbackAdapter: null } })
    getClientCompute().setSnapshotForTests(gpu)
    await ensureProbesResolved(gpu)
    setDeviceSettings({ mode: 'cpu-only' })
    const manager = new DeviceCapabilityManager()
    const d = manager.selectExecutionPath('chat.on-device')
    expect(d.target).toBe('client-cpu')
    expect(d.modelId).toBe(CHAT_CPU_MODEL_ID)
  })

  test('memory budget too small for the CPU model: honest refusal to load (server lane is the fallback)', async () => {
    const low = snapshot({ deviceMemoryGb: 1 })
    getClientCompute().setSnapshotForTests(low)
    await ensureProbesResolved(low)
    const manager = new DeviceCapabilityManager()
    const d = manager.selectExecutionPath('chat.on-device')
    // 1 GB bucket * 40% = 409 MB < 768 MB estimate: the CPU lane must not load.
    expect(d.target).toBe('server')
    expect(d.reasons.join(' ')).toContain('memory budget')
  })
})

describe('M39 §B — GPU-failure automatic fallback + approval gate', () => {
  test('GPU load failure (device lost) falls back to the CPU lane automatically', async () => {
    const gpu = snapshot({ webgpu: { supported: true, adapterAvailable: true, features: [], limits: null, fallbackAdapter: null } })
    getClientCompute().setSnapshotForTests(gpu)
    await ensureProbesResolved(gpu)
    const artifactCalls: Array<{ modelId: string; approval: boolean }> = []
    const seams: ChatClientSeams = {
      webllm: async () => ({
        getSharedWebLlmClient: () => ({
          load: async () => {
            throw new AiErrorImpl('AI_GPU_DEVICE_LOST', 'simulated device loss in test')
          },
        } as never),
      }),
      artifact: async (modelId, approval) => {
        artifactCalls.push({ modelId, approval })
        return new Blob(['verified-bytes'], { type: 'application/octet-stream' })
      },
      wasm: async () => ({
        getSharedWasmChatClient: () => ({
          load: async (modelId: string) => modelId,
          streamChat: async () => ({ text: 'local answer', finishReason: 'stop' }),
        } as never),
      }),
    }
    setChatClientSeamsForTests(seams)
    const manager = new DeviceCapabilityManager()
    const result = await manager.ensureOnDeviceChatReady({ approval: true })
    expect(result.target).toBe('client-cpu')
    expect(result.modelId).toBe(CHAT_CPU_MODEL_ID)
    expect(artifactCalls).toEqual([{ modelId: CHAT_CPU_MODEL_ID, approval: true }])
    expect(wasmChatResidency.current).toBe(CHAT_CPU_MODEL_ID)
  })

  test('CPU artifact download without explicit approval is refused (never a silent download)', async () => {
    await ensureProbesResolved(snapshot())
    const artifactCalls: Array<{ modelId: string; approval: boolean }> = []
    setChatClientSeamsForTests({
      artifact: async (modelId, approval) => {
        artifactCalls.push({ modelId, approval })
        if (!approval) throw new AiErrorImpl('AI_MODEL_DOWNLOAD_FAILED', 'Download approval was not granted.')
        return new Blob(['verified-bytes'])
      },
      wasm: async () => ({
        getSharedWasmChatClient: () => ({ load: async (modelId: string) => modelId } as never),
      }),
    })
    const manager = new DeviceCapabilityManager()
    await expect(manager.ensureOnDeviceChatReady({})).rejects.toMatchObject({ code: 'AI_MODEL_DOWNLOAD_FAILED' })
    expect(artifactCalls).toEqual([{ modelId: CHAT_CPU_MODEL_ID, approval: false }])
    expect(wasmChatResidency.current).toBeNull()
  })

  test('non-GPU failures (e.g. init timeout) do NOT silently switch lanes', async () => {
    const gpu = snapshot({ webgpu: { supported: true, adapterAvailable: true, features: [], limits: null, fallbackAdapter: null } })
    getClientCompute().setSnapshotForTests(gpu)
    await ensureProbesResolved(gpu)
    let wasmTried = false
    setChatClientSeamsForTests({
      webllm: async () => ({
        getSharedWebLlmClient: () => ({
          load: async () => {
            throw new AiErrorImpl('AI_INIT_TIMEOUT', 'simulated slow load')
          },
        } as never),
      }),
      wasm: async () => ({
        getSharedWasmChatClient: () => {
          wasmTried = true
          return { load: async (modelId: string) => modelId } as never
        },
      }),
    })
    const manager = new DeviceCapabilityManager()
    await expect(manager.ensureOnDeviceChatReady({ approval: true })).rejects.toMatchObject({ code: 'AI_INIT_TIMEOUT' })
    expect(wasmTried).toBe(false)
  })
})

describe('M39 §B — streaming routes by ACTUAL residency', () => {
  test('a loaded CPU engine serves the turn and reports client-cpu honestly', async () => {
    wasmChatResidency.current = CHAT_CPU_MODEL_ID
    setChatClientSeamsForTests({
      wasm: async () => ({
        getSharedWasmChatClient: () => ({
          streamChat: async () => ({ text: 'cpu answer', finishReason: 'stop' }),
        } as never),
      }),
    })
    const manager = new DeviceCapabilityManager()
    const result = await manager.streamOnDeviceChat([{ role: 'user', content: 'hello' }])
    expect(result.target).toBe('client-cpu')
    expect(result.modelId).toBe(CHAT_CPU_MODEL_ID)
    expect(result.text).toBe('cpu answer')
  })

  test('nothing loaded: honest not-installed failure (never a fabricated answer)', async () => {
    const manager = new DeviceCapabilityManager()
    await expect(manager.streamOnDeviceChat([{ role: 'user', content: 'hello' }])).rejects.toMatchObject({ code: 'AI_MODEL_NOT_INSTALLED' })
  })

  test('unload releases the CPU residency and its heavy slot', async () => {
    wasmChatResidency.current = CHAT_CPU_MODEL_ID
    let unloadCalled = false
    setChatClientSeamsForTests({
      wasm: async () => ({
        getSharedWasmChatClient: () => ({
          unload: async () => {
            unloadCalled = true
          },
        } as never),
      }),
    })
    const manager = new DeviceCapabilityManager()
    await manager.unloadOnDeviceChat()
    expect(unloadCalled).toBe(true)
    expect(wasmChatResidency.current).toBeNull()
  })
})

describe('M39 §B — WasmChatClient protocol (fake worker)', () => {
  class FakeWorker {
    listeners = new Map<string, Array<(e: unknown) => void>>()
    messages: Array<Record<string, unknown>> = []
    addEventListener(type: string, cb: (e: unknown) => void) {
      const list = this.listeners.get(type) ?? []
      list.push(cb)
      this.listeners.set(type, list)
    }
    removeEventListener() {}
    postMessage(msg: Record<string, unknown>) {
      this.messages.push(msg)
      this.onMessage?.(msg)
    }
    terminate() {}
    onMessage: ((msg: Record<string, unknown>) => void) | null = null
    emit(data: unknown) {
      for (const cb of this.listeners.get('message') ?? []) cb({ data })
    }
    emitError(message: string) {
      for (const cb of this.listeners.get('error') ?? []) cb({ message })
    }
  }

  test('load resolves only on the worker ready frame; progress streams through', async () => {
    const fake = new FakeWorker()
    const client = new WasmChatClient({ workerFactory: () => fake as unknown as Worker })
    const progress: Array<{ note: string; progress: number | null }> = []
    // The first postMessage happens synchronously inside load() — assign the
    // capture BEFORE calling it.
    const firstMsg = new Promise<Record<string, unknown>>((resolve) => {
      fake.onMessage = (msg) => resolve(msg)
    })
    const done = client.load('m1', new Blob(['x']), { nCtx: 1024, onProgress: (p) => progress.push(p) })
    const initMsg = await firstMsg
    fake.emit({ type: 'progress', requestId: initMsg.requestId, note: 'initializing CPU runtime', progress: null })
    fake.emit({ type: 'ready', requestId: initMsg.requestId, modelId: 'm1' })
    const loaded = await done
    expect(loaded).toBe('m1')
    expect(progress[0]).toEqual({ note: 'initializing CPU runtime', progress: null })
    expect(client.getLoadedModel()).toBe('m1')
    // The artifact blob was handed to the worker for the pinned model id.
    expect(initMsg.modelId).toBe('m1')
    expect(initMsg.nCtx).toBe(1024)
  })

  test('streamChat maps deltas and the done frame to the honest result', async () => {
    const fake = new FakeWorker()
    const client = new WasmChatClient({ workerFactory: () => fake as unknown as Worker })
    client['loadedModelId'] = 'm1'
    const deltas: string[] = []
    const firstMsg = new Promise<Record<string, unknown>>((resolve) => {
      fake.onMessage = (msg) => resolve(msg)
    })
    const done = client.streamChat([{ role: 'user', content: 'hi' }], { onDelta: (d) => deltas.push(d) })
    const genMsg = await firstMsg
    fake.emit({ type: 'delta', requestId: genMsg.requestId, delta: 'he' })
    fake.emit({ type: 'delta', requestId: genMsg.requestId, delta: 'llo' })
    fake.emit({ type: 'done', requestId: genMsg.requestId, text: 'hello', finishReason: 'stop' })
    const result = await done
    expect(result).toEqual({ text: 'hello', finishReason: 'stop' })
    expect(deltas).toEqual(['he', 'llo'])
  })

  test('worker crash fails every pending call with AI_WORKER_CRASHED', async () => {
    const fake = new FakeWorker()
    const client = new WasmChatClient({ workerFactory: () => fake as unknown as Worker })
    const firstMsg = new Promise<Record<string, unknown>>((resolve) => {
      fake.onMessage = (msg) => resolve(msg)
    })
    const pending = client.load('m1', new Blob(['x']))
    await firstMsg
    fake.emitError('worker died')
    await expect(pending).rejects.toMatchObject({ code: 'AI_WORKER_CRASHED' })
  })

  test('streaming without a loaded model is an honest not-installed failure', async () => {
    const fake = new FakeWorker()
    const client = new WasmChatClient({ workerFactory: () => fake as unknown as Worker })
    await expect(client.streamChat([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({ code: 'AI_MODEL_NOT_INSTALLED' })
  })
})
