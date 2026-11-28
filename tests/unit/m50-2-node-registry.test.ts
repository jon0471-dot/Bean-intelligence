/**
 * M50.2 BEAN AI STUDIO — node registry integrity tests (hermetic, pure).
 *
 * Pins the server-authoritative first-release catalogue: exactly the ten
 * approved nodes, every executable contract mapping to EXACTLY ONE real M41
 * task kind (no fabricated kinds), structural nodes carrying no task kind at
 * all, real specialist vocabularies (LAXII sizes, JAZMII video sizes,
 * GANGZII voices), contract limits inside the real M41 caps, honest
 * limitations and capability surfaces.
 *
 * Run: bun test tests/unit/m50-2-node-registry.test.ts
 */
import { describe, test, expect } from 'bun:test'

import {
  PROPOSED_NODE_TYPES,
  STUDIO_NODE_CONTRACTS,
  STUDIO_NODE_REGISTRY,
  getStudioNodeContract,
  listExecutableNodeContracts,
} from '../../src/lib/ai-studio/registry'
import { NODE_CONTRACT_VERSION, STUDIO_CONFIG_BOUNDS, WORKFLOW_LIMITS } from '../../src/lib/ai-studio/limits'
import {
  GANGZII_VOICES,
  JAZMII_VIDEO_SIZES,
  LAXII_SIZES,
} from '../../src/lib/registry/products'
import { validateCreateVideoInput } from '../../src/lib/riishe/specialists'
import { MISSION_TASK_KINDS, TASK_LIMIT_CAPS, normalizeLimits } from '../../src/lib/riishe/mission/types'
import { STUDIO_PORT_TYPES } from '../../src/lib/ai-studio/types'

const EXECUTABLES = listExecutableNodeContracts()
const STRUCTURALS = STUDIO_NODE_CONTRACTS.filter((c) => c.execution === 'structural')

describe('M50.2 registry — catalogue integrity', () => {
  test('exactly the ten approved first-release nodes exist', () => {
    expect(STUDIO_NODE_CONTRACTS).toHaveLength(10)
    const types = STUDIO_NODE_CONTRACTS.map((c) => c.nodeType)
    expect(new Set(types).size).toBe(10)
    for (const t of [
      'input.text',
      'research.web',
      'knowledge.atlas',
      'code.build',
      'document.draft',
      'image.create',
      'video.create',
      'audio.speech',
      'quality.verify',
      'output.deliverable',
    ]) {
      expect(types).toContain(t)
    }
  })

  test('every contract is version 1 with bounded, honest metadata', () => {
    for (const c of STUDIO_NODE_CONTRACTS) {
      expect(c.contractVersion).toBe(NODE_CONTRACT_VERSION)
      expect(c.displayName.length).toBeGreaterThan(0)
      expect(c.description.length).toBeGreaterThan(20)
      expect(c.limitations.length).toBeGreaterThan(0)
      for (const l of c.limitations) expect(l.length).toBeGreaterThan(5)
      expect(c.status).toBe('implemented-substrate')
      expect(c.trustRequirement).toBe('standard-gates')
      expect(WORKFLOW_LIMITS.configTextMaxChars).toBeGreaterThanOrEqual(0)
    }
  })

  test('every port spec uses a real first-release port type with bounded ids', () => {
    for (const c of STUDIO_NODE_CONTRACTS) {
      for (const p of [...c.inputs, ...c.outputs]) {
        expect(STUDIO_PORT_TYPES as readonly string[]).toContain(p.type)
        expect(p.id.length).toBeGreaterThan(0)
        expect(p.id.length).toBeLessThanOrEqual(32)
      }
      // Input ids unique within the node; output ids unique within the node.
      const inIds = c.inputs.map((p) => p.id)
      const outIds = c.outputs.map((p) => p.id)
      expect(new Set(inIds).size).toBe(inIds.length)
      expect(new Set(outIds).size).toBe(outIds.length)
    }
  })

  test('approval-ref is NOT an executable port type in this milestone', () => {
    expect(STUDIO_PORT_TYPES as readonly string[]).not.toContain('approval-ref')
  })
})

