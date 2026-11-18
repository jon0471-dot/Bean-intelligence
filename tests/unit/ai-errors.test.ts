/**
 * BEAN Intelligence — universal AI error catalog regression tests.
 * Pins: every code carries an actionable recovery; runtime failures map to
 * the right stable codes; nothing fabricates success-shaped errors.
 */
import { describe, test, expect } from 'bun:test'
import { aiError, toAiError, AiErrorImpl, listAiErrorCodes, type AiErrorCode } from '@/lib/client-compute/inference/errors'

describe('AI error catalog', () => {
  test('every code has a non-empty message and an actionable recovery', () => {
    for (const entry of listAiErrorCodes()) {
      expect(entry.message.length).toBeGreaterThan(0)
      expect(entry.recovery.length).toBeGreaterThan(10)
    }
  })

  test('aiError builds a typed error with bounded details', () => {
    const e = aiError('AI_MODEL_NOT_INSTALLED', 'x'.repeat(500))
    expect(e.code).toBe('AI_MODEL_NOT_INSTALLED')
    expect(e.recovery).toContain('AI Device settings')
    expect(e.details?.length ?? 0).toBeLessThanOrEqual(400)
  })

  test('toAiError maps runtime failure signatures to stable codes', () => {
    expect(toAiError(new Error('WebGPU adapter not found')).code).toBe('AI_WEBGPU_UNAVAILABLE')
    expect(toAiError(new Error('Allocation failed: out of memory')).code).toBe('AI_OUT_OF_MEMORY')
    expect(toAiError(new Error('The request timed out after 30s')).code).toBe('AI_TIMEOUT')
    expect(toAiError(new Error('TypeError: Failed to fetch')).code).toBe('AI_NETWORK_INTERRUPTED')
    expect(toAiError(new Error('HTTP 429 Too Many Requests')).code).toBe('AI_RATE_LIMITED')
    expect(toAiError(new Error('ECONNREFUSED 127.0.0.1:8080')).code).toBe('AI_LOCAL_ENGINE_UNREACHABLE')
    expect(toAiError(new DOMException('The user aborted a request.', 'AbortError')).code).toBe('AI_GENERATION_CANCELLED')
  })

  test('unknown failures keep a bounded, honest diagnostic (never swallowed)', () => {
    const e = toAiError(new Error('something extremely unusual happened'))
    expect(e.code).toBe('AI_GENERATION_FAILED')
    expect(e.details).toContain('something extremely unusual')
  })

  test('AiErrorImpl keeps instanceof ergonomics and passes through toAiError', () => {
    const e = new AiErrorImpl('AI_GPU_DEVICE_LOST')
    expect(toAiError(e).code).toBe('AI_GPU_DEVICE_LOST')
    expect(e).toBeInstanceOf(Error)
  })
})
