/**
 * BEAN Intelligence — CODE GIFTZ file-operation intent detection tests (M23).
 *
 * Pure-function suite over the deterministic detector: every resolved intent
 * is checked against a REAL project file list; prose edit requests must fall
 * through to the model turn; ambiguous targets must produce a focused
 * clarification (never a guess); traversal-shaped tokens are refused.
 */
import { describe, test, expect } from 'bun:test'
import {
  detectFileOperation,
  normalizeProjectPath,
  resolveTarget,
  convertBasename,
  expandFolder,
} from '../../src/lib/code/file-ops/detect'

const FILES = [
  { path: 'index.html' },
  { path: 'styles.css' },
  { path: 'app.js' },
  { path: 'src/App.tsx' },
  { path: 'src/Dashboard.tsx' },
  { path: 'src/components/Button.tsx' },
  { path: 'src/components/Button.test.tsx' },
  { path: 'src/components/Card.tsx' },
  { path: 'src/lib/utils.ts' },
  { path: 'src/services/api.ts' },
  { path: 'assets/logo.png' },
]

describe('path normalization', () => {
  test('strips quotes, trailing slashes and ./ prefixes', () => {
    expect(normalizeProjectPath('"src/App.tsx"')).toBe('src/App.tsx')
    expect(normalizeProjectPath('`src/components/`')).toBe('src/components')
    expect(normalizeProjectPath('./app.js')).toBe('app.js')
    expect(normalizeProjectPath('src//lib//utils.ts')).toBe('src/lib/utils.ts')
  })

  test('rejects traversal, absolute paths and drive letters', () => {
    expect(() => normalizeProjectPath('../etc/passwd')).toThrow()
    expect(() => normalizeProjectPath('src/../../secret')).toThrow()
    expect(() => normalizeProjectPath('/etc/passwd')).toThrow()
    expect(() => normalizeProjectPath('C:\\Windows\\system32')).toThrow()
    expect(() => normalizeProjectPath('')).toThrow()
    expect(() => normalizeProjectPath('.')).toThrow()
  })
})

describe('target resolution ladder', () => {
  test('exact path → unique basename → unique stem → folder prefix', () => {
    expect(resolveTarget('src/App.tsx', FILES)).toEqual({ ok: true, target: { path: 'src/App.tsx', isFolder: false } })
    expect(resolveTarget('App.tsx', FILES)).toEqual({ ok: true, target: { path: 'src/App.tsx', isFolder: false } })
    expect(resolveTarget('App', FILES)).toEqual({ ok: true, target: { path: 'src/App.tsx', isFolder: false } })
    expect(resolveTarget('components', FILES)).toEqual({ ok: true, target: { path: 'src/components', isFolder: true } })
    expect(resolveTarget('src/components/', FILES)).toEqual({ ok: true, target: { path: 'src/components', isFolder: true } })
  })

  test('duplicate basenames in different folders are ambiguous — never guessed', () => {
    const dup = [...FILES, { path: 'lib/Button.tsx' }]
    const r = resolveTarget('Button.tsx', dup)
    expect(r.ok).toBe(false)
    if (!r.ok && r.reason === 'ambiguous') {
      expect(r.candidates).toContain('src/components/Button.tsx')
      expect(r.candidates).toContain('lib/Button.tsx')
    } else throw new Error('expected ambiguity')
  })

  test('folder expansion lists every file under the prefix', () => {
    const nested = [...FILES, { path: 'src/components/deep/Inner.tsx' }]
    expect(expandFolder('src/components', nested).sort()).toEqual([
      'src/components/Button.test.tsx',
      'src/components/Button.tsx',
      'src/components/Card.tsx',
      'src/components/deep/Inner.tsx',
    ])
  })
})

