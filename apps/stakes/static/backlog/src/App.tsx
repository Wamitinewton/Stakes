import { useCallback, useEffect, useMemo, useState } from 'react';
import Button from '@atlaskit/button';
import ProgressBar from '@atlaskit/progress-bar';
import Tabs, { Tab, TabList, TabPanel } from '@atlaskit/tabs';
import { token } from '@atlaskit/tokens';
import { view } from '@forge/bridge';
import {
  formatUsd,
  type ApplyPriorityResult,
  type BacklogList,
  type BacklogRow,
  type IssueKey,
  type ProjectKey,
} from '@stakes/contracts';
import BacklogTable from './components/BacklogTable';
import PriorityConfirmation from './components/PriorityConfirmation';
import RowDrawer from './components/RowDrawer';
import { batchesOf20, mergeRows } from './lib/backlog';
import {
  DEFAULT_SORT,
  EMPTY_FILTERS,
  NO_FIX_VERSION,
  filterAndSortBacklog,
  type BacklogFilters,
  type BacklogSort,
} from './lib/filter';
import { call } from './lib/resolver';

const inputStyle = {
  minHeight: 32,
  padding: '4px 8px',
  color: token('color.text'),
  background: token('color.background.input'),
  border: `1px solid ${token('color.border.input')}`,
  borderRadius: 4,
  font: 'inherit',
};

function unique(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function SummaryStrip({ summary }: { summary: BacklogList['summary'] }) {
  const stats = [
    { label: 'Issues scored', value: String(summary.scored), note: `${summary.total} open issues` },
    {
      label: 'Silent fires',
      value: String(summary.silentFires),
      note: 'High stakes, low priority',
    },
    {
      label: 'Phantom priorities',
      value: String(summary.phantoms),
      note: 'High priority, no evidence',
    },
    {
      label: 'Revenue at risk',
      value: formatUsd(summary.revenueUsd),
      note: 'Distinct linked deals and renewals',
    },
  ];
  return (
    <section
      aria-label="Backlog summary"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        border: `1px solid ${token('color.border')}`,
        borderRadius: 8,
        background: token('elevation.surface'),
      }}
    >
      {stats.map((stat) => (
        <div key={stat.label} style={{ display: 'grid', gap: 4, padding: '12px 16px' }}>
          <span style={{ color: token('color.text.subtle'), fontSize: 12 }}>{stat.label}</span>
          <strong style={{ fontSize: 20 }}>{stat.value}</strong>
          <small style={{ color: token('color.text.subtle') }}>{stat.note}</small>
        </div>
      ))}
    </section>
  );
}

