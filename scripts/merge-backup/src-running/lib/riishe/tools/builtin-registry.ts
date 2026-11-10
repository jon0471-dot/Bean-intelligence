/**
 * BEAN Intelligence — fixed tool registration for RIISHE.
 *
 * Called once by the orchestrator at module load. The registry rejects
 * duplicates, so this is idempotent per process and the model-facing tool
 * universe is exactly what the code lists here — nothing more.
 */
import { registerTool } from './registry'
import { webSearchTool, readUrlTool, calculateTool, runCodeTool, readDocumentTool } from './builtin'

let registered = false

export function registerBuiltins(): void {
  if (registered) return
  registerTool(webSearchTool)
  registerTool(readUrlTool)
  registerTool(calculateTool)
  registerTool(runCodeTool)
  registerTool(readDocumentTool)
  registered = true
}
