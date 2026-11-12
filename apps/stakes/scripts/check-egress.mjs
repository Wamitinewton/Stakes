#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

// Runs on Atlassian eligibility allows no outbound domains (beyond analytics), remotes
// or providers. This check needs no Forge login, so it guards every pull request even
// when `forge eligibility` cannot run for lack of credentials.
export function findEgress(manifest) {
  const reasons = [];
  const external = manifest?.permissions?.external;
  if (external && typeof external === 'object') {
    for (const [kind, value] of Object.entries(external)) {
      const hosts = collectHosts(value);
      if (hosts.length > 0) reasons.push(`permissions.external.${kind}: ${hosts.join(', ')}`);
    }
  }
  if (hasEntries(manifest?.remotes)) reasons.push('remotes are declared');
  if (hasEntries(manifest?.providers)) reasons.push('providers are declared');
  return reasons;
}

function collectHosts(value) {
  if (Array.isArray(value))
    return value.map((v) => (typeof v === 'string' ? v : JSON.stringify(v)));
  if (value && typeof value === 'object') return Object.values(value).flatMap(collectHosts);
  return [];
}

function hasEntries(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return false;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2] ?? new URL('../manifest.yml', import.meta.url);
  const reasons = findEgress(parse(readFileSync(path, 'utf8')));
  if (reasons.length > 0) {
    console.error('stakes must declare no egress, but the manifest has:');
    for (const r of reasons) console.error(`  - ${r}`);
    process.exit(1);
  }
  console.log('stakes manifest declares no egress');
}