describe('M50.2 registry — executable/structural discrimination', () => {
  test('exactly eight executable contracts, each with exactly ONE real M41 kind', () => {
    expect(EXECUTABLES).toHaveLength(8)
    for (const c of EXECUTABLES) {
      expect(MISSION_TASK_KINDS as readonly string[]).toContain(c.taskKind)
      expect(c.verification).toBeDefined()
    }
  })

  test('the structural nodes carry NO task kind — the field cannot even be expressed', () => {
    expect(STRUCTURALS.map((c) => c.nodeType).sort()).toEqual(['input.text', 'output.deliverable'])
    for (const c of STRUCTURALS) {
      expect('taskKind' in c).toBe(false)
      expect('verification' in c).toBe(false)
      expect('limits' in c).toBe(false)
    }
  })

  test('no fabricated task kind exists anywhere in the registry module', () => {
    // Every taskKind referenced is a member of the M41 vocabulary (the
    // discriminated type makes a fake kind unrepresentable; this pins it).
    for (const c of EXECUTABLES) {
      expect((MISSION_TASK_KINDS as readonly string[]).includes(c.taskKind)).toBe(true)
    }
  })

  test('proposed/forbidden nodes are NOT executable contracts', () => {
    const types = STUDIO_NODE_CONTRACTS.map((c) => c.nodeType)
    for (const forbidden of ['approval.gate', 'agent.turn', 'team.mission', 'gateway.chat', 'niiki.scene', 'niiki.vfx', 'external.http', 'code.arbitrary']) {
      expect(types).not.toContain(forbidden)
      expect(PROPOSED_NODE_TYPES.map((p) => p.nodeType)).toContain(forbidden)
    }
    expect(PROPOSED_NODE_TYPES.every((p) => p.status === 'proposed')).toBe(true)
  })
})

describe('M50.2 registry — real specialist vocabularies', () => {
  test('image sizes are EXACTLY the existing LAXII registry presets', () => {
    const image = getStudioNodeContract('image.create')
    expect(image?.execution).toBe('executable')
    if (!image || image.execution !== 'executable') return
    const sizeField = image.config.find((f) => f.id === 'size')
    expect(sizeField?.type).toBe('enum')
    expect(sizeField?.enumValues).toEqual(LAXII_SIZES.map((s) => s.value))
  })

  test('video sizes are EXACTLY the specialist submit-path vocabulary (and the real validator accepts each)', () => {
    const video = getStudioNodeContract('video.create')
    expect(video?.execution).toBe('executable')
    if (!video || video.execution !== 'executable') return
    const sizeField = video.config.find((f) => f.id === 'size')
    expect(sizeField?.enumValues).toEqual([...JAZMII_VIDEO_SIZES])
    for (const size of JAZMII_VIDEO_SIZES) {
      expect(() => validateCreateVideoInput({ prompt: 'a short clip', size })).not.toThrow()
    }
    expect(() => validateCreateVideoInput({ prompt: 'a short clip', size: '4096x4096' })).toThrow()
  })

  test('voice ids are EXACTLY the GANGZII preset voices (no synthetic voices)', () => {
    const audio = getStudioNodeContract('audio.speech')
    expect(audio?.execution).toBe('executable')
    if (!audio || audio.execution !== 'executable') return
    const voiceField = audio.config.find((f) => f.id === 'voice')
    expect(voiceField?.enumValues).toEqual(GANGZII_VOICES.map((v) => v.value))
  })

  test('the audio narration cap mirrors the real 1000-character engine limit', () => {
    const audio = getStudioNodeContract('audio.speech')
    if (!audio || audio.execution !== 'executable') return
    const textField = audio.config.find((f) => f.id === 'text')
    expect(textField?.maxLength).toBe(STUDIO_CONFIG_BOUNDS.speechTextMaxChars)
    expect(textField?.maxLength).toBe(1000)
  })

  test('media prompt caps match the mission param bound (never silently clipped)', () => {
    for (const t of ['image.create', 'video.create']) {
      const c = getStudioNodeContract(t)
      if (!c || c.execution !== 'executable') continue
      const prompt = c.config.find((f) => f.id === 'prompt')
      expect(prompt?.maxLength).toBe(STUDIO_CONFIG_BOUNDS.mediaPromptMaxChars)
      expect(prompt?.maxLength).toBe(2_000)
    }
  })

  test('topic caps match the mission topic bound', () => {
    for (const t of ['research.web', 'knowledge.atlas']) {
      const c = getStudioNodeContract(t)
      if (!c || c.execution !== 'executable') continue
      const topic = c.config.find((f) => f.id === 'topic')
      expect(topic?.maxLength).toBe(STUDIO_CONFIG_BOUNDS.topicMaxChars)
    }
  })
})

