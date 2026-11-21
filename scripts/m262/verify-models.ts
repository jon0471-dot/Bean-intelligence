/** M26.2 — assert every local model is genuinely installed (hash-verified). */
import { allLocalModelStates } from '../../src/lib/media/local-models'
const states = allLocalModelStates()
for (const s of states) {
  console.log(`${s.id}: state=${s.state} sha256Ok=${s.sha256Ok} bytes=${s.installedBytes ?? '-'}`)
}
const allReady = states.every((s) => s.state === 'ready' && s.sha256Ok === true)
console.log(allReady ? 'ALL MODELS READY' : 'MODEL STATES INCOMPLETE')
process.exit(allReady ? 0 : 1)
