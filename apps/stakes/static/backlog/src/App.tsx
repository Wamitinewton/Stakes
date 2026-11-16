import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Button from '@atlaskit/button';
import DynamicTable from '@atlaskit/dynamic-table';
import Lozenge from '@atlaskit/lozenge';
import ProgressBar from '@atlaskit/progress-bar';
import Tabs, { Tab, TabList, TabPanel } from '@atlaskit/tabs';
import { token } from '@atlaskit/tokens';
import { invoke, view } from '@forge/bridge';
import type { BacklogList, BacklogRow, ProjectKey } from '@stakes/contracts';
import { batchesOf20, mergeRows } from './lib/backlog';

type ResolverResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

async function call<T>(resolver: string, payload: Record<string, unknown>): Promise<T> {
  const result = (await invoke<ResolverResult<T>>(resolver, payload)) as ResolverResult<T>;
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function badge(row: BacklogRow): ReactNode {
  if (row.badges.includes('silent-fire'))
    return <Lozenge appearance="inprogress">Silent fire</Lozenge>;
  if (row.badges.includes('phantom')) return <Lozenge>Phantom priority</Lozenge>;
  if (row.badges.includes('stakes-jump'))
    return <Lozenge appearance="success">Stakes jump</Lozenge>;
  return '—';
}

function BacklogTable({ rows }: { rows: BacklogRow[] }) {
  return (
    <DynamicTable
      caption="Open issues ranked by Stakes Score"
      head={{
        cells: [
          { key: 'rank', content: '#' },
          { key: 'issue', content: 'Issue' },
          { key: 'score', content: 'Stakes Score' },
          { key: 'priority', content: 'Priority' },
          { key: 'revenue', content: 'Revenue at risk' },
          { key: 'customers', content: 'Customers' },
          { key: 'tickets', content: 'Tickets' },
          { key: 'badge', content: 'Flag' },
        ],
      }}
      rows={rows.map((row, index) => ({
        key: row.issueKey,
        cells: [
          { key: 'rank', content: index + 1 },
          {
            key: 'issue',
            content: (
              <div>
                <div>{row.issueKey}</div>
                <div>{row.summary}</div>
              </div>
            ),
          },
          {
            key: 'score',
            content:
              row.score === null ? (
                'Not scored'
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>{row.score}</span>
                  <span
                    role="img"
                    aria-label={`Stakes Score ${row.score} out of 100`}
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
                        width: `${row.score}%`,
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
            key: 'priority',
            content: row.suggestedPriority
              ? `${row.currentPriority} → ${row.suggestedPriority}`
              : row.currentPriority,
          },
          { key: 'revenue', content: money.format(row.revenueUsd) },
          { key: 'customers', content: row.customers },
          { key: 'tickets', content: row.tickets },
          { key: 'badge', content: badge(row) },
        ],
      }))}
      rowsPerPage={25}
    />
  );
}

function Placeholder({ children }: { children: string }) {
  return <p>{children}</p>;
}

export default function App() {
  const [projectKey, setProjectKey] = useState<ProjectKey | null>(null);
  const [rows, setRows] = useState<BacklogRow[]>([]);
  const [summary, setSummary] = useState<BacklogList['summary'] | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

  const load = useCallback(async (key: ProjectKey) => {
    setLoading(true);
    setError(null);
    try {
      const listed = await call<BacklogList>('listBacklog', { projectKey: key });
      setRows(listed.rows);
      setSummary(listed.summary);
      const alreadyScored = listed.rows.length - listed.staleKeys.length;
      setProgress({ done: alreadyScored, total: listed.rows.length });
      let current = listed.rows;
      let done = alreadyScored;
      for (const issueKeys of batchesOf20(listed.staleKeys)) {
        const batch = await call<{ rows: BacklogRow[] }>('recomputeBatch', { issueKeys });
        current = mergeRows(current, batch.rows);
        done += issueKeys.length;
        setRows(current);
        setProgress({ done, total: listed.rows.length });
      }
      await call('updatePercentiles', { projectKey: key });
      const refreshed = await call<BacklogList>('listBacklog', { projectKey: key });
      setRows(refreshed.rows);
      setSummary(refreshed.summary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load Stakes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void view
      .getContext()
      .then((context) => {
        const extension = (context as { extensionContext?: { projectKey?: unknown } })
          .extensionContext;
        if (typeof extension?.projectKey !== 'string') {
          throw new Error('Open Stakes from a Jira project page');
        }
        const key = extension.projectKey as ProjectKey;
        setProjectKey(key);
        return load(key);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Unable to read the project');
        setLoading(false);
      });
  }, [load]);

  return (
    <main
      style={{
        minHeight: '100vh',
        padding: 24,
        color: token('color.text'),
        background: token('color.background.neutral.subtle'),
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Stakes{projectKey ? ` · ${projectKey}` : ''}</h1>
        <Button
          isDisabled={loading || !projectKey}
          onClick={() => projectKey && void load(projectKey)}
        >
          Refresh scores
        </Button>
      </div>

      <Tabs id="stakes-views" selected={tab} onChange={setTab}>
        <TabList>
          <Tab>Backlog</Tab>
          <Tab>Releases</Tab>
          <Tab>Customers</Tab>
          <Tab>Sprint plan</Tab>
        </TabList>
        <TabPanel>
          <div style={{ display: 'grid', gap: 16, paddingTop: 16 }}>
            {loading && progress && (
              <div role="status">
                <p>
                  Scoring {progress.done} of {progress.total} issues
                </p>
                <ProgressBar
                  ariaLabel={`Scoring ${progress.done} of ${progress.total} issues`}
                  value={progress.total === 0 ? 0 : progress.done / progress.total}
                />
              </div>
            )}
            {error && <p role="alert">{error}</p>}
            {summary && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24 }}>
                <span>{summary.scored} issues scored</span>
                <span>{summary.silentFires} silent fires</span>
                <span>{summary.phantoms} phantom priorities</span>
                <span>{money.format(summary.revenueUsd)} revenue at risk</span>
              </div>
            )}
            {!loading && !error && rows.length === 0 ? (
              <p>No open issues in this project.</p>
            ) : (
              <BacklogTable rows={rows} />
            )}
          </div>
        </TabPanel>
        <TabPanel>
          <Placeholder>Release stakes will appear here.</Placeholder>
        </TabPanel>
        <TabPanel>
          <Placeholder>Customer exposure will appear here.</Placeholder>
        </TabPanel>
        <TabPanel>
          <Placeholder>Sprint planning will appear here.</Placeholder>
        </TabPanel>
      </Tabs>
    </main>
  );
}
