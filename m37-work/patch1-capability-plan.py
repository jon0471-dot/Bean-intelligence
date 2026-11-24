#!/usr/bin/env python3
"""M37 patch: capability-plan.ts — coding-delegation + strict doc-grounding flags."""
import sys, pathlib

p = pathlib.Path('/home/z/my-project/src/lib/riishe/capability-plan.ts')
src = p.read_text()

def sub(old, new):
    global src
    if old not in src:
        print(f"FAIL: anchor not found:\n{old[:200]}")
        sys.exit(1)
    if src.count(old) != 1:
        print(f"FAIL: anchor not unique ({src.count(old)}x):\n{old[:200]}")
        sys.exit(1)
    src = src.replace(old, new)

# 1. Interface fields
sub("""  /** Delegate speech synthesis to the GANGZII specialist this turn. */
  speechSynthesis: boolean
  /** Human-readable reasons (logged; safe for support). */
  reasons: string[]
}""",
"""  /** Delegate speech synthesis to the GANGZII specialist this turn. */
  speechSynthesis: boolean
  /**
   * M37 — delegate real implementation work to the CODE GIFTZ engineering
   * workflow this turn (deterministic detection of an explicit build/fix
   * request for a development artifact; questions about code and snippet
   * explanations never match — run_code stays the tool for those).
   */
  codingDelegation: boolean
  /**
   * M37 §2 — STRICT DOCUMENT GROUNDING requested ("based only on the
   * documents", "only from the attached report"). When set WITH attached
   * documents, the orchestrator suppresses web retrieval for the turn and
   * the composer must not silently substitute general knowledge.
   */
  docOnlyGrounding: boolean
  /** Human-readable reasons (logged; safe for support). */
  reasons: string[]
}""")

# 2. Detection regexes (after SPEECH_CREATE_RE)
sub("""const SPEECH_CREATE_RE =
  /\\b(read|speak|say|narrate|voice|pronounce|turn)\\b[^.?!;]{0,60}\\b(aloud|out loud|into speech|into audio|into a voice|this text)\\b/i
""",
"""const SPEECH_CREATE_RE =
  /\\b(read|speak|say|narrate|voice|pronounce|turn)\\b[^.?!;]{0,60}\\b(aloud|out loud|into speech|into audio|into a voice|this text)\\b/i

/**
 * M37 — implementation-request shapes for CODE GIFTZ delegation. Explicit
 * creation/modification verb + a DEVELOPMENT artifact noun. Media nouns
 * (image, video, speech) are intentionally absent: those requests delegate
 * to the media specialists, never to the coding workspace. Questions
 * ("how do I build…") and explanations ("what does this function do") do
 * not match — run_code remains the tool for snippet execution.
 */
const CODE_BUILD_RE =
  /\\b(build|create|make|develop|implement|write|code|generate|fix|debug|repair|add|set\\s+up)\\b[^.?!;]{0,90}\\b(landing\\s+page|website|web\\s?app|webpage|home\\s?page|dashboard|api|endpoint|rest\\s+api|function|script|program|app\\b|application|feature|component|form|database|schema|bug\\b|bugfix|unit\\s+test|calculator|portfolio|game|plugin|chatbot|cli|integration|cron|auth\\s+flow|payment\\s+flow|checkout|refactor)\\b/i

/**
 * M37 §2 — strict document-grounding phrasings. When the user asks for an
 * answer drawn ONLY from the attached documents, the orchestrator must not
 * silently substitute general knowledge (and must not run a web search that
 * would blur the contract).
 */
const DOC_ONLY_RE =
  /\\b(based\\s+(only|solely|exclusively|just)\\s+on\\s+(the\\s+|my\\s+)?(attached\\s+)?(documents?|files?|reports?|pdfs?)|only\\s+from\\s+(the\\s+|my\\s+)?(attached\\s+)?(documents?|files?|attachments?|reports?|pdfs?)|from\\s+(the\\s+|my\\s+)?(attached\\s+)?(documents?|files?|reports?)\\s+alone|(only|strictly)\\s+(according\\s+to|using|from)\\s+(the\\s+|my\\s+)?(attached\\s+)?(documents?|files?|reports?|pdfs?)|(stick|limit)\\s+(to|it)\\s+(strictly\\s+)?to\\s+(the\\s+)?(attached\\s+)?(documents?|files?|reports?))\\b/i
""")

# 3. planCapabilities: new flags
sub("""export function planCapabilities(
  message: string,
  task: string,
  hasDocuments: boolean,
  /** Kinds of the attached documents (from the ownership-checked rows). */
  documentKinds: ReadonlyArray<string> = [],
): CapabilityPlan {""",
"""export function planCapabilities(
  message: string,
  task: string,
  hasDocuments: boolean,
  /** Kinds of the attached documents (from the ownership-checked rows). */
  documentKinds: ReadonlyArray<string> = [],
): CapabilityPlan {
  // M37: the strict-grounding and delegation flags are computed on the RAW
  // message below; `task` and `hasDocuments` only shape the existing flags.
""")

sub("""  if (SPEECH_CREATE_RE.test(text)) {
    speechSynthesis = true
    reasons.push('speech synthesis requested explicitly: delegate to the audio specialist')
  }

  return { codeExecution, imageAnalysis: hasImage, imageGeneration, videoCreation, speechSynthesis, reasons }
}""",
"""  if (SPEECH_CREATE_RE.test(text)) {
    speechSynthesis = true
    reasons.push('speech synthesis requested explicitly: delegate to the audio specialist')
  }

  // M37 — CODE GIFTZ delegation planning (deterministic, plan-narrowed).
  let codingDelegation = false
  if (CODE_BUILD_RE.test(text)) {
    codingDelegation = true
    reasons.push('implementation work requested explicitly: delegate to the engineering workspace')
  }

  // M37 §2 — strict document grounding (contract applies only WITH documents;
  // the orchestrator enforces that pairing).
  let docOnlyGrounding = false
  if (DOC_ONLY_RE.test(text)) {
    docOnlyGrounding = true
    reasons.push('strict document grounding requested: answer only from the attached documents')
  }

  return {
    codeExecution,
    imageAnalysis: hasImage,
    imageGeneration,
    videoCreation,
    speechSynthesis,
    codingDelegation,
    docOnlyGrounding,
    reasons,
  }
}""")

p.write_text(src)
print("capability-plan.ts patched OK")
