/**
 * M21 generation harness — drives the REAL CODE GIFTZ frontend-intelligence
 * modules (engine + deterministic validator + file-fence parser) over the
 * three validation projects. Validator tooling only; never shipped.
 *
 * Subcommands:
 *   bun scripts/m21/harness.ts plan <a|b|c>      resolve + persist the plan/brief/engine files
 *   bun scripts/m21/harness.ts assemble <a|b|c>  parse model response, validate, materialize project
 */
import fs from 'fs'
import path from 'path'
import { parseFiles } from '../../src/lib/giftz/workspace'
import { resolveFrontendPlan, finalizeFrontendTurn } from '../../src/lib/frontend-intel/engine'

const M21 = path.join(process.cwd(), 'validation', 'm21')

const PROJECTS: Record<string, { dir: string; message: string }> = {
  a: {
    dir: 'project-a-landing',
    message:
      'Build a modern immersive dark-themed technology landing page for "Nebula", a fictional AI infrastructure platform, as a React app: professional hero section with strong typography, navigation with a mobile menu, feature cards, product showcase, testimonials, pricing, FAQ and footer, rich entrance and scroll animations, animated headings, count-up stats and an interactive animated background. Accessible controls, responsive on mobile.',
  },
  b: {
    dir: 'project-b-dashboard',
    message:
      'Build a professional analytics dashboard as a React app: sidebar navigation, header, KPI stat cards, charts, a data table with search and filtering, date-range controls, loading and empty states, error states, responsive layout for tablet and phone. Use clearly labeled sample data, no live data. Performance matters: fast initial rendering.',
  },
  c: {
    dir: 'project-c-portfolio',
    message:
      'Build a multi-page React developer portfolio site for a fictional developer: Home, About, Projects, project detail pages and Contact, with working internal navigation between the pages. Animated typography on headings, a projects gallery with interactive project cards and hover effects, elegant dark style, responsive navigation on mobile, accessible links.',
  },
}

function projectPaths(key: string) {
  const p = PROJECTS[key]
  if (!p) throw new Error(`unknown project key: ${key}`)
  return {
    ...p,
    planDir: path.join(M21, p.dir, 'plan'),
    projectDir: path.join(M21, 'projects', p.dir),
    responsePath: path.join(M21, 'model-responses', `${key}.md`),
    reportPath: path.join(M21, 'reports', `${key}-assemble.json`),
  }
}

function cmdPlan(key: string) {
  const p = projectPaths(key)
  const plan = resolveFrontendPlan({ message: p.message, existingFilePaths: [] })
  if (!plan.enabled) throw new Error(`plan for ${key} is not enabled: ${plan.reason}`)
  fs.mkdirSync(p.planDir, { recursive: true })
  fs.writeFileSync(
    path.join(p.planDir, 'plan.json'),
    JSON.stringify(
      {
        message: p.message,
        target: plan.target,
        reason: plan.reason,
        componentIds: plan.componentIds,
        animationIds: plan.animationIds,
        vantaEffect: plan.vantaEffect,
        responsive: plan.responsive,
        dependencies: plan.summary.dependencies,
        engineFilePaths: plan.engineFiles.map((f) => f.path),
        notices: plan.summary.notices,
      },
      null,
      2,
    ),
  )
  fs.writeFileSync(path.join(p.planDir, 'brief.md'), plan.brief)
  // engine files kept as the engine produced them (raw materialization input)
  const engineDir = path.join(p.planDir, 'engine-files')
  fs.rmSync(engineDir, { recursive: true, force: true })
  for (const f of plan.engineFiles) {
    const out = path.join(engineDir, f.path)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, f.content)
  }
  console.log(`plan ${key}: target=${plan.target} components=[${plan.componentIds.join(',')}] animations=[${plan.animationIds.join(',')}] background=${plan.vantaEffect} engineFiles=${plan.engineFiles.length} briefChars=${plan.brief.length}`)
}

function cmdAssemble(key: string) {
  const p = projectPaths(key)
  const response = fs.readFileSync(p.responsePath, 'utf8')
  const plan = resolveFrontendPlan({ message: p.message, existingFilePaths: [] })
  if (!plan.enabled) throw new Error(`plan for ${key} is not enabled`)

  // EXACT product contract: the model response is parsed by parseFiles; the
  // chat text (fences removed) would become the assistant message.
  const extracted = parseFiles(response)
  if (extracted.length === 0) throw new Error(`no path-tagged files parsed from the ${key} model response`)
  const chatText = response.replace(/```[\w+-]*[ \t]*[^\n]*\n[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim()

  // EXACT product contract: engine files are attached, then deterministic
  // checks run over the FULL file set.
  const fullSet = [...extracted, ...plan.engineFiles]
  const result = finalizeFrontendTurn(fullSet, plan)

  // materialize the generated project verbatim (model files + engine files)
  fs.rmSync(p.projectDir, { recursive: true, force: true })
  fs.mkdirSync(p.projectDir, { recursive: true })
  for (const f of fullSet) {
    const out = path.join(p.projectDir, f.path)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, f.content)
  }
  fs.writeFileSync(path.join(p.projectDir, 'ASSISTANT-MESSAGE.md'), chatText || '(no conversational text)')

  fs.writeFileSync(
    p.reportPath,
    JSON.stringify(
      {
        project: p.dir,
        modelFiles: extracted.map((f) => f.path),
        engineFiles: plan.engineFiles.map((f) => f.path),
        checks: result.checks,
        dependencies: plan.summary.dependencies,
        selectedComponents: plan.componentIds,
        selectedAnimations: plan.animationIds,
        selectedBackground: plan.vantaEffect,
      },
      null,
      2,
    ),
  )
  console.log(`assemble ${key}: modelFiles=${extracted.length} engineFiles=${plan.engineFiles.length} checks passed=${result.checks.passed} blocking=${result.checks.blocking} warnings=${result.checks.warnings}`)
  for (const issue of result.checks.issues) console.log(`  [${issue.severity}] ${issue.id}: ${issue.message}`)
}

const [, , cmd, key] = process.argv
if (cmd === 'plan') cmdPlan(key)
else if (cmd === 'assemble') cmdAssemble(key)
else {
  console.error('usage: harness.ts <plan|assemble> <a|b|c>')
  process.exit(2)
}
