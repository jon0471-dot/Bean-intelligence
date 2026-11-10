/**
 * BEAN Intelligence — request validation helpers (packages/api-contracts).
 * Zod schemas shared by API routes. Validation errors are customer-safe.
 */
import { z } from 'zod'
import { BeanApiError } from './errors'

export async function parseBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    throw new BeanApiError('VALIDATION_ERROR', 'Request body must be valid JSON.')
  }
  const result = schema.safeParse(json)
  if (!result.success) {
    const first = result.error.issues[0]
    const where = first?.path?.length ? `${first.path.join('.')}: ` : ''
    throw new BeanApiError('VALIDATION_ERROR', `${where}${first?.message ?? 'Invalid request.'}`)
  }
  return result.data
}

/** Rough, clearly-labeled token estimate (~4 chars/token). BEAN never
 *  invents provider-reported token counts; where the gateway does not report
 *  usage, we store estimates and mark them as estimates. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
