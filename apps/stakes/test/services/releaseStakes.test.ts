import { describe, expect, it, vi } from 'vitest';
import type { EvidenceItem } from '@stakes/contracts';
import { releaseStakes, type ReleaseDeps } from '../../src/services/releaseStakes';
import { issueDetails, mirrorCustomer } from '../fakes/deps';
import { snapshot } from '../fakes/snapshot';

function deal(dealId: string, customerId: string, amountUsd: number, closed = false): EvidenceItem {
  return {
    id: `ev-deal-${dealId}`,
    type: 'deal',
    title: dealId,
    value: amountUsd,
    unit: 'USD',
    detail: '',
    url: '',
    signal: 'R',
    source: 'mirror',
    fetchedAt: '2026-11-20T08:00:00.000Z',
    facts: {
      kind: 'deal',
      dealId,
      customerId,
      amountUsd,
      probability: 0.5,
      stage: 'Negotiation',
      closeDate: null,
      closed,
      ownerAccountId: null,
    },
  };
}

function customer(customerId: string, name: string): EvidenceItem {
  return {
    id: `ev-customer-${customerId}`,
    type: 'customer',
    title: name,
    value: null,
    unit: null,
    detail: '',
    url: '',
    signal: 'R',
    source: 'mirror',
    fetchedAt: '2026-11-20T08:00:00.000Z',
    facts: {
      kind: 'customer',
      customerId,
      name,
      tier: 'enterprise',
      arrUsd: 100000,
      renewalDate: null,
      ownerAccountId: null,
    },
  };
}

function makeDeps(overrides: Partial<ReleaseDeps> = {}): ReleaseDeps {
  return {
    jira: {
      unreleasedVersions: vi.fn(async () => [{ id: '10001', name: '2026.12' }]),
      openIssues: vi.fn(async () => []),
    },
    snapshots: { latestMany: vi.fn(async () => []) },
    mirror: { customersByIds: vi.fn(async () => []) },
    ...overrides,
  };
}

describe('releaseStakes', () => {
  it('ranks issues and counts shared deals and customers only once', async () => {
    const openIssues = vi.fn(async () => [
      issueDetails({ key: 'PAY-118', summary: 'Webhook retries', fixVersions: ['2026.12'] }),
      issueDetails({ key: 'PAY-142', summary: 'CSV export', fixVersions: ['2026.12'] }),
      issueDetails({ key: 'PAY-140', summary: 'Other version', fixVersions: ['2026.13'] }),
    ]);
    const latestMany = vi.fn(async () => [
      snapshot({
        issueKey: 'PAY-142',
        score: 89,
        evidence: [
          deal('DEAL-031', 'CUST-007', 220000),
          deal('DEAL-034', 'CUST-009', 160000),
          customer('CUST-007', 'Kilima Freight'),
          customer('CUST-009', 'Savanna Health'),
        ],
      }),
      snapshot({
        issueKey: 'PAY-118',
        score: 72,
        evidence: [deal('DEAL-031', 'CUST-007', 220000), customer('CUST-007', 'Kilima Freight')],
      }),
    ]);
    const customersByIds = vi.fn(async () => [
      mirrorCustomer('CUST-007', 'enterprise', { name: 'Kilima Freight' }),
      mirrorCustomer('CUST-009', 'enterprise', { name: 'Savanna Health' }),
    ]);
    const deps = makeDeps({
      jira: {
        unreleasedVersions: vi.fn(async () => [{ id: '10001', name: '2026.12' }]),
        openIssues,
      },
      snapshots: { latestMany },
      mirror: { customersByIds },
    });

    const release = await releaseStakes(deps, 'PAY');

    expect(release).toMatchObject({
      version: { id: '10001', name: '2026.12' },
      deals: [
        { id: 'DEAL-031', amountUsd: 220000 },
        { id: 'DEAL-034', amountUsd: 160000 },
      ],
      customers: [{ id: 'CUST-007' }, { id: 'CUST-009' }],
    });
    expect(release?.issues.map((issue) => issue.issueKey)).toEqual(['PAY-142', 'PAY-118']);
    expect(release?.issues[1]?.dealIds).toEqual(['DEAL-031']);
    expect(latestMany).toHaveBeenCalledWith(['PAY-118', 'PAY-142']);
    expect(customersByIds).toHaveBeenCalledWith(expect.arrayContaining(['CUST-007', 'CUST-009']));
  });

  it('excludes closed deals and keeps unscored issues at the bottom', async () => {
    const deps = makeDeps({
      jira: {
        unreleasedVersions: vi.fn(async () => [{ id: '10001', name: '2026.12' }]),
        openIssues: vi.fn(async () => [
          issueDetails({ key: 'PAY-1', fixVersions: ['2026.12'] }),
          issueDetails({ key: 'PAY-2', fixVersions: ['2026.12'] }),
        ]),
      },
      snapshots: {
        latestMany: vi.fn(async () => [
          snapshot({
            issueKey: 'PAY-2',
            score: 50,
            evidence: [deal('DEAL-CLOSED', 'CUST-1', 90000, true)],
          }),
        ]),
      },
    });

    const release = await releaseStakes(deps, 'PAY', '10001');

    expect(release?.issues.map((issue) => [issue.issueKey, issue.score])).toEqual([
      ['PAY-2', 50],
      ['PAY-1', null],
    ]);
    expect(release?.deals).toEqual([]);
  });

  it('returns an empty view without versions and rejects an unknown version id', async () => {
    const empty = makeDeps({
      jira: { unreleasedVersions: vi.fn(async () => []), openIssues: vi.fn(async () => []) },
    });
    expect(await releaseStakes(empty, 'PAY')).toEqual({
      versions: [],
      version: null,
      issues: [],
      deals: [],
      customers: [],
    });
    expect(await releaseStakes(makeDeps(), 'PAY', 'missing')).toBeNull();
  });
});
