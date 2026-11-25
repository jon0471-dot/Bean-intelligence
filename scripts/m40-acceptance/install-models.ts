/**
 * M40 operator bootstrap — installs the three RIISHE retrieval/OCR models
 * through the REAL product install path (local-model manager: download +
 * size/SHA-256 gate, companions included). Run: bun scripts/m40-acceptance/install-models.ts
 */
import { installLocalModel, localModelState, LOCAL_MODELS } from '../../src/lib/media/local-models'

const IDS = ['minilm-l6-embeddings', 'ms-marco-minilm-rerank', 'ocr-eng-traineddata'] as const

async function main() {
  for (const id of IDS) {
    if (!(id in LOCAL_MODELS)) throw new Error(`unknown model id: ${id}`)
    const before = localModelState(id)
    console.log(`[install] ${id}: ${before.state}`)
    if (before.state === 'ready') continue
    const t0 = Date.now()
    const state = await installLocalModel(id)
    console.log(`[install] ${id}: ${state.state} in ${Date.now() - t0}ms (sha256Ok=${state.sha256Ok}, bytes=${state.installedBytes})`)
    if (state.state !== 'ready') {
      console.error(`[install] FAILED: ${state.error}`)
      process.exit(1)
    }
  }
  console.log('ALL M40 MODELS INSTALLED + INTEGRITY-VERIFIED')
}

main().catch((e) => {
  console.error('install failed:', e)
  process.exit(1)
})
