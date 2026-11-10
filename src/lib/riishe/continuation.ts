/**
 * BEAN Intelligence — controlled continuation for output-token truncation.
 *
 * When the provider cuts an answer at its output-length limit
 * (finish_reason "length" → UpstreamTruncatedError), the honest options are:
 * label the answer incomplete, or CONTINUE it in a controlled way. This
 * module implements the controlled continuation required by the 2026-11-03
 * reliability work order:
 *
 *  - the partial text is PRESERVED (it becomes the assistant turn the
 *    continuation builds on — nothing is discarded or rewritten);
 *  - the continuation pass is instructed to resume EXACTLY where the
 *    previous pass stopped, without repeating any earlier text;
 *  - the number of continuation passes is BOUNDED (MAX_SOLVE_CONTINUATIONS)
 *    so resource use stays controlled — a model that keeps hitting the cap
 *    cannot loop forever;
 *  - when the bound is reached the typed UpstreamTruncatedError propagates:
 *    the caller keeps the partial (streamed deltas + concatenation) and the
 *    client labels it incomplete. No fake completion is ever produced.
 *
 * Pure orchestration — the solve pass itself is injected, so tests drive it
 * with fake truncation/success sequences and no network.
 */
import type { ChatTurn } from '@/lib/adapters/types'
import { UpstreamTruncatedError } from '@/lib/adapters/hosted-llm'

/**
 * Maximum continuation passes per solve. One continuation reliably completes
 * long-but-bounded answers; more would multiply upstream cost per turn.
 * Deliberately a constant (not user-configurable): it bounds worst-case
 * resource use per turn.
 */
export const MAX_SOLVE_CONTINUATIONS = 1

/**
 * The continuation instruction. Addresses the model directly: resume, do not
 * repeat, do not re-greet or re-introduce. The partial is present as the
 * assistant turn immediately before this user message, so "continue" has an
 * unambiguous referent.
 */
export const CONTINUATION_INSTRUCTION =
  'Your reply above was cut off by the output length limit. Continue EXACTLY where it stopped — ' +
  'resume mid-sentence if that is where it stopped — without repeating any text you already wrote, ' +
  'without re-introducing the topic, and without adding a new preamble. Finish the remaining answer.'

/**
 * Build the message list for one continuation pass: the original messages,
 * the partial answer as the assistant turn, then the continuation ask.
 */
export function buildContinuationMessages(
  baseMessages: ChatTurn[],
  partialText: string,
): ChatTurn[] {
  return [
    ...baseMessages,
    { role: 'assistant', content: partialText },
    { role: 'user', content: CONTINUATION_INSTRUCTION },
  ]
}

export interface ContinuationOutcome {
  /** The FULL answer: first-pass partial + every continuation pass, in order. */
  content: string
  /** How many continuation passes actually ran (0 = completed first pass). */
  continuationCount: number
}

export interface SolveWithContinuationArgs {
  /** The original solve messages (system + history + user turn). */
  baseMessages: ChatTurn[]
  /**
   * One solve pass. Streams its own deltas (the caller's concern) and returns
   * the full text it produced. Throws UpstreamTruncatedError when the
   * provider hit the output cap; the error's `partialText` (non-streaming)
   * carries the pass's truncated output — for streaming passes the caller
   * attaches the same text before rethrowing so the driver can continue.
   */
  solvePass: (messages: ChatTurn[]) => Promise<string>
  maxContinuations?: number
}

/**
 * Run the solve pass; on a length-cap truncation, continue (bounded).
 * Guarantees:
 *  - normal completion → { content, continuationCount: 0 };
 *  - truncation with usable partial → continuation passes appended in order;
 *  - truncation with an EMPTY partial → no continuation is attempted (there
 *    is nothing to continue from; the typed error propagates untouched);
 *  - bound reached → the LAST truncation error propagates after the partial
 *    passes' text is preserved in the thrown error's partialText, so the
 *    caller can still surface/preserve everything that was produced.
 */
export async function solveWithContinuation(
  args: SolveWithContinuationArgs,
): Promise<ContinuationOutcome> {
  const maxContinuations = args.maxContinuations ?? MAX_SOLVE_CONTINUATIONS
  let accumulated = ''
  let messages = args.baseMessages
  for (let pass = 0; ; pass += 1) {
    try {
      const text = await args.solvePass(messages)
      return { content: accumulated + text, continuationCount: pass }
    } catch (e) {
      if (!(e instanceof UpstreamTruncatedError)) throw e
      const partial = e.partialText ?? ''
      // Nothing usable to continue from (streaming callers have usually
      // already emitted their partial as deltas; a streaming caller that
      // attaches its accumulated text sets partialText itself). Without a
      // partial the continuation has no referent — propagate honestly.
      if (partial.length === 0 || pass >= maxContinuations) {
        // Preserve everything produced so far on the error for the caller.
        throw new UpstreamTruncatedError(e.message, accumulated + partial)
      }
      accumulated += partial
      messages = buildContinuationMessages(args.baseMessages, accumulated)
    }
  }
}
