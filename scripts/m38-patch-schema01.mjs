#!/usr/bin/env node
// M38: reconcile schema doc 01 §6 with the implemented live-scan retrieval contract.
import { readFileSync, writeFileSync } from 'node:fs'
const p = 'docs/knowledge-atlas/01-knowledge-schema-and-relationships.md'
let text = readFileSync(p, 'utf8')
const oldText = text
text = text.replace(
  /## 6\. Retrieval index contract \(for the RIISHE atlas tool\)[\s\S]*?(?=\n## 7\.)/,
  `## 6. Retrieval index contract (for the RIISHE atlas tools)

- The RIISHE tools \`search_atlas\` and \`read_atlas_doc\` (in
  \`src/lib/riishe/tools/atlas.ts\`) resolve a free-text topic to ranked
  document+section candidates by scanning the ACTUAL files under this
  directory at load time (cached per process). Because the index is derived
  live from the files, it can never drift from reality — there is no
  hand-maintained list to go stale.
- \`search_atlas\` ranks sections with deterministic term-overlap scoring
  (title > heading > body) and reports the scores; \`read_atlas_doc\` pages a
  document or a single section (mirrors the existing \`read_document\` paging
  contract: offset + bounded characters, honest end-of-document note).
- Section citations produced from atlas reads are formatted \`ATLAS-<NN> §<section>\` so they render
  in RIISHE's citation list like any other source, with the file path as the locator.
- When the library directory is absent (a deployment without the docs tree), both tools report the
  gap honestly — nothing is synthesized in its place.
`,
)
if (text === oldText) {
  console.log('PATCH: no change applied (pattern not found) — check manually')
  process.exit(1)
}
writeFileSync(p, text)
console.log('PATCH OK: schema doc 01 §6 reconciled with live-scan retrieval')
