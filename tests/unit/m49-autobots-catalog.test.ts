/**
 * M49.1 BEAN AUTOBOTS — catalogue integrity tests (pure, hermetic).
 *
 * Pins the honesty contract of the agent-workforce catalogue:
 *  - every template maps to a REAL capability that exists in this repo;
 *  - capability permission derivation is server-authoritative and minimal;
 *  - no template claims licensed-professional competence;
 *  - the character template forbids real-person impersonation;
 *  - planned products (AI STUDIO, NIIKI) are NOT advertised as implemented.
 *
 * Run: bun test tests/unit/m49-autobots-catalog.test.ts
 */
import { describe, test, expect } from 'bun:test'
import {
  AGENT_TEMPLATES,
  AUTOBOT_CAPABILITIES,
  AUTOBOT_CATEGORIES,
  AUTOBOT_LIMITS,
  CAPABILITY_INFO,
  CAPABILITY_PERMISSIONS,
  CATEGORY_LABELS,
  deriveAgentPermissions,
  getTemplate,
  isAutobotCapability,
  AGENT_BASE_PERMISSIONS,
} from '../../src/lib/autobots/catalog'

const KNOWN_PERMISSION_KEYS = new Set([
  'allowCodeExecution',
  'allowImageGeneration',
  'allowVideoCreation',
  'allowSpeechSynthesis',
  'allowCodingDelegation',
  'allowMissionDelegation',
  'allowExecutionGovernance',
])

describe('autobots catalogue: capability vocabulary', () => {
  test('capability ids are unique and every one carries honest info', () => {
    expect(new Set(AUTOBOT_CAPABILITIES).size).toBe(AUTOBOT_CAPABILITIES.length)
    for (const id of AUTOBOT_CAPABILITIES) {
      const info = CAPABILITY_INFO[id]
      expect(info.id).toBe(id)
      expect(info.label.length).toBeGreaterThan(0)
      expect(info.summary.length).toBeGreaterThan(20)
      expect(info.limits.length).toBeGreaterThan(20)
      expect(info.underlying.length).toBeGreaterThan(3)
    }
  })

  test('every capability maps to a REAL execution path (no planned products)', () => {
    for (const id of AUTOBOT_CAPABILITIES) {
      const text = `${CAPABILITY_INFO[id].underlying} ${CAPABILITY_INFO[id].summary}`.toLowerCase()
      // NIIKI and AI STUDIO are M51/M50 roadmap items — never implemented here.
      expect(text).not.toContain('niiki')
      expect(text).not.toContain('ai studio')
      expect(text).not.toContain('3d')
    }
  })

  test('delegation claims name only the real specialist surfaces', () => {
    expect(CAPABILITY_INFO.visual.delegation).toContain('LAXII')
    expect(CAPABILITY_INFO.motion.delegation).toContain('JAZMII')
    expect(CAPABILITY_INFO.voice.delegation).toContain('GANGZII')
    expect(CAPABILITY_INFO.engineering.delegation).toContain('CODE GIFTZ')
    expect(CAPABILITY_INFO.advisory.delegation).toBeNull()
    expect(CAPABILITY_INFO.research.delegation).toBeNull()
    expect(CAPABILITY_INFO.review.delegation).toBeNull()
  })

  test('categories: labels exist for every id, ids unique', () => {
    expect(new Set(AUTOBOT_CATEGORIES).size).toBe(AUTOBOT_CATEGORIES.length)
    for (const c of AUTOBOT_CATEGORIES) expect(CATEGORY_LABELS[c].length).toBeGreaterThan(2)
  })
})

describe('autobots capability → server permission derivation (THE security boundary)', () => {
  test('base grants ride every capability; delegation keys are capability-exact', () => {
    for (const id of AUTOBOT_CAPABILITIES) {
      const perms = deriveAgentPermissions(id)
      for (const base of AGENT_BASE_PERMISSIONS) expect(perms.has(base)).toBe(true)
      for (const extra of CAPABILITY_PERMISSIONS[id]) expect(perms.has(extra)).toBe(true)
    }
  })

  test('visual grants ONLY the image key among delegation keys', () => {
    const p = deriveAgentPermissions('visual')
    expect(p.has('allowImageGeneration')).toBe(true)
    expect(p.has('allowVideoCreation')).toBe(false)
    expect(p.has('allowSpeechSynthesis')).toBe(false)
    expect(p.has('allowCodingDelegation')).toBe(false)
  })

  test('motion / voice / engineering grant exactly their own key', () => {
    expect(deriveAgentPermissions('motion').has('allowVideoCreation')).toBe(true)
    expect(deriveAgentPermissions('motion').has('allowImageGeneration')).toBe(false)
    expect(deriveAgentPermissions('voice').has('allowSpeechSynthesis')).toBe(true)
    expect(deriveAgentPermissions('voice').has('allowCodingDelegation')).toBe(false)
    expect(deriveAgentPermissions('engineering').has('allowCodingDelegation')).toBe(true)
    expect(deriveAgentPermissions('engineering').has('allowImageGeneration')).toBe(false)
  })

  test('advisory/research/review get NO specialist delegation keys', () => {
    for (const id of ['advisory', 'research', 'review'] as const) {
      const p = deriveAgentPermissions(id)
      expect(p.has('allowImageGeneration')).toBe(false)
      expect(p.has('allowVideoCreation')).toBe(false)
      expect(p.has('allowSpeechSynthesis')).toBe(false)
      expect(p.has('allowCodingDelegation')).toBe(false)
    }
  })

  test('UNKNOWN keys degrade to the base set — never widen', () => {
    const p = deriveAgentPermissions('allowImageGeneration allowVideoCreation allowSpeechSynthesis')
    const base = deriveAgentPermissions('advisory')
    expect([...p].sort()).toEqual([...base].sort())
    expect(deriveAgentPermissions('niiki-3d-vfx').size).toBe(base.size)
  })

  test('the permission universe never exceeds the known server keys', () => {
    for (const id of AUTOBOT_CAPABILITIES) {
      for (const key of deriveAgentPermissions(id)) {
        expect(KNOWN_PERMISSION_KEYS.has(key)).toBe(true)
      }
    }
  })

  test('isAutobotCapability rejects permission-key-shaped strings', () => {
    expect(isAutobotCapability('allowImageGeneration')).toBe(false)
    expect(isAutobotCapability('visual')).toBe(true)
    expect(isAutobotCapability(null)).toBe(false)
    expect(isAutobotCapability(42)).toBe(false)
  })
})

