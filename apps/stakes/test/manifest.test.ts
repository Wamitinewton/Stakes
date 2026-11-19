import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.mock('@forge/llm', () => ({ chat: vi.fn(), list: vi.fn() }));
vi.mock('@forge/api', () => ({ default: { asUser: vi.fn(), asApp: vi.fn() }, route: vi.fn() }));

const manifest = parse(readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8'));
const modules = manifest.modules;
const actionKeys: string[] = modules.action.map((a: { key: string }) => a.key);

describe('manifest: Rovo and MCP', () => {
  it('declares seven read-only actions, each backed by an exported handler', async () => {
    const entry = await import('../src/actions/index.js');
    expect(actionKeys).toHaveLength(7);
    const functions = new Map(
      modules.function.map((f: { key: string; handler: string }) => [f.key, f.handler]),
    );
    for (const a of modules.action) {
      expect(a.actionVerb).toBe('GET');
      expect(a.description.length).toBeGreaterThan(80);
      const handler = functions.get(a.function) as string;
      expect(handler).toMatch(/^actions\/index\./);
      expect(typeof (entry as Record<string, unknown>)[handler.split('.')[1]!]).toBe('function');
    }
  });

  it('gives the agent and the MCP server every action, and the four demo questions', () => {
    const [agent] = modules['rovo:agent'];
    const [mcp] = modules['rovo:mcp'];
    expect(agent.actions).toEqual(actionKeys);
    expect(mcp.tools).toEqual(actionKeys);
    expect(agent.name.length).toBeLessThanOrEqual(30);
    expect(mcp.name.length).toBeLessThanOrEqual(30);
    expect(agent.conversationStarters).toEqual([
      'What should we fix first in PAY?',
      'What is Kilima Freight waiting on?',
      'What revenue does release 2026.12 unblock?',
      'Draft an update for customers waiting on PAY-142.',
    ]);
  });

  it('names every action in the agent prompt and in skill.md', () => {
    const prompt = readFileSync(new URL('../prompts/agent.md', import.meta.url), 'utf8');
    const skill = readFileSync(new URL('../../../skill.md', import.meta.url), 'utf8');
    for (const key of actionKeys) {
      expect(prompt).toContain(key);
      expect(skill).toContain(`stakes_${key.replace(/-/g, '_')}`);
    }
  });

  it('runs both ship triggers and indexes the ship notice property', () => {
    const events = modules.trigger.flatMap((t: { events: string[] }) => t.events);
    expect(events).toEqual(['avi:jira:updated:issue', 'avi:jira:released:version']);
    const [property] = modules['jira:entityProperty'];
    expect(property.propertyKey).toBe('stakes.shipNotice');
    expect(property.values.map((v: { path: string }) => v.path)).toEqual(['status', 'deliveredAt']);
  });
});