function FilterBar({
  rows,
  filters,
  onChange,
}: {
  rows: BacklogRow[];
  filters: BacklogFilters;
  onChange: (filters: BacklogFilters) => void;
}) {
  const versions = unique(rows.flatMap((row) => row.fixVersions));
  const components = unique(rows.flatMap((row) => row.components));
  const assignees = unique(rows.flatMap((row) => (row.assignee ? [row.assignee] : [])));
  const customers = unique(rows.flatMap((row) => row.customerNames));
  const filtered =
    filters.query ||
    filters.version ||
    filters.component ||
    filters.assignee ||
    filters.customer ||
    filters.silentFiresOnly ||
    filters.phantomsOnly;

  return (
    <div role="search" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <label>
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
          Search issues
        </span>
        <input
          type="search"
          value={filters.query}
          placeholder="Search key or summary"
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          style={{ ...inputStyle, width: 240 }}
        />
      </label>
      <label>
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
          Fix version
        </span>
        <select
          aria-label="Fix version"
          value={filters.version}
          onChange={(event) => onChange({ ...filters, version: event.target.value })}
          style={inputStyle}
        >
          <option value="">All versions</option>
          {versions.map((version) => (
            <option key={version} value={version}>
              {version}
            </option>
          ))}
          <option value={NO_FIX_VERSION}>No fix version</option>
        </select>
      </label>
      <label>
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
          Component
        </span>
        <select
          aria-label="Component"
          value={filters.component}
          onChange={(event) => onChange({ ...filters, component: event.target.value })}
          style={inputStyle}
        >
          <option value="">All components</option>
          {components.map((component) => (
            <option key={component} value={component}>
              {component}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
          Assignee
        </span>
        <select
          aria-label="Assignee"
          value={filters.assignee}
          onChange={(event) => onChange({ ...filters, assignee: event.target.value })}
          style={inputStyle}
        >
          <option value="">All assignees</option>
          {assignees.map((assignee) => (
            <option key={assignee} value={assignee}>
              {assignee}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden' }}>
          Customer
        </span>
        <select
          aria-label="Customer"
          value={filters.customer}
          onChange={(event) => onChange({ ...filters, customer: event.target.value })}
          style={inputStyle}
        >
          <option value="">All customers</option>
          {customers.map((customer) => (
            <option key={customer} value={customer}>
              {customer}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={filters.silentFiresOnly}
          onChange={(event) => onChange({ ...filters, silentFiresOnly: event.target.checked })}
        />
        Silent fires only
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={filters.phantomsOnly}
          onChange={(event) => onChange({ ...filters, phantomsOnly: event.target.checked })}
        />
        Phantoms only
      </label>
      {filtered && (
        <Button appearance="subtle" onClick={() => onChange(EMPTY_FILTERS)}>
          Clear filters
        </Button>
      )}
    </div>
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
  const [filters, setFilters] = useState<BacklogFilters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<BacklogSort>(DEFAULT_SORT);
  const [selected, setSelected] = useState<Set<IssueKey>>(new Set());
  const [drawerKey, setDrawerKey] = useState<IssueKey | null>(null);
  const [confirmationKeys, setConfirmationKeys] = useState<IssueKey[] | null>(null);
  const [applying, setApplying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ title: string; body: string } | null>(null);

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

  const visibleRows = useMemo(
    () => filterAndSortBacklog(rows, filters, sort),
    [rows, filters, sort],
  );
  const ranks = useMemo(() => new Map(rows.map((row, index) => [row.issueKey, index + 1])), [rows]);
  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.issueKey)),
    [rows, selected],
  );
  const selectedChanges = selectedRows.filter(
    (row) =>
      row.suggestedPriority &&
      row.suggestedPriority.toLowerCase() !== row.currentPriority.toLowerCase(),
  );
  const drawerRow = rows.find((row) => row.issueKey === drawerKey) ?? null;
  const confirmationRows = rows.filter((row) => confirmationKeys?.includes(row.issueKey));
  const confirmationChanges = confirmationRows.filter(
    (row) =>
      row.suggestedPriority &&
      row.suggestedPriority.toLowerCase() !== row.currentPriority.toLowerCase(),
  );
  const confirmationSkipped = confirmationRows.filter((row) => !confirmationChanges.includes(row));

  const toggle = (issueKey: IssueKey) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(issueKey)) next.delete(issueKey);
      else next.add(issueKey);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected =
        visibleRows.length > 0 && visibleRows.every((row) => next.has(row.issueKey));
      visibleRows.forEach((row) => {
        if (allSelected) next.delete(row.issueKey);
        else next.add(row.issueKey);
      });
      return next;
    });
  };

  const openConfirmation = (issueKeys: IssueKey[]) => {
    setActionError(null);
    setDrawerKey(null);
    setConfirmationKeys(issueKeys);
  };

  const applyPriorities = async () => {
    if (!projectKey || confirmationChanges.length === 0) return;
    setApplying(true);
    setActionError(null);
    try {
      const result = await call<ApplyPriorityResult>('applyPriority', {
        changes: confirmationChanges.map((row) => ({
          issueKey: row.issueKey,
          from: row.currentPriority,
          to: row.suggestedPriority,
        })),
        confirmed: true,
      });
      setConfirmationKeys(null);
      setSelected(new Set());
      let message = `${result.failed.length} failed.`;
      if (result.applied.length > 0) {
        try {
          let current = rows;
          for (const issueKeys of batchesOf20(result.applied)) {
            const batch = await call<{ rows: BacklogRow[] }>('recomputeBatch', { issueKeys });
            current = mergeRows(current, batch.rows);
          }
          setRows(current);
          const refreshed = await call<BacklogList>('listBacklog', { projectKey });
          setRows(refreshed.rows);
          setSummary(refreshed.summary);
        } catch {
          message += ' Refresh the page to see the latest rows.';
        }
      }
      setToast({
        title: `${result.applied.length} ${result.applied.length === 1 ? 'priority' : 'priorities'} applied`,
        body: message,
      });
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : 'Unable to apply priorities');
    } finally {
      setApplying(false);
    }
  };

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
            {summary && <SummaryStrip summary={summary} />}
            {rows.length > 0 && <FilterBar rows={rows} filters={filters} onChange={setFilters} />}
            {selectedRows.length > 0 && (
              <section
                aria-label="Selected issues"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 12px',
                  borderRadius: 8,
                  background: token('color.background.selected'),
                }}
              >
                <strong>
                  {selectedRows.length} {selectedRows.length === 1 ? 'issue' : 'issues'} selected
                </strong>
                <span>{selectedChanges.length} with a different suggested priority</span>
                <Button appearance="subtle" onClick={() => setSelected(new Set())}>
                  Clear selection
                </Button>
                <Button
                  appearance="primary"
                  isDisabled={selectedChanges.length === 0}
                  onClick={() => openConfirmation(selectedRows.map((row) => row.issueKey))}
                >
                  Apply suggested priorities
                </Button>
              </section>
            )}
            {!loading && !error && rows.length === 0 ? (
              <p>No open issues in this project.</p>
            ) : (
              <>
                <BacklogTable
                  rows={visibleRows}
                  ranks={ranks}
                  selected={selected}
                  sort={sort}
                  onSort={setSort}
                  onToggle={toggle}
                  onToggleAll={toggleAll}
                  onOpen={setDrawerKey}
                />
                {visibleRows.length === 0 && rows.length > 0 && (
                  <div role="status">
                    <p>No issues match these filters.</p>
                    <Button onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</Button>
                  </div>
                )}
                <small style={{ color: token('color.text.subtle') }}>
                  Showing {visibleRows.length} of {rows.length} open issues
                </small>
              </>
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

      {drawerRow && (
        <RowDrawer
          issueKey={drawerRow.issueKey}
          summary={drawerRow.summary}
          onClose={() => setDrawerKey(null)}
          onApply={(issueKey) => openConfirmation([issueKey])}
        />
      )}
      {confirmationKeys && (
        <PriorityConfirmation
          changes={confirmationChanges}
          skipped={confirmationSkipped}
          applying={applying}
          error={actionError}
          onCancel={() => setConfirmationKeys(null)}
          onConfirm={() => void applyPriorities()}
        />
      )}
      {toast && (
        <div
          role="status"
          style={{
            position: 'fixed',
            left: 24,
            bottom: 24,
            zIndex: 110,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            maxWidth: 420,
            padding: '12px 16px',
            borderRadius: 8,
            background: token('elevation.surface.overlay'),
            boxShadow: token('elevation.shadow.overlay'),
          }}
        >
          <div>
            <strong>{toast.title}</strong>
            <div>{toast.body}</div>
          </div>
          <Button
            appearance="subtle"
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            Dismiss
          </Button>
        </div>
      )}
    </main>
  );
}
