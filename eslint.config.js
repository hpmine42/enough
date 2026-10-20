// enough. — ESLint flat config
// ---------------------------------------------------------------
// Targets TypeScript/TSX sources in src/ (excluding __tests__/ and
// experiments/). Enforces React-Hooks rules, disallows explicit `any`
// in newly-written code, bans stray console.* outside approved files,
// and catches unused vars with an underscore-prefix opt-out.
//
// We DELIBERATELY avoid typescript-eslint's recommendedTypeChecked: the
// project already runs `tsc --noEmit` in CI, and the type-checked rules
// flag many deliberately defensive crypto/security patterns (redundant
// runtime type assertions after JSON.parse, intentional non-null
// assertions, explicit Promise catches that do not rethrow). Those are
// security-driven choices, not bugs.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// Files where console output is intentional (production diagnostics, dev-only
// schema compat warnings, the last-resort error boundary).
const CONSOLE_ALLOWED = new Set([
  'src/lib/errors.ts',
  'src/lib/pwa.ts',
  'src/context/E2EEContext.tsx',
  'src/components/ErrorBoundary.tsx',
  'src/lib/api.ts', // schema-compat console.warn in DEV
]);

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'experiments/**',
      'spikes/**',
      'design/**',
      'scripts/**/*.test.mjs',
      '**/*.test.mjs',
      '**/__tests__/**',
      'public/**',
      '.smoke-dist/**',
      'coverage/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // React Hooks rules — critical for correctness.
      ...reactHooks.configs.recommended.rules,

      // TypeScript guardrails (a small, opinionated subset on top of tsc).
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      // `no-useless-assignment` fires on intentional finally-block cleanup
      // (e.g. `engine = null;` after dispose, to drop references for GC and
      // guard against post-dispose use). Stylistic, not a correctness issue.
      'no-useless-assignment': 'off',

      // Control-character regex classes are INTENTIONAL in input sanitization
      // (src/lib/input.ts strips ASCII control chars from display names). The
      // rule is designed to catch accidental control chars in source, not
      // legitimate sanitization regexes.
      'no-control-regex': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/**/*.test.{ts,tsx,mjs}',
      'src/**/__tests__/**',
    ],
    rules: {
      // Ban console.* in production code outside the short allowlist.
      'no-console': 'error',
    },
  },
  ...[...CONSOLE_ALLOWED].map((file) => ({
    files: [file],
    rules: { 'no-console': 'off' },
  })),
);
