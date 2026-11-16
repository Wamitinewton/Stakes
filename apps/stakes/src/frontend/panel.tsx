import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  DynamicTable,
  EmptyState,
  Heading,
  Inline,
  Link,
  Lozenge,
  Pressable,
  ProgressBar,
  SectionMessage,
  Spinner,
  Stack,
  Strong,
  Text,
  User,
  useProductContext,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import {
  formatDate,
  formatUsd,
  type PanelView,
  type ScoreHistory,
  type SignalKey,
} from '@stakes/contracts';
import { historyChange, sparklinePoints } from './history.js';
import {
  BADGE_APPEARANCE,
  BADGE_LABEL,
  CONFIDENCE_LABEL,
  SOURCE_LABEL,
  evidenceValue,
  formatTile,
  groupEvidence,
  panelNotices,
  relativeTime,
  suggestionText,
} from './format.js';

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

// invoke() only wraps the result in { body } when metadata was requested, which these
// views never do, but the type allows both shapes.
function unwrap<T extends object>(response: T | { body: T }): T {
  return 'body' in response ? response.body : response;
}

const TIER_LABEL = { enterprise: 'Enterprise', 'mid-market': 'Mid-market', smb: 'SMB' } as const;

const tileStyle = xcss({
  width: '48%',
  padding: 'space.150',
  borderRadius: 'radius.medium',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border',
});
const selectedTileStyle = xcss({
  width: '48%',
  padding: 'space.150',
  borderRadius: 'radius.medium',
  borderWidth: 'border.width',
  borderStyle: 'solid',
  borderColor: 'color.border.selected',
  backgroundColor: 'color.background.selected',
});

const Loading = () => (
  <Stack space="space.150">
    <Spinner label="Reading linked deals, support requests and goals" />
    <Text>Reading linked deals, support requests and goals…</Text>
  </Stack>
);

const Header = ({ view }: { view: PanelView }) => (
  <Stack space="space.100">
    <Inline space="space.100" alignBlock="center" shouldWrap>
      <Heading size="large">{`${view.score} / 100`}</Heading>
      <Lozenge appearance={view.confidence === 'high' ? 'success' : 'default'}>
        {CONFIDENCE_LABEL[view.confidence]}
      </Lozenge>
      {view.badges.map((b) => (
        <Lozenge key={b} appearance={BADGE_APPEARANCE[b]} isBold>
          {BADGE_LABEL[b]}
        </Lozenge>
      ))}
    </Inline>
    <ProgressBar value={view.score / 100} ariaLabel={`Stakes Score ${view.score} out of 100`} />
    <Text>{suggestionText(view)}</Text>
  </Stack>
);

const Tiles = ({
  view,
  selected,
  onSelect,
}: {
  view: PanelView;
  selected: SignalKey | null;
  onSelect: (s: SignalKey | null) => void;
}) => (
  <Stack space="space.100">
    <Heading size="small">Signals</Heading>
    <Inline space="space.100" shouldWrap>
      {view.tiles.map((t) => {
        const text = formatTile(view, t.signal)!;
        const isSelected = selected === t.signal;
        return (
          <Pressable
            key={t.signal}
            xcss={isSelected ? selectedTileStyle : tileStyle}
            onClick={() => onSelect(isSelected ? null : t.signal)}
            isDisabled={text.evidenceCount === 0}
          >
            <Stack space="space.050">
              <Inline spread="space-between">
                <Text size="small">{text.label}</Text>
                <Text size="small">
                  <Strong>{text.points}</Strong>
                </Text>
              </Inline>
              <Text>
                <Strong>{text.value}</Strong>
              </Text>
              <Text size="small">{text.detail}</Text>
            </Stack>
          </Pressable>
        );
      })}
    </Inline>
  </Stack>
);

const Customers = ({ view }: { view: PanelView }) => {
  if (view.customers.length === 0) return null;
  return (
    <Stack space="space.100">
      <Heading size="small">Customers</Heading>
      <DynamicTable
        head={{
          cells: [
            { key: 'name', content: 'Customer' },
            { key: 'value', content: 'Deal value' },
            { key: 'date', content: 'Closes or renews' },
            { key: 'owner', content: 'Owner' },
          ],
        }}
        rows={view.customers.map((c) => ({
          key: c.id,
          cells: [
            { key: 'name', content: `${c.name} · ${TIER_LABEL[c.tier]}` },
            { key: 'value', content: c.dealValueUsd > 0 ? formatUsd(c.dealValueUsd) : '—' },
            { key: 'date', content: c.date ? formatDate(c.date) : '—' },
            {
              key: 'owner',
              content: c.ownerAccountId ? <User accountId={c.ownerAccountId} /> : '—',
            },
          ],
        }))}
      />
    </Stack>
  );
};

