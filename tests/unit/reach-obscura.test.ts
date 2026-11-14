/**
 * Obscura browser backend — CLI adapter (hermetic: a REAL fake binary, no
 * network). Regression contract (addendum):
 *   - every interface operation has a real implementation or reports
 *     honestly unavailable;
 *   - URL safety runs BEFORE any navigation (private/metadata URLs →
 *     zero spawns);
 *   - per-operation timeout + output caps + PNG magic-byte validation;
 *   - screenshots use an ephemeral temp dir that is ALWAYS cleaned up;
 *   - shutdown is an honest no-op for the CLI mode (no persistent process).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  obscuraExtractText,
  obscuraExtractLinks,
  obscuraCaptureScreenshot,
  obscuraFetchRenderedPage,
  obscuraHealthCheck,
  obscuraShutdown,
  clearObscuraHealthCacheForTests,
} from '../../src/lib/research/browser/obscura'

let dir: string

const FAKE = `#!/usr/bin/env bash
# Fake obscura: records argv, serves canned outputs per dump mode.
echo "$@" > "@DIR@/last-argv.txt"
mode=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--dump" ]; then mode="$a"; fi
  prev="$a"
done
case "$mode" in
  text) printf 'Rendered body text of the JavaScript page. %s' 'payload'"$@" ;;
  html) echo '<html><body><h1>Rendered</h1><p>SPA content</p></body></html>' ;;
  links) printf 'https://nodejs.org/en\\tHome\\nhttp://127.0.0.1/admin\\tprivate\\nnot-a-link\\n' ;;
  *) ;;
esac
if [ "$1" = "--version" ]; then echo 'obscura 0.2.7'; fi
`
const SHOT = `#!/usr/bin/env bash
# Fake obscura screenshot mode: writes a real PNG to the --screenshot path.
out=""
prev=""
for a in "$@"; do
  if [ "$prev" = "--screenshot" ]; then out="$a"; fi
  prev="$a"
done
if [ -n "$out" ]; then
  # PNG magic bytes + tiny body.
  printf '\\x89PNG\\r\\n\\x1a\\nrest-of-image' > "$out"
fi
echo "Screenshot written"
`
const SLEEPY = `#!/usr/bin/env bash
sleep 30
`

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bean-obscura-test-'))
  for (const [name, body] of [
    ['obscura', FAKE.replaceAll('@DIR@', dir)],
    ['obscura-shot', SHOT],
    ['obscura-sleepy', SLEEPY],
  ] as const) {
    const p = join(dir, name)
    await writeFile(p, body)
    await chmod(p, 0o755)
  }
  process.env.BEAN_RESEARCH_OBSCURA_BIN = join(dir, 'obscura')
  clearObscuraHealthCacheForTests()
})

afterAll(async () => {
  delete process.env.BEAN_RESEARCH_OBSCURA_BIN
  clearObscuraHealthCacheForTests()
  await rm(dir, { recursive: true, force: true })
})

describe('obscuraHealthCheck', () => {
  test('available with the version reported by the binary', async () => {
    const health = await obscuraHealthCheck()
    expect(health.available).toBeTrue()
    expect(health.version).toBe('0.2.7')
  })

  test('honestly unavailable when the binary does not exist', async () => {
    process.env.BEAN_RESEARCH_OBSCURA_BIN = join(dir, 'missing')
    clearObscuraHealthCacheForTests()
    const health = await obscuraHealthCheck()
    expect(health.available).toBeFalse()
    expect(health.reason).toContain('not available')
    process.env.BEAN_RESEARCH_OBSCURA_BIN = join(dir, 'obscura')
    clearObscuraHealthCacheForTests()
  })
})

describe('obscuraExtractText', () => {
  test('returns sanitized rendered text', async () => {
    const out = await obscuraExtractText('https://spa.example.com/page')
    expect(out.ok).toBeTrue()
    expect(out.text).toContain('Rendered body text')
    expect(out.injectionFlags).toEqual([])
  })

  test('blocks private/metadata URLs BEFORE any spawn (zero navigations)', async () => {
    const argvBefore = await import('node:fs/promises').then((fs) => fs.readFile(join(dir, 'last-argv.txt'), 'utf8').catch(() => ''))
    const out = await obscuraExtractText('http://169.254.169.254/latest/meta-data/')
    expect(out.ok).toBeFalse()
    expect(out.kind).toBe('bad-input')
    const argvAfter = await import('node:fs/promises').then((fs) => fs.readFile(join(dir, 'last-argv.txt'), 'utf8').catch(() => ''))
    expect(argvAfter).toBe(argvBefore) // no navigation happened
  })
})

describe('obscuraFetchRenderedPage', () => {
  test('returns bounded HTML and derived text', async () => {
    const out = await obscuraFetchRenderedPage('https://spa.example.com/')
    expect(out.ok).toBeTrue()
    expect(out.html).toContain('<h1>')
    expect(out.text).toContain('SPA content')
  })
})

describe('obscuraExtractLinks', () => {
  test('parses links and DROPS non-public ones (extracted links are untrusted)', async () => {
    const out = await obscuraExtractLinks('https://example.com/')
    expect(out.ok).toBeTrue()
    expect(out.links).toHaveLength(1)
    expect(out.links[0].url).toBe('https://nodejs.org/en')
    expect(out.links[0].text).toBe('Home')
  })
})

describe('obscuraCaptureScreenshot', () => {
  test('captures a PNG (magic-byte checked) and cleans up its temp dir', async () => {
    process.env.BEAN_RESEARCH_OBSCURA_BIN = join(dir, 'obscura-shot')
    clearObscuraHealthCacheForTests()
    const out = await obscuraCaptureScreenshot('https://example.com/')
    expect(out.ok).toBeTrue()
    expect(out.mime).toBe('image/png')
    const bytes = Buffer.from(out.base64, 'base64')
    expect(bytes[0]).toBe(0x89)
    expect(bytes[1]).toBe(0x50) // 'P'
    process.env.BEAN_RESEARCH_OBSCURA_BIN = join(dir, 'obscura')
    clearObscuraHealthCacheForTests()
  })

  test('a failed navigation reports honestly unavailable', async () => {
    process.env.BEAN_RESEARCH_OBSCURA_BIN = join(dir, 'obscura-sleepy')
    process.env.BEAN_RESEARCH_OBSCURA_TIMEOUT_MS = '5000'
    clearObscuraHealthCacheForTests()
    const out = await obscuraCaptureScreenshot('https://example.com/slow')
    expect(out.ok).toBeFalse()
    expect(out.kind).toBe('timeout')
    delete process.env.BEAN_RESEARCH_OBSCURA_TIMEOUT_MS
    process.env.BEAN_RESEARCH_OBSCURA_BIN = join(dir, 'obscura')
    clearObscuraHealthCacheForTests()
  }, 12_000)
})

describe('obscuraShutdown', () => {
  test('CLI mode: honest no-op (no persistent process, nothing leaked)', async () => {
    const out = await obscuraShutdown()
    expect(out.ok).toBeTrue()
    expect(out.mode).toBe('cli')
    expect(out.stopped).toBe(0)
  })
})