describe('autobots templates: verified collection honesty', () => {
  test('keys are unique; every template is fully bounded and valid', () => {
    const keys = new Set<string>()
    for (const t of AGENT_TEMPLATES) {
      expect(keys.has(t.key)).toBe(false)
      keys.add(t.key)
      expect(getTemplate(t.key)).toBe(t)
      expect(AUTOBOT_CATEGORIES as readonly string[]).toContain(t.category)
      expect(isAutobotCapability(t.capabilityKey)).toBe(true)
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.name.length).toBeLessThanOrEqual(AUTOBOT_LIMITS.nameChars)
      expect(t.role.length).toBeGreaterThan(0)
      expect(t.role.length).toBeLessThanOrEqual(AUTOBOT_LIMITS.roleChars)
      expect(t.industry.length).toBeGreaterThan(0)
      expect(t.industry.length).toBeLessThanOrEqual(AUTOBOT_LIMITS.industryChars)
      expect(t.description.length).toBeGreaterThanOrEqual(3)
      expect(t.description.length).toBeLessThanOrEqual(AUTOBOT_LIMITS.descriptionChars)
      expect(t.personality.length).toBeGreaterThan(0)
      expect(t.personality.length).toBeLessThanOrEqual(AUTOBOT_LIMITS.personalityChars)
      expect(t.instructions.length).toBeGreaterThan(0)
      expect(t.instructions.length).toBeLessThanOrEqual(AUTOBOT_LIMITS.instructionsChars)
      expect(t.languages.length).toBeGreaterThan(0)
      expect(t.languages.length).toBeLessThanOrEqual(AUTOBOT_LIMITS.languageChars)
      // EVERY template states what the agent CANNOT do — no silent claims.
      expect(t.limitations.length).toBeGreaterThan(20)
    }
  })

  test('every suggested category carries at least one verified template', () => {
    for (const c of AUTOBOT_CATEGORIES) {
      expect(AGENT_TEMPLATES.some((t) => t.category === c)).toBe(true)
    }
  })

  test('no template claims licensed-professional competence', () => {
    const forbidden = [
      /i am a licensed/i,
      /as a licensed (lawyer|attorney|doctor|physician|accountant|cpa)/i,
      /i am a (lawyer|doctor|accountant|physician)/i,
      /qualified (lawyer|doctor|accountant|physician)/i,
      /legal advice you can rely on/i,
      /medical diagnosis/i,
      /prescribe/i,
    ]
    for (const t of AGENT_TEMPLATES) {
      const text = `${t.name} ${t.role} ${t.description} ${t.personality} ${t.instructions}`
      for (const re of forbidden) expect(re.test(text)).toBe(false)
    }
  })

  test('professional-adjacent templates state the licensed-advisor boundary', () => {
    for (const key of ['business-strategist', 'market-researcher']) {
      const t = getTemplate(key)
      expect(t).toBeDefined()
      expect(t!.limitations.toLowerCase()).toMatch(/not a licensed|not (investment|legal)/)
    }
  })

  test('the character template forbids real-person impersonation', () => {
    const t = getTemplate('character-companion')
    expect(t).toBeDefined()
    expect(t!.instructions).toMatch(/never impersonate a real identifiable person/i)
    expect(t!.limitations.toLowerCase()).toContain('original characters only')
  })

  test('specialist-delegating templates keep the honest queued-status discipline', () => {
    expect(getTemplate('brand-visualist')!.instructions).toMatch(/queued background job|never claim/i)
    expect(getTemplate('video-producer')!.instructions).toMatch(/honest queued status|never claim/i)
    expect(getTemplate('voice-narrator')!.instructions).toMatch(/honest queued status|never claim/i)
    expect(getTemplate('software-engineer')!.limitations).toMatch(/nothing deploys|gates/i)
  })

  test('the collection is a useful starting set (not a stub, not an encyclopedia)', () => {
    expect(AGENT_TEMPLATES.length).toBeGreaterThanOrEqual(12)
    expect(AGENT_TEMPLATES.length).toBeLessThanOrEqual(30)
  })
})
