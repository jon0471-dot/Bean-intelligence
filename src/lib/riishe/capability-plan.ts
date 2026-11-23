/**
 * BEAN Intelligence — per-turn capability planning (pure, deterministic).
 *
 * The composer no longer exposes mode toggles: RIISHE decides which
 * capabilities a turn needs, from the message and the attached files.
 * This module is the auditable decision surface:
 *
 *  - live retrieval is decided by the research policy + semantic router
 *    (unchanged — see resolveSearchDecisionLive);
 *  - code execution is granted when the task genuinely needs it (math with
 *    nontrivial arithmetic, explicit "run/execute/simulate" requests) and
 *    the restricted sandbox exists — the sandbox itself stays bounded and
 *    isolated exactly as before;
 *  - document/image capabilities activate from the attachments themselves.
 *
 * Removing the user-facing buttons does NOT remove any backend capability:
 * this planner keeps every decision explicit and testable.
 */

export interface CapabilityPlan {
  /** Grant run_code for this turn (sandbox availability checked separately). */
  codeExecution: boolean
  /** Grant analyze_image for this turn (true iff an image is attached — the
   *  user attached it, so re-consulting its pixels needs no extra consent;
   *  the grant still flows through the explicit permission-key registry). */
  imageAnalysis: boolean
  /**
   * M36-C — delegate image creation to the LAXII specialist this turn
   * (deterministic detection of an actual creation request; NOT triggered
   * by questions ABOUT images or by attached images).
   */
  imageGeneration: boolean
  /** Delegate text-to-video creation to the JAZMII specialist this turn. */
  videoCreation: boolean
  /** Delegate speech synthesis to the GANGZII specialist this turn. */
  speechSynthesis: boolean
  /** Human-readable reasons (logged; safe for support). */
  reasons: string[]
}

const EXECUTION_REQUEST_RE =
  /\b(run|execute|evaluate)\s+(this|the)?\s*(code|script|snippet|program|function|calculation|computation)/i
/** Simulation inherently requires execution. */
const SIMULATION_RE = /\b(simulate|simulation|monte\s+carlo)\b/i
const CODE_ARTIFACT_RE =
  /\b(javascript|typescript|node|python-style logic|algorithm|pseudocode)\b.{0,60}\b(verify|test|trace|simulate|compute|run)\b/i

/** Genuinely-computational shapes: the sandbox adds real value here. */
const HEAVY_COMPUTE_RE =
  /\b(factorial|permutation|combination|matrix|modular|exponent|fibonacci|prime|hash|monte\s+carlo|big\s+number|\d{3,}\s*[*/^]\s*\d{3,})|\b\d+\s*!\s*(mod|%|\+|-|<|>|=|$)/i

/**
 * M36-C — media-creation request shapes. Deliberately NARROW: they must
 * carry an explicit creation verb AND a concrete artifact noun. Questions
 * ("how do I draw…"), opinions ("is this image good…") and analysis requests
 * never match, so the model cannot submit surprise generation jobs.
 */
const IMAGE_CREATE_RE =
  /\b(create|generate|draw|make|design|produce|render)\b[^.?!;]{0,80}\b(image|picture|photo|illustration|artwork|logo|icon|drawing|painting|poster|wallpaper)\b/i
const VIDEO_CREATE_RE =
  /\b(create|generate|make|produce|render)\b[^.?!;]{0,80}\b(video|clip|animation|short film|footage)\b/i
const SPEECH_CREATE_RE =
  /\b(read|speak|say|narrate|voice|pronounce|turn)\b[^.?!;]{0,60}\b(aloud|out loud|into speech|into audio|into a voice|this text)\b/i

export function planCapabilities(
  message: string,
  task: string,
  hasDocuments: boolean,
  /** Kinds of the attached documents (from the ownership-checked rows). */
  documentKinds: ReadonlyArray<string> = [],
): CapabilityPlan {
  const reasons: string[] = []
  const text = message.trim()

  let codeExecution = false
  if (EXECUTION_REQUEST_RE.test(text)) {
    codeExecution = true
    reasons.push('execution requested explicitly')
  } else if (SIMULATION_RE.test(text)) {
    codeExecution = true
    reasons.push('simulation requires execution')
  } else if (task === 'math' && HEAVY_COMPUTE_RE.test(text)) {
    codeExecution = true
    reasons.push('computational task benefits from sandbox verification')
  } else if (CODE_ARTIFACT_RE.test(text)) {
    codeExecution = true
    reasons.push('code behavior verification requested')
  }

  const hasImage = documentKinds.includes('image')
  if (hasImage) reasons.push('image attachment: analyze_image vision re-consultation activated')
  if (hasDocuments) reasons.push('attachments present: document/image tools activated from file kinds')

  // M36-C — media delegation planning (deterministic, plan-narrowed).
  let imageGeneration = false
  let videoCreation = false
  let speechSynthesis = false
  if (IMAGE_CREATE_RE.test(text)) {
    imageGeneration = true
    reasons.push('image creation requested explicitly: delegate to the image specialist')
  }
  if (VIDEO_CREATE_RE.test(text)) {
    videoCreation = true
    reasons.push('video creation requested explicitly: delegate to the video specialist')
  }
  if (SPEECH_CREATE_RE.test(text)) {
    speechSynthesis = true
    reasons.push('speech synthesis requested explicitly: delegate to the audio specialist')
  }

  return { codeExecution, imageAnalysis: hasImage, imageGeneration, videoCreation, speechSynthesis, reasons }
}
