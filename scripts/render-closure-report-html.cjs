/**
 * Render docs/reports/W1-W5-FINAL-CLOSURE-REPORT.md to a styled,
 * self-contained HTML preview in download/ for the Z.ai preview interface.
 */
const { execSync } = require('node:child_process')

const SRC = '/home/z/my-project/docs/reports/W1-W5-FINAL-CLOSURE-REPORT.md'
const OUT = '/home/z/my-project/download/W1-W5-FINAL-CLOSURE-REPORT.html'

let md
try {
  // prefer marked if available
  md = require('marked')
  var markedParse = md.marked ?? md.parse ?? md
} catch {
  markedParse = null
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Minimal, dependency-free Markdown → HTML for THIS report's subset:
 * headings, tables, fenced code, hr, bold/inline-code, lists. */
function render(src) {
  const lines = src.split('\n')
  const out = []
  let i = 0
  let inCode = false
  let codeBuf = []
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      if (!inCode) { inCode = true; codeBuf = [] } else { inCode = false; out.push(`<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`) }
      i++; continue
    }
    if (inCode) { codeBuf.push(line); i++; continue }
    if (/^---+$/.test(line.trim())) { out.push('<hr/>'); i++; continue }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue }
    // table
    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const rows = []
      const header = splitRow(line)
      i += 2
      while (i < lines.length && lines[i].trim().startsWith('|')) { rows.push(splitRow(lines[i])); i++ }
      out.push('<table><thead><tr>' + header.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>')
      for (const r of rows) out.push('<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>')
      out.push('</tbody></table>')
      continue
    }
    // unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++ }
      out.push('<ul>' + items.map((t) => `<li>${inline(t)}</li>`).join('') + '</ul>')
      continue
    }
    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++ }
      out.push('<ol>' + items.map((t) => `<li>${inline(t)}</li>`).join('') + '</ol>')
      continue
    }
    if (line.trim() === '') { i++; continue }
    // paragraph (merge consecutive text lines)
    const para = [line]
    i++
    while (i < lines.length && lines[i].trim() !== '' && !/^(#{1,6}\s|```|\||\s*[-*]\s|\s*\d+\.\s|---)/.test(lines[i])) { para.push(lines[i]); i++ }
    out.push(`<p>${inline(para.join(' '))}</p>`)
  }
  return out.join('\n')
}

function splitRow(line) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
}

function inline(s) {
  let t = esc(s)
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  return t
}

const src = require('node:fs').readFileSync(SRC, 'utf8')
const body = render(src)

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>CODE GIFTZ — W1–W5 Final Closure Report</title>
<style>
  :root { --bg:#f6f7f9; --card:#ffffff; --ink:#1a2332; --muted:#5b6675; --line:#dfe4ea; --accent:#0f62fe; --pass:#0e8345; --warn:#b45309; --bad:#b91c1c; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:15px/1.65 -apple-system,'Segoe UI',Roboto,'Noto Sans SC','PingFang SC','Microsoft YaHei',sans-serif; }
  .wrap { max-width: 1080px; margin: 0 auto; padding: 32px 28px 80px; }
  header.doc { border-bottom: 3px solid var(--ink); padding-bottom: 18px; margin-bottom: 26px; }
  header.doc .kicker { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
  header.doc h1 { font-size: 30px; margin: 6px 0 10px; line-height: 1.25; }
  header.doc .decision { display:inline-block; background:#eef4ff; color:var(--accent); border:1px solid #c7dbff; padding:4px 12px; border-radius:999px; font-weight:700; font-size:14px; }
  h2 { font-size: 21px; margin: 40px 0 12px; padding-top: 14px; border-top: 1px solid var(--line); }
  h3 { font-size: 17px; margin: 26px 0 8px; }
  table { width:100%; border-collapse: collapse; margin: 14px 0 20px; background: var(--card); font-size: 13.5px; box-shadow: 0 1px 2px rgba(16,24,40,.06); }
  th { background:#eef1f5; text-align:left; font-weight:700; white-space:nowrap; }
  th, td { border: 1px solid var(--line); padding: 8px 10px; vertical-align: top; }
  tbody tr:nth-child(even) td { background:#fafbfc; }
  code { font: 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background:#f0f2f5; padding:1px 5px; border-radius:4px; }
  pre { background:#0f1720; color:#dbe4ee; padding:14px 16px; border-radius:8px; overflow:auto; }
  pre code { background:transparent; color:inherit; padding:0; }
  hr { border:0; border-top:1px solid var(--line); margin: 26px 0; }
  p { margin: 10px 0; }
  ul, ol { margin: 8px 0 14px; padding-left: 24px; }
  li { margin: 4px 0; }
  .status { font-weight: 700; white-space: nowrap; }
  .s-PASS { color: var(--pass); } .s-PARTIAL { color: var(--warn); } .s-BLOCKED { color: var(--bad); }
  .s-FAIL { color: var(--bad); } .s-NOT { color: var(--muted); }
  .footer { margin-top: 48px; color: var(--muted); font-size: 12.5px; border-top: 1px solid var(--line); padding-top: 12px; }
</style>
<script>
  // highlight the fixed status vocabulary inside tables
  document.addEventListener('DOMContentLoaded', function () {
    const re = /(PASS|PARTIAL|BLOCKED|FAIL|NOT VERIFIED)(?![A-Za-z])/g;
    document.querySelectorAll('td, li, p').forEach(function (el) {
      if (el.children.length && el.tagName !== 'TD' && el.tagName !== 'LI') return;
      el.innerHTML = el.innerHTML.replace(re, function (m) {
        const cls = m.startsWith('NOT') ? 's-NOT' : 's-' + m;
        return '<span class="status ' + cls + '">' + m + '</span>';
      });
    });
  });
</script>
</head><body><div class="wrap">
<header class="doc">
  <div class="kicker">CODE GIFTZ · Closure Work Order · 2026-11-04 (UTC)</div>
  <h1>W1–W5 Final Closure Report</h1>
  <span class="decision">DECISION B — READY WITH EXPLICIT BLOCKERS</span>
  <div style="margin-top:10px;color:var(--muted);font-size:13.5px">
    Gates: Bun 951/0/60 · ESLint 0 · tsc 11 pre-existing (scripts/ only) · build ✓ · security sweep 7/7 ·
    Tasks: A PARTIAL · B PASS · C PASS · D PARTIAL · E NOT VERIFIED · F PASS · G PASS
  </div>
</header>
${body}
<div class="footer">Generated from docs/reports/W1-W5-FINAL-CLOSURE-REPORT.md — canonical source of truth. All statuses use the fixed vocabulary {PASS, PARTIAL, BLOCKED, FAIL, NOT VERIFIED}; every claim carries an artifact on disk.</div>
</div></body></html>`

require('node:fs').writeFileSync(OUT, html)
console.log('rendered', OUT, html.length, 'bytes')
