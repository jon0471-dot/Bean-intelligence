/**
 * BEAN Intelligence — CODE GIFTZ dependency analysis tests (M22).
 *
 * Pins the static dependency-management contract:
 *  - package-manager detection from lockfiles (npm/bun/pnpm/yarn, none);
 *  - missing imports: bare specifiers not declared + relative specifiers with
 *    no resolvable target; node builtins and node: prefixes never flagged;
 *  - unused dependencies (honest heuristic, caveated in the report notes);
 *  - duplicate declarations across sections + unpinned ranges recorded;
 *  - build scripts referencing missing local files are invalid, honest note.
 */
import { describe, test, expect } from 'bun:test'

const { analyzeDependencies, extractModuleSpecifiers, resolveRelativePath, relativeCandidates } =
  await import('../../src/lib/code/dependency-analysis')

describe('module specifier extraction', () => {
  test('static and dynamic imports, require, export-from', () => {
    const specifiers = extractModuleSpecifiers(`
      import fs from 'fs'
      import { useState } from 'react'
      import './side-effect.css'
      const lazy = () => import('./heavy.js')
      const path = require('node:path')
      export { helper } from './helper.js'
    `)
    expect(specifiers).toEqual(expect.arrayContaining(['fs', 'react', './side-effect.css', './heavy.js', 'node:path', './helper.js']))
  })
})

describe('path resolution (pure)', () => {
  test('resolveRelativePath normalizes dot segments', () => {
    expect(resolveRelativePath('src/components', '../lib/util.js')).toBe('src/lib/util.js')
    expect(resolveRelativePath('', './app.js')).toBe('app.js')
    expect(resolveRelativePath('a/b', '../../c.js')).toBe('c.js')
  })

  test('relativeCandidates offers extension + index resolution', () => {
    expect(relativeCandidates('util')).toEqual(
      expect.arrayContaining(['util.js', 'util.ts', 'util/index.js', 'util/index.ts']),
    )
    expect(relativeCandidates('./x.js')).toContain('./x.js')
  })
})

describe('analyzeDependencies', () => {
  const PKG = JSON.stringify({
    dependencies: { react: '^19.0.0', 'left-pad': '*' },
    devDependencies: { typescript: '^5.0.0', react: '^19.0.0' },
    scripts: { build: 'tsc -p tsconfig.json', dev: 'node server.js', test: 'echo ok' },
  })

  function project(extra: Array<[string, string]> = []) {
    return [
      { path: 'package.json', content: PKG },
      { path: 'package-lock.json', content: '{}' },
      { path: 'tsconfig.json', content: '{}' },
      { path: 'src/main.js', content: "import React from 'react'\nimport { helper } from './helper.js'\nimport fs from 'node:fs'\nimport path from 'path'" },
      { path: 'src/helper.js', content: 'export const helper = () => 1' },
      ...extra.map(([path, content]) => ({ path, content })),
    ]
  }

  test('detects npm from package-lock.json; declared react/typescript are not missing', () => {
    const report = analyzeDependencies(project())
    expect(report.packageManager).toEqual({ name: 'npm', lockfile: 'package-lock.json' })
    expect(report.hasPackageJson).toBe(true)
    expect(report.hasLockfile).toBe(true)
    const missingBare = report.missingImports.filter((m) => m.kind === 'bare')
    expect(missingBare).toHaveLength(0) // react declared; fs/path are builtins
  })

  test('missing bare import is flagged; node builtins and node: prefix are not', () => {
    const report = analyzeDependencies(
      project([['src/extra.js', "import lodash from 'lodash'\nimport http from 'http'\nimport zlib from 'node:zlib'"]]),
    )
    const bare = report.missingImports.filter((m) => m.kind === 'bare')
    expect(bare).toEqual([{ path: 'src/extra.js', module: 'lodash', kind: 'bare' }])
  })

  test('missing relative import is flagged with the importing file', () => {
    const report = analyzeDependencies(project([['src/lonely.js', "import { x } from './does-not-exist.js'"]]))
    const rel = report.missingImports.filter((m) => m.kind === 'relative')
    expect(rel).toEqual([{ path: 'src/lonely.js', module: './does-not-exist.js', kind: 'relative' }])
  })

  test('relative imports resolve across directories (../shared/util)', () => {
    const report = analyzeDependencies([
      { path: 'package.json', content: '{"dependencies":{}}' },
      { path: 'src/a/main.js', content: "import { u } from '../../shared/util.js'" },
      { path: 'shared/util.js', content: 'export const u = 1' },
    ])
    expect(report.missingImports.filter((m) => m.kind === 'relative')).toHaveLength(0)
  })

  test('unused dependencies are reported with the honest heuristic caveat', () => {
    const report = analyzeDependencies(project())
    expect(report.unusedDependencies).toContain('left-pad')
    expect(report.unusedDependencies).not.toContain('react')
    expect(report.notes.join('\n')).toMatch(/heuristic/)
  })

  test('duplicate declarations across dep sections and unpinned ranges are recorded', () => {
    const report = analyzeDependencies(project())
    expect(report.duplicateDeclarations).toEqual([
      { dependency: 'react', dependencies: '^19.0.0', devDependencies: '^19.0.0' },
    ])
    expect(report.unpinnedRanges).toEqual([{ dependency: 'left-pad', range: '*' }])
  })

  test('build scripts referencing existing files are valid; missing references are flagged', () => {
    const report = analyzeDependencies(project())
    const byName = new Map(report.buildScripts.map((s) => [s.name, s]))
    expect(byName.get('build')).toMatchObject({ valid: true, issue: null })
    expect(byName.get('dev')).toMatchObject({ valid: false })
    expect(byName.get('dev')?.issue).toMatch(/server\.js/)
    expect(byName.get('test')).toMatchObject({ valid: true })
  })

  test('invalid package.json degrades honestly (static import checks still run)', () => {
    const report = analyzeDependencies([
      { path: 'package.json', content: '{not json' },
      { path: 'app.js', content: "import x from 'undeclared-pkg'" },
    ])
    expect(report.hasPackageJson).toBe(true)
    expect(report.dependencies).toEqual({})
    expect(report.missingImports).toEqual([{ path: 'app.js', module: 'undeclared-pkg', kind: 'bare' }])
    expect(report.notes.join('\n')).toMatch(/not valid JSON/)
  })

  test('no package manifest at all reports honestly', () => {
    const report = analyzeDependencies([{ path: 'main.js', content: 'console.log(1)' }])
    expect(report.packageManager.name).toBe('none')
    expect(report.hasPackageJson).toBe(false)
    expect(report.missingImports).toHaveLength(0)
  })

  test('scoped packages resolve to the @scope/name root', () => {
    const report = analyzeDependencies([
      { path: 'package.json', content: '{"dependencies":{"@vitejs/plugin-react":"^4.0.0"}}' },
      { path: 'vite.config.js', content: "import react from '@vitejs/plugin-react'" },
    ])
    expect(report.missingImports).toHaveLength(0)
  })
})