describe('M50.2 registry — honest capability surfaces and limitations', () => {
  test('each node rides its REAL product surface', () => {
    const expected: Record<string, string> = {
      'input.text': 'platform',
      'research.web': 'riishe',
      'knowledge.atlas': 'riishe',
      'code.build': 'code-giftz',
      'document.draft': 'code-giftz',
      'image.create': 'laxii',
      'video.create': 'jazmii',
      'audio.speech': 'gangzii',
      'quality.verify': 'platform',
      'output.deliverable': 'platform',
    }
    for (const c of STUDIO_NODE_CONTRACTS) {
      expect(expected[c.nodeType]).toBe(c.capabilitySurface)
    }
  })

  test('JAZMII text-to-video honesty is pinned in the contract limitations', () => {
    const video = getStudioNodeContract('video.create')
    if (!video) return
    const joined = video.limitations.join(' ')
    expect(joined).toMatch(/text-to-video/i)
    expect(joined).toMatch(/not a render input|reference set/i)
  })

  test('GANGZII narration honesty is pinned (explicit text only)', () => {
    const audio = getStudioNodeContract('audio.speech')
    if (!audio) return
    const joined = audio.limitations.join(' ')
    expect(joined).toMatch(/explicit|never invent/i)
  })

  test('the QUALITY gate is platform-owned: no user config, platform surface', () => {
    const gate = getStudioNodeContract('quality.verify')
    expect(gate?.execution).toBe('executable')
    if (!gate || gate.execution !== 'executable') return
    expect(gate.config).toHaveLength(0)
    expect(gate.capabilitySurface).toBe('platform')
    expect(gate.taskKind).toBe('verify-deliverable')
    expect(gate.limitations.join(' ')).toMatch(/platform-controlled/i)
  })

  test('the deliverable marker produces nothing and has no outputs', () => {
    const marker = getStudioNodeContract('output.deliverable')
    expect(marker?.execution).toBe('structural')
    if (!marker) return
    expect(marker.outputs).toHaveLength(0)
  })
})

describe('M50.2 registry — limits inside the real M41 caps', () => {
  test('every executable contract normalizes within TASK_LIMIT_CAPS', () => {
    for (const c of EXECUTABLES) {
      const normalized = normalizeLimits(c.limits)
      expect(normalized.executionTimeoutMs).toBeLessThanOrEqual(TASK_LIMIT_CAPS.executionTimeoutMs)
      expect(normalized.maxAttempts).toBeLessThanOrEqual(TASK_LIMIT_CAPS.maxAttempts)
      expect(normalized.maxCorrections).toBeLessThanOrEqual(TASK_LIMIT_CAPS.maxCorrections)
    }
  })

  test('per-node limits mirror the inspected mission factories', () => {
    const byType = new Map(EXECUTABLES.map((c) => [c.nodeType, c]))
    expect(normalizeLimits(byType.get('research.web')?.limits).executionTimeoutMs).toBe(5 * 60_000)
    expect(normalizeLimits(byType.get('knowledge.atlas')?.limits).executionTimeoutMs).toBe(60_000)
    expect(normalizeLimits(byType.get('code.build')?.limits).executionTimeoutMs).toBe(20 * 60_000)
    expect(normalizeLimits(byType.get('document.draft')?.limits)).toEqual({
      executionTimeoutMs: 15 * 60_000,
      maxAttempts: 2,
      maxCorrections: 1,
    })
    expect(normalizeLimits(byType.get('quality.verify')?.limits).maxCorrections).toBe(0)
  })
})

describe('M50.2 registry — lookup helpers', () => {
  test('resolve() requires the exact contract version', () => {
    expect(STUDIO_NODE_REGISTRY.resolve('research.web', 1)?.nodeType).toBe('research.web')
    expect(STUDIO_NODE_REGISTRY.resolve('research.web', 2)).toBeNull()
    expect(STUDIO_NODE_REGISTRY.resolve('ai.magic', 1)).toBeNull()
    expect(getStudioNodeContract('quality.verify')?.nodeType).toBe('quality.verify')
    expect(getStudioNodeContract('approval.gate')).toBeNull()
  })
})
