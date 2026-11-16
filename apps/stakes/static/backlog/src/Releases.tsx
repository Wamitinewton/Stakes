import { useCallback, useEffect, useState } from 'react';
import DynamicTable from '@atlaskit/dynamic-table';
import { token } from '@atlaskit/tokens';
import type { IssueKey, ProjectKey, ReleaseView } from '@stakes/contracts';
import { call } from './lib/invoke';
import { applyCuts } from './lib/release';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export default function Releases({ projectKey }: { projectKey: ProjectKey }) {
  const [release, setRelease] = useState<ReleaseView | null>(null);
  const [cutKeys, setCutKeys] = useState<ReadonlySet<IssueKey>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (versionId?: string) => {
      setLoading(true);
      setError(null);
      setCutKeys(new Set());
      try {
        setRelease(
          await call<ReleaseView>('getReleaseStakes', {
            projectKey,
            ...(versionId ? { versionId } : {}),
          }),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to load release stakes');
      } finally {
        setLoading(false);
      }
    },
    [projectKey],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const view = release ? applyCuts(release, cutKeys) : null;
  const cutCount = release && view ? release.issues.length - view.keptIssues.length : 0;
  const losingNames = view?.customersLosingFix.map((customer) => customer.name) ?? [];

  const toggleCut = (issueKey: IssueKey) => {
    setCutKeys((current) => {
      const next = new Set(current);
      if (next.has(issueKey)) next.delete(issueKey);
      else next.add(issueKey);
      return next;
    });
  };

  return (
    <div style={{ display: 'grid', gap: 16, paddingTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          Fix version
          <select
            aria-label="Fix version"
            disabled={loading || !release || release.versions.length === 0}
            value={release?.version?.id ?? ''}
            onChange={(event) => void load(event.target.value)}
            style={{
              minWidth: 220,
              minHeight: 32,
              padding: '0 8px',
              color: token('color.text'),
              background: token('color.background.input'),
              border: `1px solid ${token('color.border')}`,
              borderRadius: 4,
            }}
          >
            {release?.versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.name} · unreleased
              </option>
            ))}
          </select>
        </label>
        <span>Toggle Cut to see what the release loses. Nothing changes in Jira.</span>
      </div>

      {loading && <p role="status">Loading release stakes…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && release?.versions.length === 0 && (
        <p>No unreleased versions in this project.</p>
      )}

      {release?.version && view && (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 24,
              padding: 16,
              background: token('color.background.neutral.subtle'),
              border: `1px solid ${token('color.border')}`,
              borderRadius: 8,
            }}
          >
            <div>
              <div>Open deals unblocked</div>
              <strong style={{ fontSize: 20 }}>{money.format(view.revenueUsd)}</strong>
              <div>
                {view.dealCount} deals, each counted once
                {view.revenueLostUsd > 0
                  ? ` · was ${money.format(view.revenueUsd + view.revenueLostUsd)}`
                  : ''}
              </div>
            </div>
            <div>
              <div>Customers served</div>
              <strong style={{ fontSize: 20 }}>{view.customers.length}</strong>
              <div>{view.customers.map((customer) => customer.name).join(', ') || 'None'}</div>
            </div>
            <div>
              <div>Issues kept</div>
              <strong style={{ fontSize: 20 }}>
                {view.keptIssues.length} of {release.issues.length}
              </strong>
              <div>Ranked by Stakes Score</div>
            </div>
          </div>

          {cutCount > 0 && (
            <div
              role="status"
              style={{
                padding: 12,
                color: token('color.text.warning'),
                background: token('color.background.warning'),
                borderRadius: 6,
              }}
            >
              {view.revenueLostUsd > 0 && (
                <div>
                  Cutting the selected issues leaves {money.format(view.revenueLostUsd)} in open
                  deals blocked.
                </div>
              )}
              {losingNames.length > 0 ? (
                <div>{losingNames.join(', ')} would no longer get a fix in this release.</div>
              ) : (
                view.revenueLostUsd === 0 && (
                  <div>This cut keeps every deal and customer covered.</div>
                )
              )}
            </div>
          )}

          <DynamicTable
            caption={`Issues in ${release.version.name}, ranked by Stakes Score`}
            head={{
              cells: [
                { key: 'cut', content: 'Cut' },
                { key: 'issue', content: 'Issue' },
                { key: 'summary', content: 'Summary' },
                { key: 'score', content: 'Stakes Score' },
                { key: 'deals', content: 'Open deals' },
                { key: 'customers', content: 'Customers' },
              ],
            }}
            rows={release.issues.map((issue) => {
              const cut = cutKeys.has(issue.issueKey);
              const dealIds = new Set(issue.dealIds);
              const deals = release.deals.filter((deal) => dealIds.has(deal.id));
              const revenue = deals.reduce((total, deal) => total + deal.amountUsd, 0);
              const customerIds = new Set(issue.customerIds);
              const customers = release.customers.filter((customer) =>
                customerIds.has(customer.id),
              );
              return {
                key: issue.issueKey,
                style: cut ? { opacity: 0.55, textDecoration: 'line-through' } : undefined,
                cells: [
                  {
                    key: 'cut',
                    content: (
                      <input
                        type="checkbox"
                        checked={cut}
                        onChange={() => toggleCut(issue.issueKey)}
                        aria-label={`Cut ${issue.issueKey} from ${release.version?.name}`}
                      />
                    ),
                  },
                  {
                    key: 'issue',
                    content: (
                      <a href={issue.url} target="_blank" rel="noreferrer">
                        {issue.issueKey}
                      </a>
                    ),
                  },
                  { key: 'summary', content: issue.summary },
                  {
                    key: 'score',
                    content:
                      issue.score === null ? (
                        'Not scored'
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span>{issue.score}</span>
                          <span
                            role="img"
                            aria-label={`Stakes Score ${issue.score} out of 100`}
                            style={{
                              width: 80,
                              height: 4,
                              background: token('color.chart.neutral'),
                              borderRadius: 2,
                            }}
                          >
                            <span
                              style={{
                                display: 'block',
                                width: `${issue.score}%`,
                                height: '100%',
                                background: token('color.chart.brand'),
                                borderRadius: 2,
                              }}
                            />
                          </span>
                        </div>
                      ),
                  },
                  {
                    key: 'deals',
                    content: revenue > 0 ? `${money.format(revenue)} · ${deals.length}` : '—',
                  },
                  {
                    key: 'customers',
                    content: customers.map((customer) => customer.name).join(', ') || '—',
                  },
                ],
              };
            })}
            rowsPerPage={25}
          />
        </>
      )}
    </div>
  );
}
