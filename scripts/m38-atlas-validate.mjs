#!/usr/bin/env node
/**
 * M38 atlas validator — checks docs/knowledge-atlas for:
 *  1. existence of all required files
 *  2. schema conformance (header block, numbered sections, references)
 *  3. substance (min body size, no placeholders)
 *  4. relative-link integrity between atlas files
 *  5. coverage-map master-table consistency with reality
 *  6. license-register sanity (non-commercial mentions carry the warning)
 * Exit code 1 with a report on failure.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ATLAS = join(process.cwd(), 'docs', 'knowledge-atlas');

const REQUIRED = [
  'README.md',
  '00-world-knowledge-coverage-map.md',
  '01-knowledge-schema-and-relationships.md',
  '02-source-provenance-and-licensing.md',
  '03-coverage-gaps-and-update-policy.md',
  '04-human-anatomy-and-physiology.md',
  '05-human-biomechanics-and-locomotion.md',
  '06-human-actions-gestures-and-motion.md',
  '07-human-dance-sports-and-performance.md',
  '08-human-falls-impact-balance-and-recovery.md',
  '09-animal-kingdom-taxonomy-and-evolution.md',
  '10-vertebrate-anatomy-and-physiology.md',
  '11-insects-and-arthropods.md',
  '12-invertebrates-and-other-animal-groups.md',
  '13-bird-anatomy-flight-and-aerodynamics.md',
  '14-animal-locomotion-behaviour-and-communication.md',
  '15-plants-fungi-microbes-and-ecosystems.md',
  '16-physics-motion-forces-and-energy.md',
  '17-chemistry-atoms-molecules-and-reactions.md',
  '18-materials-and-engineering-science.md',
  '19-earth-oceans-weather-and-climate.md',
  '20-ecology-evolution-and-environment.md',
  '21-astronomy-and-space.md',
  '22-human-history-culture-and-society.md',
  '23-languages-communication-and-social-behaviour.md',
  '24-technology-engineering-and-computing.md',
  '25-architecture-art-music-and-visual-design.md',
  '26-professional-software-ui-ux-and-motion-design.md',
  '27-ai-models-inference-and-multimodal-intelligence.md',
  '28-agent-planning-tools-verification-and-recovery.md',
  '29-professional-code-generation-and-product-engineering.md',
];

// The "args" mode only validates the files that actually exist (for milestone runs).
const only = process.argv[2] === '--existing' ? 'existing' : 'all';
const existing = readdirSync(ATLAS).filter((f) => f.endsWith('.md'));
const target = only === 'existing' ? REQUIRED.filter((f) => existsSync(join(ATLAS, f))) : REQUIRED;

const problems = [];
const words = (t) => t.split(/\s+/).filter(Boolean).length;

const FOUNDATION = new Set(['README.md', '00-world-knowledge-coverage-map.md', '01-knowledge-schema-and-relationships.md', '02-source-provenance-and-licensing.md', '03-coverage-gaps-and-update-policy.md']);

for (const file of target) {
  const p = join(ATLAS, file);
  if (!existsSync(p)) {
    problems.push(`MISSING ${file}`);
    continue;
  }
  const raw = readFileSync(p, 'utf8');
  // strip inline code spans and fenced blocks before content checks (the policy doc legitimately names placeholder tokens)
  const text = raw.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  if (!/# .+/.test(text)) problems.push(`${file}: no H1 title`);
  if (!/Atlas ID: ATLAS-/.test(text)) problems.push(`${file}: missing "Atlas ID:"`);
  if (!/Review date: \d{4}-\d{2}-\d{2}/.test(text)) problems.push(`${file}: missing "Review date: YYYY-MM-DD"`);
  if (!/Status:/.test(text)) problems.push(`${file}: missing "Status:"`);
  if (file !== 'README.md' && !/Parent:/.test(text)) problems.push(`${file}: missing "Parent:"`);
  const sections = text.match(/^## \d+\. /gm) || [];
  if (sections.length < 3) problems.push(`${file}: fewer than 3 numbered sections (${sections.length})`);
  // domain guides must carry a References section; foundation docs ARE the reference layer (00 lists sources in tables, 02 is the register)
  if (!FOUNDATION.has(file) && !/## \d+\. References|^## References/i.test(text)) problems.push(`${file}: no References section`);
  const body = text.replace(/^#.*$/gm, '');
  if (words(body) < 600 && only === 'all') problems.push(`${file}: body too small (${words(body)} words, need >= 600)`);
  if (/\b(TODO|TBD|FIXME|lorem ipsum)\b/i.test(text)) problems.push(`${file}: placeholder marker present`);
  // relative links must resolve inside the atlas (or to ../ paths that exist)
  const links = [...text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)].map((m) => m[1]);
  for (const l of links) {
    if (/^(https?:|mailto:|\/)/.test(l)) continue; // external or absolute
    const resolved = join(ATLAS, l);
    if (!existsSync(resolved)) problems.push(`${file}: broken relative link -> ${l}`);
  }
}

// coverage-map consistency (only when the full set exists)
if (only === 'all') {
  const cov = readFileSync(join(ATLAS, '00-world-knowledge-coverage-map.md'), 'utf8');
  for (const f of REQUIRED.slice(4)) {
    if (!cov.includes(f)) problems.push(`coverage map does not list ${f}`);
  }
  // license sanity: non-commercial dataset mentions carry the warning
  const src = readFileSync(join(ATLAS, '02-source-provenance-and-licensing.md'), 'utf8');
  for (const name of ['Motion-X', 'AMASS', 'HumanML3D']) {
    if (!src.includes(name)) problems.push(`license register missing ${name}`);
  }
  if (!/NO for commercial|NO commercial use|non-commercial/i.test(src)) {
    problems.push('license register lacks commercial-use warnings');
  }
}

const present = existing.length;
console.log(`atlas: ${present} md files present, validating ${target.length} target(s) in mode=${only}`);
if (problems.length) {
  console.log('PROBLEMS:');
  for (const p of problems) console.log(' - ' + p);
  process.exit(1);
}
console.log('ATLAS VALIDATION OK');