const History = ({ history }: { history: ScoreHistory | null }) => {
  if (!history || history.points.length === 0) return null;
  const first = history.points[0]!.score;
  const last = history.points.at(-1)!.score;
  const change = historyChange(history.points);
  return (
    <Stack space="space.100">
      <Inline spread="space-between" alignBlock="center">
        <Heading size="small">Score history</Heading>
        <Text size="small">{`${change >= 0 ? '+' : ''}${change} in 30 days`}</Text>
      </Inline>
      <svg
        viewBox="0 0 240 48"
        width="100%"
        height="48"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Stakes Score changed from ${first} to ${last} over ${history.points.length} days`}
      >
        <polyline
          points={sparklinePoints(history.points)}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
    </Stack>
  );
};

const Evidence = ({ view, selected }: { view: PanelView; selected: SignalKey | null }) => {
  const [open, setOpen] = useState(false);
  const only = selected ? (view.tiles.find((t) => t.signal === selected)?.evidenceIds ?? []) : null;
  const groups = groupEvidence(view.evidence, only);
  const showing = open || selected !== null;
  return (
    <Stack space="space.100">
      <Inline spread="space-between" alignBlock="center">
        <Heading size="small">{`Evidence (${view.evidence.length})`}</Heading>
        <Button appearance="subtle" onClick={() => setOpen(!showing)}>
          {showing ? 'Hide' : 'Show'}
        </Button>
      </Inline>
      {showing &&
        groups.map((g) => (
          <Stack key={g.label} space="space.075">
            <Text>
              <Strong>{`${g.label} (${g.items.length})`}</Strong>
            </Text>
            {g.items.map((e) => (
              <Stack key={e.id} space="space.025">
                <Inline space="space.100" spread="space-between">
                  <Link href={e.url} openNewTab>
                    {e.title}
                  </Link>
                  <Text>{evidenceValue(e)}</Text>
                </Inline>
                <Text size="small">{`${e.detail} · ${SOURCE_LABEL[e.source]}`}</Text>
              </Stack>
            ))}
          </Stack>
        ))}
    </Stack>
  );
};

const NoEvidence = ({ issueKey }: { issueKey: string }) => (
  <EmptyState
    header="No customers, deals or tickets are linked yet"
    description={`Stakes scores an issue from linked deals, customers, support requests, conversations and goals. Nothing is linked to ${issueKey} yet. Jira admins can import customers and deals from a CSV file, or load the Orbit Pay demo data, in Stakes settings.`}
  />
);

const Footer = ({
  view,
  refreshing,
  onRefresh,
}: {
  view: PanelView;
  refreshing: boolean;
  onRefresh: () => void;
}) => (
  <Inline space="space.100" alignBlock="center">
    <Text size="small">{`Updated ${relativeTime(view.computedAt, new Date())}`}</Text>
    <Button appearance="subtle" onClick={onRefresh} isDisabled={refreshing}>
      {refreshing ? 'Refreshing…' : 'Refresh'}
    </Button>
  </Inline>
);

const Stakes = ({
  view,
  history,
  refreshing,
  onRefresh,
}: {
  view: PanelView;
  history: ScoreHistory | null;
  refreshing: boolean;
  onRefresh: () => void;
}) => {
  const [selected, setSelected] = useState<SignalKey | null>(null);
  const empty = view.evidence.length === 0;
  return (
    <Stack space="space.200">
      {panelNotices(view).map((n) => (
        <SectionMessage key={n.text} appearance={n.appearance}>
          <Text>{n.text}</Text>
        </SectionMessage>
      ))}
      {empty && view.badges.length === 0 ? (
        <NoEvidence issueKey={view.issueKey} />
      ) : (
        <>
          <Header view={view} />
          {empty ? (
            <NoEvidence issueKey={view.issueKey} />
          ) : (
            <>
              <Stack space="space.050">
                <Heading size="small">Why it matters</Heading>
                <Text>{view.summary.text}</Text>
                <Text size="small">{`Summary from ${view.summary.sourceCount} evidence items`}</Text>
              </Stack>
              <Tiles view={view} selected={selected} onSelect={setSelected} />
              <Customers view={view} />
              <History history={history} />
              <Evidence view={view} selected={selected} />
            </>
          )}
        </>
      )}
      <Footer view={view} refreshing={refreshing} onRefresh={onRefresh} />
    </Stack>
  );
};

const App = () => {
  const context = useProductContext();
  const issueKey = (context?.extension as { issue?: { key?: string } } | undefined)?.issue?.key;
  const [result, setResult] = useState<Result<PanelView> | null>(null);
  const [history, setHistory] = useState<ScoreHistory | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(
    (refresh: boolean) => {
      if (!issueKey) return;
      if (refresh) setRefreshing(true);
      invoke<Result<PanelView>>('getStakes', { issueKey, refresh })
        .then(async (r) => {
          const next = unwrap(r);
          setResult(next);
          if (!next.ok) {
            setHistory(null);
            return;
          }
          const response = await invoke<Result<ScoreHistory>>('getHistory', {
            issueKey,
            days: 30,
          }).catch(() => null);
          const nextHistory = response ? unwrap(response) : null;
          setHistory(nextHistory?.ok ? nextHistory.data : null);
        })
        .catch(() => {
          setResult({
            ok: false,
            error: { code: 'INTERNAL', message: 'Stakes could not load. Try Refresh.' },
          });
          setHistory(null);
        })
        .finally(() => setRefreshing(false));
    },
    [issueKey],
  );

  useEffect(() => load(false), [load]);

  if (!result) return <Loading />;
  if (!result.ok) {
    const forbidden = result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND';
    return (
      <SectionMessage appearance={forbidden ? 'information' : 'warning'}>
        <Text>
          {forbidden ? "You don't have access to this issue's linked items." : result.error.message}
        </Text>
      </SectionMessage>
    );
  }
  return (
    <Box>
      <Stakes
        view={result.data}
        history={history}
        refreshing={refreshing}
        onRefresh={() => load(true)}
      />
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
