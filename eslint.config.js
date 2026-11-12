import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// Only adapters may talk to Forge platform APIs. Everything above them stays testable
// with fakes and no site, which is what lets the score and guard be tested exhaustively.
const forgePlatformPackages = ['@forge/api', '@forge/kvs', '@forge/llm', '@forge/teamwork-graph'];

const noForgeImports = (allowed = []) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['@forge/*', ...allowed.map((p) => `!${p}`)],
          message: 'Only src/adapters may import Forge platform packages.',
        },
      ],
    },
  ],
});

export default tseslint.config(
  {
    ignores: [
      'apps/stakes/test/fixtures/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'design/**',
      '**/.forge/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/*/src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true }, node: true },
      'boundaries/include': ['apps/*/src/**/*'],
      'boundaries/elements': [
        { type: 'core', pattern: 'apps/*/src/core' },
        { type: 'adapters', pattern: 'apps/*/src/adapters' },
        { type: 'services', pattern: 'apps/*/src/services' },
        {
          type: 'entry',
          pattern: 'apps/*/src/(resolvers|actions|triggers)',
        },
        { type: 'frontend', pattern: 'apps/*/src/frontend' },
        { type: 'bridge-module', pattern: 'apps/stakes-bridge/src/*' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            { from: { element: { type: 'core' } }, allow: { to: { element: { type: 'core' } } } },
            {
              from: { element: { type: 'adapters' } },
              allow: { to: { element: { types: ['adapters', 'core'] } } },
            },
            {
              from: { element: { type: 'services' } },
              allow: { to: { element: { types: ['services', 'core', 'adapters'] } } },
            },
            {
              from: { element: { type: 'entry' } },
              allow: { to: { element: { types: ['entry', 'services', 'adapters', 'core'] } } },
            },
            {
              from: { element: { type: 'frontend' } },
              allow: { to: { element: { type: 'frontend' } } },
            },
            {
              from: { element: { type: 'bridge-module' } },
              allow: { to: { element: { type: 'bridge-module' } } },
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/stakes/src/core/**/*.ts'],
    rules: noForgeImports(),
  },
  {
    files: ['apps/stakes/src/services/**/*.ts'],
    rules: noForgeImports(),
  },
  {
    // Entry points register handlers and queue events, but reach Jira, storage and
    // the graph only through adapters.
    files: ['apps/stakes/src/{resolvers,actions,triggers}/**/*.ts'],
    rules: noForgeImports(['@forge/resolver', '@forge/events']),
  },
  {
    files: ['apps/stakes/src/frontend/**/*.{ts,tsx}'],
    rules: noForgeImports(['@forge/react', '@forge/bridge']),
  },
  {
    files: ['apps/stakes/src/adapters/**/*.ts'],
    rules: noForgeImports([
      ...forgePlatformPackages,
      '@forge/resolver',
      '@forge/events',
      '@forge/bridge',
    ]),
  },
  prettier,
);
