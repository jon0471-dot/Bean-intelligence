/**
 * M49.2 BEAN AUTOBOT TEAMS — catalogue tests (pure).
 *
 * Pins:
 *  - every team template member spec references a REAL M49.1 agent template
 *    (no invented agents, no invented capabilities);
 *  - capability requirements are derived ONLY from the referenced agent
 *    templates' real capabilityKeys — truthful by construction;
 *  - the task-kind → capability map covers EVERY M41 task kind, and the
 *    verify-deliverable kind maps to the platform quality gate (never a
 *    member capability);
 *  - only genuinely assignable capabilities are advertised;
 *  - bounded limits: 2..8 members, vocabularies fixed.
 *
 * Run: bun test tests/unit/m49-2-team-catalog.test.ts
 */
import { describe, test, expect } from 'bun:test'

import {
  AGENT_TEMPLATES,
  AUTOBOT_CAPABILITIES,
  getTemplate as getAgentTemplate,
} from '../../src/lib/autobots/catalog'
import {
  ASSIGNABLE_TEAM_CAPABILITIES,
  QUALITY_GATE_CAPABILITY,
  TEAM_ASSIGNMENT_PREFERENCES,
  TEAM_LIMITS,
  TEAM_TEMPLATES,
  TEAM_TEMPLATE_COUNT,
  TEAM_TEMPLATE_MEMBER_KEYS,
  TEAM_WORKFLOW_PREFERENCES,
  TASK_KIND_TEAM_CAPABILITY,
  getTeamTemplate,
  templateRequiredCapabilities,
} from '../../src/lib/autobots/teams/catalog'
import { MISSION_TASK_KINDS } from '../../src/lib/riishe/mission/types'

describe('M49.2 team catalogue — template integrity', () => {
  test('every member spec references a REAL verified agent template', () => {
    expect(TEAM_TEMPLATES.length).toBeGreaterThan(0)
    for (const key of TEAM_TEMPLATE_MEMBER_KEYS) {
      const agent = getAgentTemplate(key)
      expect(agent).toBeDefined()
      expect(AUTOBOT_CAPABILITIES as readonly string[]).toContain(agent!.capabilityKey)
    }
  })

  test('every template carries honest limitations copy and a valid workflow preference', () => {
    for (const t of TEAM_TEMPLATES) {
      expect(t.limitations.length).toBeGreaterThan(20)
      expect((TEAM_WORKFLOW_PREFERENCES as readonly string[]).includes(t.workflowPreference)).toBe(true)
      expect(t.name.length).toBeGreaterThan(0)
      expect(t.name.length <= TEAM_LIMITS.nameChars).toBe(true)
      for (const m of t.memberSpecs) {
        expect(m.responsibility.length).toBeGreaterThan(0)
        expect(m.responsibility.length <= TEAM_LIMITS.responsibilityChars).toBe(true)
      }
    }
  })

  test('the custom-team template starts with an EMPTY roster (user builds it)', () => {
    const custom = getTeamTemplate('custom-team')
    expect(custom).toBeDefined()
    expect(custom!.memberSpecs.length).toBe(0)
  })

  test('template compositions stay inside the 2..8 member bound', () => {
    for (const t of TEAM_TEMPLATES) {
      if (t.key === 'custom-team') continue
      expect(t.memberSpecs.length).toBeGreaterThanOrEqual(TEAM_LIMITS.minMembers)
      expect(t.memberSpecs.length).toBeLessThanOrEqual(TEAM_LIMITS.maxMembers)
    }
  })

  test('no template claims a capability its members do not carry', () => {
    for (const t of TEAM_TEMPLATES) {
      const caps = templateRequiredCapabilities(t)
      for (const c of caps) {
        expect(AUTOBOT_CAPABILITIES as readonly string[]).toContain(c)
      }
      // Every advertised capability is actually present among the members.
      const memberCaps = new Set(t.memberSpecs.map((m) => getAgentTemplate(m.agentTemplateKey)!.capabilityKey))
      for (const c of caps) expect(memberCaps.has(c)).toBe(true)
    }
  })

  test('no planned products (AI STUDIO / NIIKI) appear as team capabilities', () => {
    const banned = ['ai-studio', 'niiki', 'studio', '3d']
    for (const t of TEAM_TEMPLATES) {
      for (const c of templateRequiredCapabilities(t)) {
        for (const bad of banned) {
          expect(c.includes(bad)).toBe(false)
        }
      }
    }
  })

  test('template count seam matches the collection', () => {
    expect(TEAM_TEMPLATE_COUNT).toBe(TEAM_TEMPLATES.length)
    expect(getTeamTemplate('does-not-exist')).toBeUndefined()
  })
})

describe('M49.2 team catalogue — task-kind → capability map', () => {
  test('EVERY M41 task kind is covered — no kind falls outside the map', () => {
    for (const kind of MISSION_TASK_KINDS) {
      expect(TASK_KIND_TEAM_CAPABILITY[kind]).toBeDefined()
    }
    expect(Object.keys(TASK_KIND_TEAM_CAPABILITY).length).toBe(MISSION_TASK_KINDS.length)
  })

  test('verify-deliverable maps to the PLATFORM quality gate — never a member capability', () => {
    expect(TASK_KIND_TEAM_CAPABILITY['verify-deliverable']).toBe(QUALITY_GATE_CAPABILITY)
    expect(QUALITY_GATE_CAPABILITY).toBe('quality-gate')
    expect((AUTOBOT_CAPABILITIES as readonly string[]).includes('quality-gate')).toBe(false)
  })

  test('research/document build on REAL lanes; engineering maps to CODE GIFTZ capability', () => {
    expect(TASK_KIND_TEAM_CAPABILITY.research).toBe('research')
    expect(TASK_KIND_TEAM_CAPABILITY.knowledge).toBe('research')
    expect(TASK_KIND_TEAM_CAPABILITY['code-build']).toBe('engineering')
    expect(TASK_KIND_TEAM_CAPABILITY['document-draft']).toBe('engineering')
    expect(TASK_KIND_TEAM_CAPABILITY['image-asset']).toBe('visual')
    expect(TASK_KIND_TEAM_CAPABILITY['video-asset']).toBe('motion')
    expect(TASK_KIND_TEAM_CAPABILITY['audio-asset']).toBe('voice')
  })

  test('only genuinely assignable capabilities are advertised for members', () => {
    for (const c of ASSIGNABLE_TEAM_CAPABILITIES) {
      expect(AUTOBOT_CAPABILITIES as readonly string[]).toContain(c)
      // advisory/review are conversation capabilities — no M41 task kind
      // maps to them in M49.2, so they must NOT be advertised as assignable.
      expect(['advisory', 'review'].includes(c)).toBe(false)
    }
  })

  test('assignment preferences and vocabularies are fixed and bounded', () => {
    expect([...TEAM_ASSIGNMENT_PREFERENCES]).toEqual(['team-order', 'leader-first'])
    expect(TEAM_LIMITS.minMembers).toBe(2)
    expect(TEAM_LIMITS.maxMembers).toBe(8)
    expect(TEAM_LIMITS.maxTeamsPerUser).toBeGreaterThan(0)
    expect(TEAM_LIMITS.snapshotMaxChars).toBeGreaterThan(0)
    // The AGENT catalogue still exports its full honest template collection.
    expect(AGENT_TEMPLATES.length).toBeGreaterThan(0)
  })
})
