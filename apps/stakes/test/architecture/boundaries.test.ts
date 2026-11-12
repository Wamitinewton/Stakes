import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

// Lints a miniature copy of the source tree with the real workspace config, so the
// layer rules are proven to fire rather than assumed to.
const fixtureRoot = fileURLToPath(new URL('../fixtures/layers', import.meta.url));
const configFile = fileURLToPath(new URL('../../../../eslint.config.js', import.meta.url));

let results: Map<string, string[]>;

beforeAll(async () => {
  const eslint = new ESLint({
    cwd: fixtureRoot,
    overrideConfigFile: configFile,
    // Element patterns are matched relative to this root, which otherwise defaults to
    // the process directory rather than the fixture tree.
    overrideConfig: { settings: { 'boundaries/root-path': fixtureRoot } },
  });
  const lint = await eslint.lintFiles(['apps/stakes/src/**/*.{ts,tsx}']);
  results = new Map(
    lint.map((r) => [
      r.filePath.slice(fixtureRoot.length + 1).replace(/\\/g, '/'),
      r.messages.map((m) => m.ruleId ?? m.message),
    ]),
  );
}, 30_000);

const rulesFor = (file: string) => {
  const rules = results.get(`apps/stakes/src/${file}`);
  if (!rules) throw new Error(`fixture not linted: ${file}`);
  return rules;
};

describe('layer boundaries', () => {
  it('rejects a Forge import in core', () => {
    expect(rulesFor('core/imports-forge.ts')).toContain('no-restricted-imports');
  });

  it('rejects an adapter import in core', () => {
    expect(rulesFor('core/imports-adapter.ts')).toContain('boundaries/dependencies');
  });

  it('rejects a Forge storage import in services', () => {
    expect(rulesFor('services/imports-forge-kvs.ts')).toContain('no-restricted-imports');
  });

  it('rejects a service import in adapters', () => {
    expect(rulesFor('adapters/imports-service.ts')).toContain('boundaries/dependencies');
  });

  it('rejects a Forge platform import in entry points', () => {
    expect(rulesFor('resolvers/imports-forge-api.ts')).toContain('no-restricted-imports');
  });

  it('rejects a backend import in the frontend', () => {
    expect(rulesFor('frontend/imports-service.tsx')).toContain('boundaries/dependencies');
  });

  it.each([
    'core/imports-core.ts',
    'services/imports-core-and-adapter.ts',
    'adapters/imports-forge-api.ts',
    'resolvers/imports-core.ts',
  ])('allows %s', (file) => {
    expect(rulesFor(file)).toEqual([]);
  });
});
