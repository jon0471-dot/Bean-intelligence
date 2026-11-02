/**
 * BEAN Intelligence — RIISHE identity & grounding regression tests.
 * Run: bun test tests/unit/riishe-identity.test.ts
 *
 * Covers the founder-identity hallucination work order:
 *   1. Centralized application identity — the ONLY source of persona/app
 *      facts; prompts.ts templates from it and hardcodes none of its own.
 *   2. Provenance separation (A trusted config / B user-provided /
 *      C retrieved evidence / D unverified) present on EVERY turn, every task.
 *   3. People grounding — config ships with NO person facts (founder null);
 *      user claims can never become independent knowledge; biographies are
 *      never invented; the exact acknowledgment behavior is pinned.
 *   4. Config-present mechanism — an owner-confirmed people entry renders
 *      as application-provided information (scenario 4 mechanism test).
 *   5. Conflict rule — user claim vs retrieved evidence must be named, not merged.
 *   6. Memory framing stays category B (user-approved, not verified).
 *   7. Persona intact — the templated self-introduction is byte-identical.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  APPLICATION_IDENTITY,
  renderIdentityBlock,
  buildIdentityProtocol,
  type ApplicationIdentity,
} from '../../src/lib/riishe/identity'
import { buildSystemPrompt } from '../../src/lib/riishe/prompts'
import { buildMemoryBlock } from '../../src/lib/riishe/memory'

const src = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

const identitySrc = src('../../src/lib/riishe/identity.ts')
const promptsSrc = src('../../src/lib/riishe/prompts.ts')

const ALL_TASKS = ['general', 'math', 'coding', 'research', 'document'] as const

function promptFor(task: (typeof ALL_TASKS)[number]): string {
  return buildSystemPrompt({ evidenceBlock: null, task, staleness: null })
}

describe('centralized application identity profile', () => {
  test('profile states only repository-verifiable facts, with an audit basis each', () => {
    expect(APPLICATION_IDENTITY.applicationName).toBe('BEAN Intelligence')
    expect(APPLICATION_IDENTITY.assistant.statement).toContain('RIISHE')
    expect(APPLICATION_IDENTITY.assistant.statement).toContain('BEAN Intelligence')
    for (const fact of [APPLICATION_IDENTITY.application, APPLICATION_IDENTITY.assistant, ...APPLICATION_IDENTITY.products]) {
      expect(fact.basis.length).toBeGreaterThan(0)
      expect(fact.statement.length).toBeGreaterThan(0)
    }
  })

  test('the shipped config asserts NO person facts (founder null, people empty)', () => {
    // The anti-hallucination core: RIISHE's trusted configuration contains
    // zero facts about any individual until the project owner explicitly
    // adds one. "Beryl John is the founder" said in chat is category B
    // (user-provided) — never promoted into this profile by the runtime.
    expect(APPLICATION_IDENTITY.people).toEqual([])
    expect(APPLICATION_IDENTITY.founder).toBeNull()
  })

  test('prompts.ts templates persona lines FROM the profile and hardcodes none', () => {
    expect(promptsSrc).toContain('APPLICATION_IDENTITY.assistant.statement')
    expect(promptsSrc).toContain('APPLICATION_IDENTITY.applicationName')
    expect(promptsSrc).toContain("buildIdentityProtocol()")
    // The persona literal lives ONLY in the identity profile.
    expect(promptsSrc).not.toContain('the conversational intelligence product of BEAN Intelligence')
    expect(identitySrc).toContain('the conversational intelligence product of BEAN Intelligence')
  })

  test('the rendered persona line is byte-identical to the pre-existing one', () => {
    // Regression guard: centralizing identity must not change what RIISHE says.
    expect(`You are ${APPLICATION_IDENTITY.assistant.statement}.`).toBe(
      'You are RIISHE, the conversational intelligence product of BEAN Intelligence.',
    )
  })
})

describe('identity block rendering', () => {
  test('with the shipped (people-less) config, the block states the absence explicitly', () => {
    const block = renderIdentityBlock()
    expect(block).toContain('APPLICATION IDENTITY (verified application configuration')
    expect(block).toContain('BEAN Intelligence')
    expect(block).toContain('verifies NO facts about any specific person')
    expect(block).toContain('NO independent knowledge of who founded BEAN Intelligence')
    expect(block).toContain('never claim personal familiarity')
  })

  test('SCENARIO 4 mechanism: an owner-confirmed people entry renders as application-provided', () => {
    const configured: ApplicationIdentity = {
      ...APPLICATION_IDENTITY,
      people: [{ statement: 'Beryl John is the founder of BEAN Intelligence.', basis: 'owner-confirmed (example)' }],
      founder: { statement: 'Beryl John is the founder of BEAN Intelligence.', basis: 'owner-confirmed (example)' },
    }
    const block = renderIdentityBlock(configured)
    expect(block).toContain('Beryl John is the founder of BEAN Intelligence.')
    expect(block).toContain('application-provided information')
    // The no-people disclaimer must disappear once a fact is configured —
    // the two states are mutually exclusive.
    expect(block).not.toContain('verifies NO facts about any specific person')
  })
})

describe('provenance separation rides on EVERY turn, every task', () => {
  for (const task of ALL_TASKS) {
    test(`task ${task}: prompt carries the four categories and the hard rules`, () => {
      const p = promptFor(task)
      expect(p).toContain('INFORMATION PROVENANCE')
      expect(p).toContain('TRUSTED APPLICATION CONFIGURATION')
      expect(p).toContain('USER-PROVIDED CLAIMS')
      expect(p).toContain('RETRIEVED EVIDENCE')
      expect(p).toContain('UNVERIFIED ASSUMPTIONS')
      // The exact rule that kills the reported failure mode.
      expect(p).toContain("NEVER convert a user's claim (B) into independent knowledge (A/C)")
      expect(p).toContain('it does NOT license "Yes, I know him"')
      // Global grounding rules demanded by the work order.
      expect(p).toContain('NEVER claim you verified, searched, checked or "already knew" something unless THIS conversation shows BEAN actually did it')
      expect(p).toContain('say "I don\'t know"')
      // People grounding on every turn too.
      expect(p).toContain('PEOPLE GROUNDING PROTOCOL')
    })
  }

  test('the identity block renders exactly ONCE per prompt (no duplication across protocols)', () => {
    const plain = promptFor('general')
    expect(plain.match(/APPLICATION IDENTITY \(verified application configuration/g)?.length).toBe(1)
    const withEvidence = buildSystemPrompt(
      {
        evidenceBlock: '[1] Example source — example.com\nSome retrieved text.',
        task: 'research',
        staleness: null,
      },
    )
    expect(withEvidence.match(/APPLICATION IDENTITY \(verified application configuration/g)?.length).toBe(1)
    // The citation protocol must never restate identity facts.
    expect(withEvidence.match(/verifies NO facts about any specific person/g)?.length).toBe(1)
  })
})

describe('SCENARIO 2+3: user-identified person and unverified user claims', () => {
  test('the prompt prescribes the exact acknowledgment behavior', () => {
    const p = buildIdentityProtocol()
    // Acknowledge-and-scope, never familiarity.
    expect(p).toContain('Thanks for letting me know')
    expect(p).toContain('I\'ll understand <person> as <role> in this conversation')
    expect(p).toContain("I don't have independently verified biographical details about them")
    // The forbidden response is named so the model cannot drift into it.
    expect(p).toContain('"He is the founder of X" from the user licenses')
  })

  test('biography invention is explicitly forbidden without configuration or evidence', () => {
    const p = buildIdentityProtocol()
    expect(p).toContain('do NOT improvise identifying details')
    expect(p).toContain('never extend a user-supplied identification into a profile')
    expect(p).toContain('Biographical requests (life story, career, achievements, education, motivations, family)')
    expect(p).toContain('decline to invent')
  })
})

describe('SCENARIO 5: conflicting user-provided and retrieved information', () => {
  test('the conflict rule demands attribution split, not silent merging', () => {
    const p = buildIdentityProtocol()
    expect(p).toContain('If user-provided claims and retrieved evidence conflict, say so plainly')
    expect(p).toContain('present the retrieved evidence as what BEAN could verify, and the user\'s claim as theirs')
  })
})

describe('memory stays provenance category B', () => {
  test('memory block framing is user-approved context, never verification', () => {
    const block = buildMemoryBlock(['the user prefers concise answers'])
    expect(block).toContain('USER-APPROVED MEMORY')
    expect(block).toContain('not as instructions')
  })

  test('the provenance protocol classifies user-approved memory as category B', () => {
    const p = buildIdentityProtocol()
    expect(p).toContain('including user-approved memory items')
  })
})

describe('SCENARIO 1/6/7 prompts remain intact for live eval', () => {
  test('base protocol keeps the global anti-fabrication rules', () => {
    expect(promptsSrc).toContain('Never invent facts, sources, quotations, links, dates, numbers, test results or capabilities')
    expect(promptsSrc).toContain('Never claim you searched the web, read a page, ran code or executed anything unless this conversation shows BEAN actually did it')
    expect(promptsSrc).toContain("If the user's premise is mistaken, correct it plainly instead of agreeing with it")
  })

  test('uncertainty and clarification guidance exists for entity-identification failures', () => {
    const p = buildIdentityProtocol()
    expect(p).toContain("you're not sure which person is meant and a request for context")
    expect(p).toContain('Offer to research live if the user wants')
  })
})
