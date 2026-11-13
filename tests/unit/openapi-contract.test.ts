/**
 * PHASE 0 — OpenAPI contract validation (docs/api/openapi.yaml).
 *
 * Contract pinned here (Phase 0 authorization §5, §7.E):
 *  - the spec parses as valid YAML and declares OpenAPI 3.1;
 *  - every documented path+method maps to an ACTUAL implemented route file
 *    under src/app/api/v1, and every actual route file is documented
 *    (bidirectional drift check against the repository, not assumptions);
 *  - the four truthful rate-limit headers are documented on the shared 429
 *    response, and that response is referenced by every operation that can
 *    emit a 429 (all except the unauthenticated, unthrottled /health probe);
 *  - authentication schemes are documented accurately: /api/v1/keys* accept
 *    an ADMIN SESSION ONLY (never a bearer key), everything else session OR
 *    bearer, /health public;
 *  - chat/completions documents BOTH application/json and text/event-stream;
 *  - NO planned future surface (images, videos, background removal, external
 *    code generation, webhooks, projects/organizations, billing) is described
 *    as implemented;
 *  - examples contain no real key material (synthetic EXAMPLE markers only).
 *
 * Run: bun test tests/unit/openapi-contract.test.ts
 */
import { describe, test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(import.meta.dir, '..', '..')
const SPEC_PATH = join(REPO_ROOT, 'docs', 'api', 'openapi.yaml')
const V1_ROUTE_ROOT = join(REPO_ROOT, 'src', 'app', 'api', 'v1')

/** Parse with Bun's built-in YAML (no external dependency added in Phase 0). */
const spec = Bun.YAML.parse(readFileSync(SPEC_PATH, 'utf8')) as {
  openapi: string
  info: { title: string; version: string }
  paths: Record<string, Record<string, unknown>>
  components: {
    securitySchemes: Record<string, unknown>
    schemas: Record<string, unknown>
    responses: Record<string, unknown>
    headers: Record<string, unknown>
  }
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const

/** Actual implemented surface: walk src/app/api/v1 for route.ts files and
 *  read the exported handlers — the repository is the source of truth. */
function actualV1Routes(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  const walk = (dir: string, segments: string[]): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full, [...segments, entry])
      } else if (entry === 'route.ts') {
        const src = readFileSync(full, 'utf8')
        const methods = new Set<string>(
          HTTP_METHODS.filter((m) => new RegExp(`export\\s+async\\s+function\\s+${m.toUpperCase()}\\b`).test(src)),
        )
        const path =
          '/' +
          segments
            .map((s) => (s.startsWith('[') && s.endsWith(']') ? `{${s.slice(1, -1)}}` : s))
            .join('/')
        found.set(path, methods)
      }
    }
  }
  walk(V1_ROUTE_ROOT, [])
  return found
}

describe('openapi.yaml — structural validity (Phase 0 §7.E)', () => {
  test('parses and declares OpenAPI 3.1 with the implemented-only title', () => {
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.info.version).toBe('1.0.0')
    expect(spec.info.title).toContain('BEAN')
  })

  test('defines the reusable building blocks the contract relies on', () => {
    expect(Object.keys(spec.components.securitySchemes).sort()).toEqual(['bearerApiKey', 'sessionCookie'])
    expect(Object.keys(spec.components.responses)).toContain('RateLimited')
    for (const header of ['RetryAfter', 'RateLimitLimit', 'RateLimitRemaining', 'RateLimitReset']) {
      expect(Object.keys(spec.components.headers)).toContain(header)
    }
    for (const schema of ['ErrorEnvelope', 'ChatCompletionRequest', 'ChatCompletionResponse', 'KeyCreatedResponse']) {
      expect(Object.keys(spec.components.schemas)).toContain(schema)
    }
  })
})

