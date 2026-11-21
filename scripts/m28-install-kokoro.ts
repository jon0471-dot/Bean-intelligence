/**
 * M28 helper: install the local Kokoro model through the REAL engine path
 * (explicit install semantics, checksum verification, integrity post-check).
 * This exercises the M28 provenance changes: canonical HF hash source first,
 * mirror fallback recorded as mirror provenance, and the read-only integrity
 * verifier run over the finished install.
 */
import { kokoroTtsEngine, KOKORO_MANIFEST } from '../src/lib/gangzii/tts-engine'
import { verifyKokoroModelIntegrity } from '../src/lib/gangzii/model-integrity'

async function main() {
  console.log('--- install status before ---')
  console.log(JSON.stringify(kokoroTtsEngine.getRuntimeStatus(), null, 2))
  console.log('--- installing (explicit action) ---')
  const t0 = Date.now()
  const result = await kokoroTtsEngine.install()
  console.log(`install ok=${result.ok} in ${Date.now() - t0}ms`)
  console.log(`message: ${result.message}`)
  if (result.manifest) {
    console.log('manifest checksumSource:', result.manifest.checksumSource)
    console.log('manifest files:')
    for (const f of result.manifest.files) console.log(`  ${f.file} bytes=${f.bytes} sha256=${f.sha256 ?? 'null'}`)
    console.log('manifest path:', KOKORO_MANIFEST)
  }
  console.log('--- integrity report after install ---')
  const report = verifyKokoroModelIntegrity()
  console.log(JSON.stringify({ ...report, notes: report.notes }, null, 2))
  process.exit(result.ok ? 0 : 1)
}

main().catch((e) => {
  console.error('install failed:', e)
  process.exit(1)
})
