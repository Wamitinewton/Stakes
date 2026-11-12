import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM script without type declarations
import { findEgress } from '../../scripts/check-egress.mjs';

describe('findEgress', () => {
  it('passes a manifest with no external permissions', () => {
    expect(findEgress({ modules: {}, permissions: { scopes: ['read:jira-work'] } })).toEqual([]);
  });

  it('flags an external.fetch backend host', () => {
    const manifest = { permissions: { external: { fetch: { backend: ['api.hubapi.com'] } } } };
    expect(findEgress(manifest)).toEqual(['permissions.external.fetch: api.hubapi.com']);
  });

  it('flags client-side egress such as images or scripts', () => {
    const manifest = { permissions: { external: { images: ['cdn.example.com'] } } };
    expect(findEgress(manifest)).toEqual(['permissions.external.images: cdn.example.com']);
  });

  it('flags remotes and providers', () => {
    const manifest = { remotes: [{ key: 'r', baseUrl: 'https://x' }], providers: { auth: [] } };
    expect(findEgress(manifest)).toEqual(['remotes are declared', 'providers are declared']);
  });

  it('ignores an empty external block', () => {
    expect(findEgress({ permissions: { external: {} } })).toEqual([]);
  });
});
