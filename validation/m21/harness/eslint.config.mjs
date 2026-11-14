// M21 validation harness ESLint config — validator tooling only.
// Lints the MODEL-generated app files of one M21 project (kit sources under
// components/kit/ are engine-managed and validated by the repo's own gates).
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/components/kit/**', '**/vendor/**', '**/types/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
)