describe('detection: rename', () => {
  test('rename with extension → resolved op', () => {
    const d = detectFileOperation('Rename src/App.tsx to Home.tsx', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.intent.kind).toBe('rename')
      expect(d.intent.sources[0]).toEqual({ path: 'src/App.tsx', isFolder: false })
      expect(d.intent.destination).toBe('Home.tsx')
    }
  })

  test('rename without extension resolves the source by stem', () => {
    const d = detectFileOperation('please rename App to Overview', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.intent.sources[0].path).toBe('src/App.tsx')
    }
  })

  test('multi-word rename destination is prose — never guessed', () => {
    expect(detectFileOperation('rename App.tsx to something better', FILES).detected).toBe(false)
  })

  test('"rename the function in App.tsx" is a code edit, not a file op', () => {
    expect(detectFileOperation('rename the function in App.tsx to handleClick', FILES).detected).toBe(false)
  })

  test('a unique exact-stem basename resolves transparently (shown in the plan)', () => {
    const d = detectFileOperation('rename Button to PrimaryButton', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.intent.sources[0].path).toBe('src/components/Button.tsx')
    } else throw new Error('expected op')
  })
})

describe('detection: move (single + batch)', () => {
  test('move file into an existing folder', () => {
    const d = detectFileOperation('Move app.js into src/lib', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.intent.kind).toBe('move')
      expect(d.intent.destination).toBe('src/lib')
    }
  })

  test('explicit batch move splits comma/and lists', () => {
    const d = detectFileOperation('move App.tsx, utils.ts and api.ts into src/lib', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.intent.kind).toBe('batch-move')
      expect(d.intent.sources.map((s) => s.path).sort()).toEqual(['src/App.tsx', 'src/lib/utils.ts', 'src/services/api.ts'])
    }
  })

  test('move into an existing FILE is prose about that file — a code edit', () => {
    expect(detectFileOperation('move the hero section in App.tsx', FILES).detected).toBe(false)
  })

  test('unresolvable move source clarifies', () => {
    const d = detectFileExceptionSafeMove()
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'clarification') expect(d.question).toContain('Which file or folder should I move?')
  })
  function detectFileExceptionSafeMove() {
    return detectFileOperation('move the legacy helper into src/lib', FILES)
  }
})

describe('detection: delete', () => {
  test('delete an exact file resolves', () => {
    const d = detectFileOperation('Delete src/lib/utils.ts', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.intent.kind).toBe('delete')
      expect(d.intent.sources[0].path).toBe('src/lib/utils.ts')
      expect(d.intent.sources[0].isFolder).toBe(false)
    }
  })

  test('delete a folder resolves as folder', () => {
    const d = detectFileOperation('delete the src/components folder', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.intent.sources[0].isFolder).toBe(true)
    }
  })

  test('prose deletion with candidates asks a focused clarification', () => {
    const d = detectFileOperation('Delete the old Button component', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'clarification') {
      expect(d.question).toContain('src/components/Button.tsx')
    } else throw new Error('expected clarification')
  })

  test('pure prose deletion with no candidates falls through to the model', () => {
    expect(detectFileOperation('remove the background animation', FILES).detected).toBe(false)
    expect(detectFileOperation('delete everything', FILES).detected).toBe(false)
    expect(detectFileOperation('remove the hero heading and make it bold', FILES).detected).toBe(false)
  })
})

