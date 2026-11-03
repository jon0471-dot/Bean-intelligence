/**
 * BEAN Intelligence — CODE GIFTZ retry support (pure, unit-testable).
 *
 * A client Retry after a FAILED turn re-sends the same prompt. The failed
 * turn's user message is already persisted (the route stores it before the
 * stream starts, and a failed turn never persists an assistant reply), so a
 * verbatim resend would duplicate the user row in history. Collapsing that
 * ONE trailing identical unanswered prompt makes retries idempotent without
 * touching anything else:
 *   - last message is an assistant reply -> NOT collapsed (an intentional
 *     repeat of an earlier prompt is a normal new turn);
 *   - the trailing user prompt differs in any way -> NOT collapsed;
 *   - only a trailing user prompt with NO answer after it is collapsed.
 */

export interface GiftzLastMessage {
  role: string
  content: string
}

export function shouldCollapseDuplicateUserMessage(
  lastMessage: GiftzLastMessage | null | undefined,
  message: string,
): boolean {
  return !!lastMessage && lastMessage.role === 'user' && lastMessage.content === message
}
