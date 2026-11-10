/**
 * BEAN Intelligence — unit tests: registry integrity, routing validation,
 * sandbox guards, credentials, rate limiting. Run: bun test tests/unit/
 */
import { describe, test, expect } from 'bun:test'
import { BEAN_PRODUCTS, getProduct, LAXII_SIZES } from '../../src/lib/registry/products'
import { BACKEND_REGISTRY, getBackend, getBackendsForProduct } from '../../src/lib/registry/backends'
import { assertChatRequest } from '../../src/lib/router/router'
import { BeanApiError } from '../../src/lib/api/errors'
import { assertSafeRelativePath, extractFiles } from '../../src/lib/sandbox/runner'
import { hashPassword, verifyPassword, validatePasswordStrength } from '../../src/lib/auth/password'
import { checkRateLimit } from '../../src/lib/auth/ratelimit'

describe('public product catalog (customer-facing identity)', () => {
  test('exposes exactly the four flagship products', () => {
    expect(BEAN_PRODUCTS.map((p) => p.id).sort()).toEqual([
      'code-giftz', 'jazmii', 'laxii', 'riishe',
    ])
  })

  test('never mentions upstream model identities', () => {
    const blob = JSON.stringify(BEAN_PRODUCTS).toLowerCase()
    for (const banned of ['gpt', 'claude', 'qwen', 'flux', 'llama', 'gemini', 'deepseek', 'wan2', 'hunyuan']) {
      expect(blob.includes(banned)).toBe(false)
    }
  })

  test('LAXII exposes exactly the seven backend-supported sizes', () => {
    expect(LAXII_SIZES).toHaveLength(7)
    expect(LAXII_SIZES.map((s) => s.value)).toContain('1024x1024')
  })

  test('getProduct resolves and rejects correctly', () => {
    expect(getProduct('riishe')?.name).toBe('RIISHE')
    expect(getProduct('not-a-product')).toBeUndefined()
  })
})

describe('private backend registry (server-only source of truth)', () => {
  test('every product has at least one registered backend', () => {
    for (const p of BEAN_PRODUCTS) {
      expect(getBackendsForProduct(p.id).length).toBeGreaterThan(0)
    }
  })

  test('backend tasks match their product task (no cross-task routing)', () => {
    for (const b of BACKEND_REGISTRY) {
      const product = getProduct(b.productId)
      expect(product).toBeDefined()
      expect(b.task).toBe(product!.task)
    }
  })

  test('video backend is truthfully disabled with a reason', () => {
    const video = getBackend('bean-video-selfhosted-candidate')!
    expect(video.enabled).toBe(false)
    expect(video.unavailableReason).toBeTruthy()
    expect(video.unavailableReason!.length).toBeGreaterThan(20)
  })

  test('enabled backends carry license verification data', () => {
    for (const b of BACKEND_REGISTRY.filter((x) => x.enabled)) {
      expect(b.license.name).toBeTruthy()
      expect(b.license.sourceUrl).toMatch(/^https?:\/\//)
      expect(b.license.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  test('no fallback is configured that is not itself a registered backend', () => {
    for (const b of BACKEND_REGISTRY) {
      for (const f of b.fallbacks) {
        expect(getBackend(f)).toBeDefined()
      }
    }
  })
})

describe('router capability validation', () => {
  const chatBackend = getBackend('bean-llm-hosted-primary')!

  test('accepts a message within limits', () => {
    const caps = assertChatRequest(chatBackend, [{ role: 'user', content: 'hello' }])
    expect(caps.maxPromptChars).toBeGreaterThan(0)
    expect(caps.maxHistoryMessages).toBeGreaterThan(0)
  })

  test('rejects oversized prompts with CAPABILITY_UNSUPPORTED', () => {
    const huge = 'x'.repeat(Number(chatBackend.limits.maxPromptChars) + 1)
    expect(() =>
      assertChatRequest(chatBackend, [{ role: 'user', content: huge }]),
    ).toThrow(BeanApiError)
    try {
      assertChatRequest(chatBackend, [{ role: 'user', content: huge }])
    } catch (e) {
      expect((e as BeanApiError).code).toBe('CAPABILITY_UNSUPPORTED')
    }
  })

  test('rejects message-less request', () => {
    expect(() => assertChatRequest(chatBackend, [])).toThrow(BeanApiError)
  })
})

describe('API error contract', () => {
  test('maps codes to stable HTTP status codes', () => {
    expect(new BeanApiError('UNAUTHENTICATED', 'x').toResponse().status).toBe(401)
    expect(new BeanApiError('FORBIDDEN', 'x').toResponse().status).toBe(403)
    expect(new BeanApiError('NO_BACKEND', 'x').toResponse().status).toBe(503)
    expect(new BeanApiError('QUOTA_EXCEEDED', 'x').toResponse().status).toBe(429)
  })
})

describe('sandbox guards', () => {
  test('rejects path traversal and absolute paths', () => {
    expect(() => assertSafeRelativePath('../etc/passwd')).toThrow()
    expect(() => assertSafeRelativePath('/etc/passwd')).toThrow()
    expect(() => assertSafeRelativePath('a/../../b')).toThrow()
    expect(() => assertSafeRelativePath('bad name!.js')).toThrow()
  })

  test('accepts safe relative paths', () => {
    expect(() => assertSafeRelativePath('main.js')).not.toThrow()
    expect(() => assertSafeRelativePath('src/lib/util.ts')).not.toThrow()
  })

  test('extracts path-tagged code fences', () => {
    const out = extractFiles(
      'intro\n```js path=main.js\nconsole.log(1)\n```\n```ts path=util/helpers.ts\nexport const x = 1\n```',
    )
    expect(out).toHaveLength(2)
    expect(out[0].path).toBe('main.js')
    expect(out[0].content).toContain('console.log(1)')
    expect(out[1].path).toBe('util/helpers.ts')
  })

  test('falls back to main.<lang> for a single unlabeled fence', () => {
    const out = extractFiles('```python\nprint("hi")\n```')
    expect(out).toHaveLength(1)
    expect(out[0].path).toBe('main.py')
  })

  test('returns empty for no fences', () => {
    expect(extractFiles('just prose, no code')).toHaveLength(0)
  })
})

describe('credentials', () => {
  test('hash + verify round-trip and wrong-password rejection', () => {
    const hash = hashPassword('BeanGold2026')
    expect(hash.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('BeanGold2026', hash)).toBe(true)
    expect(verifyPassword('WrongPass123', hash)).toBe(false)
    expect(verifyPassword('', hash)).toBe(false)
  })

  test('password strength policy', () => {
    expect(validatePasswordStrength('short1')).toBeTruthy()
    expect(validatePasswordStrength('nonumbershere')).toBeTruthy()
    expect(validatePasswordStrength('GoodPass123')).toBeNull()
  })
})

describe('rate limiter', () => {
  test('allows under the limit then blocks and reports retry window', () => {
    const key = `test-${Math.random()}`
    for (let i = 0; i < 3; i++) {
      expect(checkRateLimit(key, 3, 1000).allowed).toBe(true)
    }
    const blocked = checkRateLimit(key, 3, 1000)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })
})