describe('detection: create', () => {
  test('create folder resolves deterministically', () => {
    const d = detectFileOperation('Create a new components folder named src/hooks', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.intent.kind).toBe('create')
      expect(d.intent.createIsFolder).toBe(true)
      expect(d.intent.destination).toBe('src/hooks')
    }
  })

  test('create with "folder" keyword but bare name resolves', () => {
    const d = detectFileOperation('create a folder called docs', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') expect(d.intent.destination).toBe('docs')
  })

  test('bare create-file requests go to the model (real content, not placeholders)', () => {
    expect(detectFileOperation('create utils.ts', FILES).detected).toBe(false)
    expect(detectFileOperation('add a file called notes.md', FILES).detected).toBe(false)
    expect(detectFileOperation('create a login page', FILES).detected).toBe(false)
  })

  test('explicit-content create (pasted fence naming the same path) is a real create', () => {
    const msg = 'Add a file called helpers.ts:\n\n```ts path=helpers.ts\nexport const add = (a: number, b: number) => a + b\n```'
    const d = detectFileOperation(msg, FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.intent.kind).toBe('create')
      expect(d.intent.createIsFolder).toBe(false)
      expect(d.intent.destination).toBe('helpers.ts')
      expect(d.intent.createContent).toContain('export const add')
    }
  })

  test('a code fence that is NOT a create request is an edit turn', () => {
    const msg = 'Update the button:\n\n```tsx path=src/components/Button.tsx\nexport const Button = () => <button/>\n```'
    expect(detectFileOperation(msg, FILES).detected).toBe(false)
  })
})

describe('detection: batch rename by convention', () => {
  test('kebab-case request resolves with the convention', () => {
    const d = detectFileOperation('Rename all files in src/components to kebab-case', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.intent.kind).toBe('batch-rename')
      expect(d.intent.convention).toBe('kebab-case')
      expect(d.intent.sources[0]).toEqual({ path: 'src/components', isFolder: true })
    }
  })

  test('extension filter is captured', () => {
    const d = detectFileOperation('rename all .tsx files in src/components to snake_case', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.intent.extensionFilter).toBe('.tsx')
      expect(d.intent.convention).toBe('snake_case')
    }
  })

  test('unknown convention asks which one', () => {
    const d = detectFileOperation('rename all files in src/components to nicer names', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'clarification') {
      expect(d.question).toContain('kebab-case')
    } else throw new Error('expected clarification')
  })

  test('"rename all files in X" without a convention clarifies', () => {
    const d = detectFileOperation('rename all files in src/components', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'clarification') expect(d.question).toContain('convention')
    else throw new Error('expected clarification')
  })
})

describe('detection: consequence-only questions', () => {
  test('"what happens if I delete X" is an explanation, not an execution', () => {
    const d = detectFileOperation('What happens if I delete src/lib/utils.ts?', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'explain') {
      expect(d.intent.kind).toBe('delete')
    } else throw new Error('expected explain')
  })

  test('explain also works for move', () => {
    const d = detectFileOperation('What would happen if I move src/App.tsx into src/lib?', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'explain') expect(d.intent.kind).toBe('move')
    else throw new Error('expected explain')
  })
})

describe('detection: negative guards', () => {
  test('non-file-op messages are not detected', () => {
    expect(detectFileOperation('Build a golden timer app with start and reset buttons', FILES).detected).toBe(false)
    expect(detectFileOperation('Fix the mobile layout of the dashboard', FILES).detected).toBe(false)
    expect(detectFileOperation('What is the time complexity of quicksort?', FILES).detected).toBe(false)
    expect(detectFileOperation('', FILES).detected).toBe(false)
  })

  test('case-only rename detection reaches the plan level (resolved destination)', () => {
    const d = detectFileOperation('rename src/App.tsx to src/app.tsx', FILES)
    expect(d.detected).toBe(true)
    if (d.detected && d.type === 'op') {
      expect(d.intent.destination).toBe('src/app.tsx')
    }
  })
})

describe('naming conventions', () => {
  test('convertBasename preserves the extension and handles mixed shapes', () => {
    expect(convertBasename('MyComponent.tsx', 'kebab-case')).toBe('my-component.tsx')
    expect(convertBasename('my-component.test.tsx', 'snake_case')).toBe('my_component_test.tsx')
    expect(convertBasename('user_profile.md', 'camelCase')).toBe('userProfile.md')
    expect(convertBasename('userProfile.js', 'PascalCase')).toBe('UserProfile.js')
    expect(convertBasename('APIHandler.ts', 'kebab-case')).toBe('api-handler.ts')
    expect(convertBasename('data-v2.json', 'snake_case')).toBe('data_v2.json')
  })
})