describe('openapi.yaml — matches the ACTUAL implemented /api/v1 surface (Phase 0 §5)', () => {
  const actual = actualV1Routes()
  const documentedPaths = Object.keys(spec.paths)

  test('every ACTUAL route file is documented (no missing endpoints)', () => {
    for (const [path, methods] of actual) {
      expect(documentedPaths).toContain(path)
      const docOps = Object.keys(spec.paths[path]).filter((k) => (HTTP_METHODS as readonly string[]).includes(k))
      for (const method of methods) {
        expect(docOps).toContain(method)
      }
    }
  })

  test('every DOCUMENTED operation maps to an actual route file (no invented endpoints)', () => {
    for (const path of documentedPaths) {
      expect(actual.has(path)).toBe(true)
      const actualMethods = actual.get(path)!
      for (const op of Object.keys(spec.paths[path])) {
        if ((HTTP_METHODS as readonly string[]).includes(op)) {
          expect(actualMethods.has(op)).toBe(true)
        }
      }
    }
  })

  test('the implemented inventory is exactly the verified 8-route /api/v1 set', () => {
    expect([...actual.keys()].sort()).toEqual(
      ['/chat/completions', '/health', '/keys', '/keys/{id}', '/keys/{id}/rotate', '/models', '/providers', '/usage'].sort(),
    )
  })

  test('NO planned future surface is described as implemented (Phase 0 §5, §8)', () => {
    const forbidden = /image|video|background-removal|code|webhook|project|organization|billing|subscription|portal/i
    for (const path of documentedPaths) {
      expect(path).not.toMatch(forbidden)
    }
    // Chat endpoint is the only POST not under /keys — code GENERATION stays external.
    expect(spec.paths['/chat/completions']).toBeDefined()
    expect(documentedPaths.some((p) => p.includes('generations'))).toBe(false)
  })
})

describe('openapi.yaml — authentication documented accurately (Phase 0 §5)', () => {
  test('key management accepts an ADMIN SESSION ONLY — never a bearer key', () => {
    for (const [path, ops] of Object.entries(spec.paths)) {
      if (!path.startsWith('/keys')) continue
      for (const [method, op] of Object.entries(ops)) {
        if (!(HTTP_METHODS as readonly string[]).includes(method)) continue
        const security = (op as { security?: Array<Record<string, string[]>> }).security
        expect(security).toBeDefined()
        for (const entry of security!) {
          expect(Object.keys(entry)).toEqual(['sessionCookie'])
        }
      }
    }
  })

  test('discovery/chat/usage endpoints accept session OR bearer; /health is public', () => {
    for (const path of ['/models', '/providers', '/usage', '/chat/completions']) {
      for (const [method, op] of Object.entries(spec.paths[path])) {
        if (!(HTTP_METHODS as readonly string[]).includes(method)) continue
        const security = (op as { security?: Array<Record<string, string[]>> }).security
        const kinds = security!.flatMap((e) => Object.keys(e)).sort()
        expect(kinds).toEqual(['bearerApiKey', 'sessionCookie'])
      }
    }
    const health = spec.paths['/health'].get as { security: unknown[] }
    expect(health.security).toEqual([])
  })
})

