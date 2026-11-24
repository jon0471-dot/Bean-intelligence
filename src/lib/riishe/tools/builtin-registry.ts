/**
 * BEAN Intelligence — fixed tool registration for RIISHE.
 *
 * Called once by the orchestrator at module load. The registry rejects
 * duplicates, so this is idempotent per process and the model-facing tool
 * universe is exactly what the code lists here — nothing more.
 */
import { registerTool } from './registry'
import {
  webSearchTool,
  readUrlTool,
  calculateTool,
  runCodeTool,
  readDocumentTool,
  analyzeImageTool,
} from './builtin'
import { delegateCodingTool, checkCodingJobTool } from '../code-delegation'
import { generateImageTool, createVideoTool, synthesizeSpeechTool } from '../specialists'

let registered = false

export function registerBuiltins(): void {
  if (registered) return
  registerTool(webSearchTool)
  registerTool(readUrlTool)
  registerTool(calculateTool)
  registerTool(runCodeTool)
  registerTool(readDocumentTool)
  registerTool(analyzeImageTool)
  // M36-C — specialist delegation tools (LAXII / JAZMII / GANGZII via the
  // existing durable job queue; explicit-permission gated, plan-narrowed).
  registerTool(generateImageTool)
  registerTool(createVideoTool)
  registerTool(synthesizeSpeechTool)
  // M37 §3 — CODE GIFTZ engineering-workflow delegation (explicit permission,
  // two-key gated like every specialist delegation; submit + status probe).
  registerTool(delegateCodingTool)
  registerTool(checkCodingJobTool)
  registered = true
}
