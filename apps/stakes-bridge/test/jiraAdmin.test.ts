import { describe, expect, it, vi } from 'vitest';

vi.mock('@forge/api', () => ({
  default: { asUser: vi.fn(), asApp: vi.fn() },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce(
      (path, part, index) =>
        path + part + (index < values.length ? encodeURIComponent(String(values[index])) : ''),
      '',
    ),
}));

const { makeJiraAdmin } = await import('../src/adapters/jira.js');

describe('Jira admin adapter', () => {
  it.each([true, false])('reads the ADMINISTER permission as %s', async (havePermission) => {
    const http = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ permissions: { ADMINISTER: { havePermission } } }),
    }));

    expect(await makeJiraAdmin(http).isAdmin()).toBe(havePermission);
    expect(http).toHaveBeenCalledWith('/rest/api/3/mypermissions?permissions=ADMINISTER');
  });

  it('fails closed when Jira rejects the permission read', async () => {
    const http = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    expect(await makeJiraAdmin(http).isAdmin()).toBe(false);
  });
});