describe('openapi.yaml — rate-limit headers documented truthfully (Phase 0 §4, §7.A)', () => {
  test('the shared 429 response defines exactly the four truthful headers', () => {
    const rateLimited = spec.components.responses.RateLimited as {
      headers: Record<string, unknown>
      content: Record<string, unknown>
    }
    expect(Object.keys(rateLimited.headers).sort()).toEqual(
      ['Retry-After', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'].sort(),
    )
    expect(rateLimited.content['application/json']).toBeDefined()
  })

  test('every operation that can emit 429 references it; /health (public, unthrottled) does not', () => {
    for (const [path, ops] of Object.entries(spec.paths)) {
      for (const [method, op] of Object.entries(ops)) {
        if (!(HTTP_METHODS as readonly string[]).includes(method)) continue
        const responses = (op as { responses: Record<string, unknown> }).responses
        if (path === '/health') {
          expect(responses['429']).toBeUndefined()
        } else {
          expect(responses['429']).toBeDefined()
          const ref = (responses['429'] as { $ref?: string }).$ref ?? ''
          expect(ref).toContain('RateLimited')
        }
      }
    }
  })

  test('header components describe the omission-when-unknown rule (never fabricated)', () => {
    const retryAfter = spec.components.headers.RetryAfter as { description: string }
    const reset = spec.components.headers.RateLimitReset as { description: string }
    expect(retryAfter.description).toMatch(/omitted|OMITTED/i)
    expect(retryAfter.description).toMatch(/never fabricat/i)
    expect(reset.description).toMatch(/epoch/i)
  })
})

describe('openapi.yaml — chat contract documents both transports (Phase 0 §5)', () => {
  test('POST /chat/completions documents JSON and SSE success content', () => {
    const op = spec.paths['/chat/completions'].post as {
      responses: Record<string, { content?: Record<string, unknown> }>
      requestBody?: { content: Record<string, unknown> }
    }
    const okContent = op.responses['200'].content!
    expect(okContent['application/json']).toBeDefined()
    expect(okContent['text/event-stream']).toBeDefined()
    expect(op.requestBody).toBeDefined()
    expect(op.requestBody!.content['application/json']).toBeDefined()
  })

  test('chat request schema matches the implemented zod bounds', () => {
    const req = spec.components.schemas.ChatCompletionRequest as {
      required: string[]
      properties: Record<string, { type?: string; maxLength?: number; maximum?: number; minItems?: number; maxItems?: number; minLength?: number }>
    }
    expect(req.required.sort()).toEqual(['messages', 'model'])
    expect(req.properties.messages.minItems).toBe(1)
    expect(req.properties.messages.maxItems).toBe(48)
    expect(req.properties.system.maxLength).toBe(24000)
    expect(req.properties.temperature.maximum).toBe(2)
    expect(req.properties.max_tokens.maximum).toBe(32000)
    expect(req.properties.maxTokens.maximum).toBe(32000)
    expect(req.properties.providerModel.maxLength).toBe(200)
    const message = spec.components.schemas.ChatMessage as {
      properties: { content: { maxLength?: number }; role: { enum?: string[] } }
    }
    expect(message.properties.content.maxLength).toBe(64000)
    expect(message.properties.role.enum).toEqual(['system', 'user', 'assistant'])
  })
})

describe('openapi.yaml — no secret material in examples (Phase 0 §9)', () => {
  test('every bgk_-prefixed example value is an explicit synthetic EXAMPLE marker', () => {
    const raw = readFileSync(SPEC_PATH, 'utf8')
    const keyLike = raw.match(/bgk_[A-Za-z0-9_-]+/g) ?? []
    expect(keyLike.length).toBeGreaterThan(0)
    for (const value of keyLike) {
      // Short masked display prefixes (bgk_9x2f, bgk_xxxx, bgk_b7c4) are the
      // documented fingerprint convention — NOT secrets. Anything longer than
      // a display prefix could pass for raw key material and must be an
      // explicit synthetic EXAMPLE marker.
      if (value.length > 12) {
        expect(value).toContain('EXAMPLE')
      }
      // No base64url-length material that could pass for a live 256-bit key.
      expect(value.length).toBeLessThan(40)
    }
  })
})

describe('openapi.yaml — referenced documentation artifacts exist (Phase 0 §6)', () => {
  test('GATEWAY-API.md and API.md reference the machine-readable contract', () => {
    const gateway = readFileSync(join(REPO_ROOT, 'docs', 'api', 'GATEWAY-API.md'), 'utf8')
    const api = readFileSync(join(REPO_ROOT, 'docs', 'api', 'API.md'), 'utf8')
    expect(gateway).toContain('openapi.yaml')
    expect(gateway).toMatch(/Rate-limit response headers/)
    expect(api).toContain('/api/v1')
    expect(api).toContain('openapi.yaml')
  })

  test('the spec file exists at the documented location with real content', () => {
    expect(existsSync(SPEC_PATH)).toBe(true)
    expect(statSync(SPEC_PATH).size).toBeGreaterThan(10_000)
  })
})
