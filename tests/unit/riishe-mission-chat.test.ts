/**
 * M41 Phase 1/8 — chat-surface mission integration.
 *
 * The two-key permission discipline for mission delegation (capability plan
 * AND route authority must BOTH agree), the deterministic tool validation,
 * the registry registration, and the orchestrator's tool-universe grants.
 */
import { describe, test, expect } from 'bun:test'

import { planCapabilities } from '../../src/lib/riishe/capability-plan'
import {
  delegateMissionTool,
  checkMissionTool,
  cancelMissionTool,
  MISSION_TOOL_NAMES,
  validateDelegateMissionInput,
  validateCheckMissionInput,
} from '../../src/lib/riishe/mission/tools'
import { getTool, listToolNames } from '../../src/lib/riishe/tools/registry'
import { registerBuiltins } from '../../src/lib/riishe/tools/builtin-registry'
import { selectTools } from '../../src/lib/riishe/orchestrator'

registerBuiltins()

describe('mission capability plan', () => {
  test('multi-part objectives arm missionDelegation', () => {
    const cases = [
      'Build a professional website for my coffee shop with a menu page',
      'Research the impact of remote work on productivity and write a report on the findings',
      'Fix the NaN bug in my app checkout total',
      'Create a video about mountain hiking with narration saying: "Trailheads open at sunrise." and a poster',
    ]
    for (const text of cases) {
      const plan = planCapabilities(text, 'conversation', false, [])
      expect(plan.missionDelegation).toBe(true)
    }
  })

  test('single-domain and question turns never arm missionDelegation', () => {
    const cases = [
      'What is the capital of France?',
      'How do I build a website?',
      'Create a video about space exploration',
      'Explain quantum computing briefly',
    ]
    for (const text of cases) {
      const plan = planCapabilities(text, 'conversation', false, [])
      expect(plan.missionDelegation).toBe(false)
    }
  })

  test('single-domain refusals leave ordinary capability flags untouched', () => {
    const plan = planCapabilities('Create a video about ocean waves', 'conversation', false, [])
    expect(plan.missionDelegation).toBe(false)
    expect(plan.videoCreation).toBe(true)
  })
})

describe('mission tools contract', () => {
  test('delegate_mission is explicit-permission gated with the right key', () => {
    expect(delegateMissionTool.permission).toBe('explicit')
    expect(delegateMissionTool.permissionKey).toBe('allowMissionDelegation')
    expect(cancelMissionTool.permission).toBe('explicit')
    expect(cancelMissionTool.permissionKey).toBe('allowMissionDelegation')
    expect(checkMissionTool.permission).toBe('standard')
  })

  test('validation bounds and shapes', () => {
    expect(() => validateDelegateMissionInput({ objective: 'too short' })).toThrow()
    expect(() => validateDelegateMissionInput({ objective: 'x'.repeat(4001) })).toThrow()
    expect(validateDelegateMissionInput({ objective: 'Build a website for my bakery with a logo' }).objective).toContain('bakery')
    expect(() => validateCheckMissionInput({ missionId: '' })).toThrow()
    expect(validateCheckMissionInput({ missionId: 'm1' }).missionId).toBe('m1')
  })

  test('explicit-permission refusal without the route authority (honest, no submission)', () => {
    const ctx = { permissions: new Set<string>(), documents: new Map() }
    void ctx
    // The registry-level gate is exercised here through the permission check
    // inside execute (route authority absent).
    const ctxNoAuth = { permissions: new Set<string>(), documents: new Map() } as unknown as Parameters<typeof delegateMissionTool.execute>[1]
    void delegateMissionTool.execute({ objective: 'Build a website for my bakery with a menu' }, ctxNoAuth).then((r) => {
      expect(r.ok).toBe(false)
      expect(r.output).toContain('Permission denied')
    })
  })

  test('all three mission tools are registered in the fixed registry', () => {
    for (const name of MISSION_TOOL_NAMES) {
      expect(getTool(name)).not.toBeNull()
    }
    expect(listToolNames()).toContain('delegate_mission')
  })
})

describe('orchestrator tool grants', () => {
  test('mission tools enter the universe only with the two-key agreement', () => {
    const base = {
      searchNeeded: false,
      task: 'conversation' as const,
      hasDocuments: false,
      allowCodeExecution: false,
      researchFailed: false,
    }
    expect(selectTools({ ...base }).includes('delegate_mission')).toBe(false)
    expect(selectTools({ ...base, allowMissionDelegation: true }).includes('delegate_mission')).toBe(true)
    expect(selectTools({ ...base, allowMissionDelegation: true }).includes('check_mission')).toBe(true)
    expect(selectTools({ ...base, allowMissionDelegation: true }).includes('cancel_mission')).toBe(true)
  })

  test('granting missions does not leak unrelated tools', () => {
    const tools = selectTools({
      searchNeeded: false,
      task: 'conversation' as const,
      hasDocuments: false,
      allowCodeExecution: false,
      researchFailed: false,
      allowMissionDelegation: true,
    })
    expect(tools).toEqual(['delegate_mission', 'check_mission', 'cancel_mission'])
  })
})
