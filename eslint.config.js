import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default [
  // Generated / vendored output we never want to lint.
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'public/**',
      'android/**',
      'ios/**',
      'dev-dist/**',
      'proxy/node_modules/**',
    ],
  },

  // Browser-facing application code (React).
  {
    files: ['src/**/*.{js,jsx}'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        __BUILD_TIME__: 'readonly',
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: 'detect' } },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // We're on React 17+ JSX transform, so React doesn't need to be in scope.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Allow intentionally-unused args (e.g. event handlers) and caught errors.
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^[A-Z_]' },
      ],
      // Rules-of-hooks is the genuinely dangerous one (conditional/looped hook
      // calls break React) — keep it a hard error.
      'react-hooks/rules-of-hooks': 'error',
      // The rest of eslint-plugin-react-hooks@7's recommended set is the new
      // React-Compiler advisory tier. It flags idiomatic-but-discouraged
      // patterns (keep-ref-fresh-during-render in useIdleMode, setState in
      // typewriter effects) rather than outright bugs, so surface it as
      // warnings instead of gating CI on a working-code refactor.
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
    },
  },

  // Node code: serverless proxy, standalone proxy server, build scripts, config.
  {
    files: [
      'api/**/*.js',
      'proxy/**/*.js',
      'scripts/**/*.{js,mjs}',
      '*.config.js',
    ],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },

  // Vitest test files run in a Node environment with browser-ish DOM shims.
  {
    files: ['src/**/*.test.{js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },
]
