/**
 * M36-D — UI/PAYLOAD IDENTITY HYGIENE (brief §9: absolute).
 *
 * Two complementary layers:
 *  1. FUNCTIONAL: the customer metadata serialization drops reach backend ids
 *     (the single audited DB/client boundary), while the in-memory object
 *     keeps full provenance for Trust receipts.
 *  2. STATIC: customer-facing components (everything except the admin/operator
 *     surfaces) contain NO foundation model names, NO runtime package names
 *     and NO backend ids — the leak sites are pinned by scanning the actual
 *     source files, so a future regression fails the suite, not the customer.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'

import { metadataToJson, type MessageMetadata } from '../../src/lib/riishe/states'
import { clientModelDisplayName, getDefaultModelRegistry } from '../../src/lib/client-compute/model-registry'

describe('metadata serialization — reach backend stripped from the customer payload', () => {
  const base: MessageMetadata = {
    states: ['VERIFIED_FROM_SOURCES'],
    sources: [
      {
        id: 1,
        title: 'Example source',
        url: 'https://example.com/a',
        hostName: 'example.com',
        date: null,
        official: false,
        social: false,
        pageRead: true,
        reach: { channel: 'github', backend: 'github-api', engine: 'agent-reach' } as MessageMetadata['sources'][number]['reach'],
        readEngine: 'agent-reach',
      },
      {
        id: 2,
        title: 'Plain source',
        url: 'https://example.com/b',
        hostName: 'example.com',
        date: null,
        official: false,
        social: false,
        pageRead: false,
      },
    ],
    verification: [],
    stages: [],
    degraded: [],
  }

  test('the serialized payload has no backend key on any source', () => {
    const json = metadataToJson(base)
    for (const s of json.sources as Array<Record<string, unknown>>) {
      if (s.reach && typeof s.reach === 'object') {
        expect('backend' in s.reach).toBe(false)
        // channel/engine (BEAN's own lane names) stay: honest provenance.
        expect((s.reach as Record<string, unknown>).channel).toBe('github')
      }
    }
  })

  test('the IN-MEMORY metadata keeps full provenance (Trust receipts unaffected)', () => {
    expect(base.sources[0].reach?.backend).toBe('github-api')
  })

  test('serialization round-trips cleanly for metadata without reach', () => {
    const withoutReach: MessageMetadata = { ...base, sources: [base.sources[1]] }
    const json = metadataToJson(withoutReach)
    expect((json.sources as Array<Record<string, unknown>>)[0].hostName).toBe('example.com')
  })
})

describe('client model registry — customer-safe display projection', () => {
  test('display names carry no foundation model or runtime identity', () => {
    for (const m of getDefaultModelRegistry().listPublic()) {
      expect(m.displayName).not.toMatch(/qwen|whisper|modnet|webllm|web-llm|onnx|transformers/i)
      expect(m.runtimeLabel).not.toMatch(/web-llm|webllm|onnxruntime|transformers\.js/i)
      expect(m.licenseName).not.toMatch(/qwen|whisper|modnet|MLC|Xenova/i)
      expect(m.licenseName.length).toBeGreaterThan(0)
    }
  })

  test('every registry entry resolves to a customer-safe capability name', () => {
    expect(clientModelDisplayName('riishe-chat-webllm-qwen2.5-0.5b')).toBe('On-device chat model')
    expect(clientModelDisplayName('gangzii-asr-browser-whisper-tiny')).toBe('On-device speech transcription model')
    expect(clientModelDisplayName('laxii-bgremoval-modnet')).toBe('On-device background removal model')
    expect(clientModelDisplayName('unknown-id')).toBe('On-device AI model')
  })
})

describe('static scan — customer-facing components expose no backend identities', () => {
  // Foundation-model names / runtime package names / backend ids that must
  // never render in the customer UI (brief §9). Operator surfaces
  // (admin.tsx, admin-gateway.tsx) are exempt by design (restricted owner
  // diagnostics), and the local desktop engine setup text is exempt because
  // the user must run that command on their own machine.
  const FORBIDDEN = [
    /Qwen2\.5-0\.5B/i,
    /Kokoro-82M/i,
    /Whisper-tiny/i,
    /WebLLM/i,
    /\bweb-llm\b/i,
    /transformers\.js/i,
    /\bonnxruntime\b/i,
    /bean-llm-/,
    /bean-image-/,
    /bean-video-/,
    /bean-audio-/,
    /github-api/i,
  ]

  const CUSTOMER_COMPONENTS = [
    'src/components/bean/riishe.tsx',
    'src/components/bean/riishe/riishe-composer.tsx',
    'src/components/bean/riishe/riishe-messages.tsx',
    'src/components/bean/riishe/riishe-sidebar.tsx',
    'src/components/bean/riishe/riishe-memory-manager.tsx',
    'src/components/bean/riishe/use-riishe-chat.ts',
    'src/components/bean/ai-device-settings.tsx',
    'src/components/bean/gangzii.tsx',
    'src/components/bean/gangzii-narration.tsx',
    'src/components/bean/laxii.tsx',
    'src/components/bean/laxii/edit-history.tsx',
    'src/components/bean/jazmii.tsx',
    'src/components/bean/jazmii-director.tsx',
    'src/components/bean/code-giftz.tsx',
    'src/components/bean/dashboard.tsx',
    'src/components/bean/tasks.tsx',
    'src/components/bean/settings.tsx',
    'src/components/bean/research-status.tsx',
  ]

  for (const file of CUSTOMER_COMPONENTS) {
    test(`${file} contains no backend identity strings`, () => {
      const path = `${process.cwd()}/${file}`
      if (!existsSync(path)) {
        // Component moved/renamed: the scan list must stay current.
        throw new Error(`customer component missing from the hygiene scan: ${file}`)
      }
      let source = readFileSync(path, 'utf8')
      // Strip comments (block + line) so internal documentation notes are not
      // flagged — the scan targets RENDERED strings, not code comments.
      // 'https://…' survives: the ':' before '//' breaks the line-comment match.
      source = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, ' ')
      // FUNCTIONAL IDENTIFIER EXEMPTIONS (documented, exact-literal): registry
      // id lookups and Cache Storage namespace names the code must use to
      // function. They are routing/storage keys, never rendered identity.
      source = source
        .replace(/'riishe-chat-webllm-qwen2\.5-0\.5b'/g, "'<registry-id>'")
        .replace(/'gangzii-asr-browser-whisper-tiny'/g, "'<registry-id>'")
        .replace(/'laxii-bgremoval-modnet'/g, "'<registry-id>'")
        .replace(/'webllm\/model'|'webllm\/wasm'|'webllm\/config'/g, "'<cache-namespace>'")
        // Runtime probe property accessors (functional type contract, never
        // rendered): status.runtimes.webLlm / .transformersJs / .ortWeb.
        .replace(/\.runtimes\.(webLlm|transformersJs|ortWeb)/g, '.runtimes.<probe>')
        // Runtime enum values compared in code (functional contract, never
        // rendered): 'web-llm' | 'transformers.js' | 'onnxruntime-web'.
        .replace(/'(web-llm|transformers\.js|onnxruntime-web|wasm-binary)'/g, "'<runtime-enum>'")
      for (const pattern of FORBIDDEN) {
        const match = pattern.exec(source)
        if (match) {
          // Report the offending line for fast fixing.
          const line = source.slice(0, match.index).split('\n').length
          throw new Error(`identity leak in ${file}:${line} — matched ${pattern}`)
        }
      }
    })
  }

  test('operator surfaces are explicitly exempt from the customer scan (documented)', () => {
    // The admin gateway console INTENTIONALLY shows provider/model identity
    // (restricted owner diagnostics, brief §9) — pin the files exist so an
    // accidental rename cannot silently widen the customer scan.
    expect(existsSync(`${process.cwd()}/src/components/bean/admin.tsx`)).toBe(true)
    expect(existsSync(`${process.cwd()}/src/components/bean/admin-gateway.tsx`)).toBe(true)
  })
})
