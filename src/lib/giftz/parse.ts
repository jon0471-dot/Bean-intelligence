/**
 * BEAN Intelligence — CODE GIFTZ model-response parser (server side).
 *
 * The coding model answers conversationally and delivers files as fenced
 * code blocks tagged with `path=`:
 *
 *   Here's a small todo app...
 *   ```html path=index.html
 *   <!doctype html>
 *   ```
 *
 * Parse contract (pure, deterministic, unit-tested):
 *  - `path=`-tagged fences are WORKSPACE FILES — never rendered in the chat,
 *    never leaked into the streamed text;
 *  - every other fenced block is explanatory chat content and stays visible;
 *  - the chat message is the response with file fences removed;
 *  - files are path-validated with the SAME rules the sandbox enforces.
 *
 * Honesty: if the model produces no file fences, `files` is empty and the
 * workspace does not open — the answer is treated as pure conversation.
 *
 * The pure client-safe primitives (streaming visibility, language hints)
 * live in fence.ts; this module adds the sandbox path-validation coupling.
 */
import { assertSafeRelativePath } from '@/lib/sandbox/runner'
import { FENCE_RE, pathFromFenceInfo, visibleChatPrefix, langFromPath, type ParsedFile } from './fence'

export { visibleChatPrefix, langFromPath }
export type { ParsedFile }

export interface ParsedCodeResponse {
  /** Customer-visible chat text (file fences removed). */
  message: string
  files: ParsedFile[]
}

/** Parse a full (non-streamed) model response into chat text + files. */
export function parseCodeResponse(modelOutput: string): ParsedCodeResponse {
  const files: ParsedFile[] = []
  // Replace path-tagged fences with an empty string in the chat text; keep
  // the rest verbatim.
  const message = modelOutput.replace(FENCE_RE, (full, lang: string, meta: string, body: string) => {
    const path = pathFromFenceInfo(meta)
    if (!path) return full // explanatory fence — stays in the chat
    try {
      assertSafeRelativePath(path)
      files.push({ path, content: body, lang: lang || '' })
    } catch {
      // Unsafe path: the file is DROPPED (never written); the fence stays
      // visible so the user can see the model attempted something invalid.
      return full
    }
    return ''
  })
  return {
    message: message.replace(/\n{3,}/g, '\n\n').trim(),
    files,
  }
}
