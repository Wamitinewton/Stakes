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
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  Pressable,
  ProgressBar,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Strong,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  TextArea,
  User,
  useProductContext,
  xcss,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import {
  formatDate,
  formatUsd,
  type ApplyPriorityResult,
  type CustomerDraft,
  type PanelView,
  type ReplyVisibility,
  type SendShipNoticeResult,
  type ShipNoticeView,
  type ScoreHistory,
  type SignalKey,
} from '@stakes/contracts';
import { historyChange, sparklinePoints } from './history.js';
import {
  VISIBILITY_LABEL,
  bannerText,
  confirmationLines,
  ownerCount,
  recipientText,
  resultLines,
  type ReplyDraft,
} from './shipNotice.js';
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
  summarySegments,
  summarySourceText,
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

const Header = ({
  view,
  refreshing,
  onApply,
}: {
  view: PanelView;
  refreshing: boolean;
  onApply: () => void;
}) => (
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
    <Inline space="space.100" alignBlock="center" spread="space-between">
      <Text>{suggestionText(view)}</Text>
      {view.suggestedPriority !== null && (
        <Button appearance="primary" onClick={onApply} isDisabled={refreshing}>
          Apply
        </Button>
      )}
    </Inline>
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

const WhyItMatters = ({ view }: { view: PanelView }) => (
  <Stack space="space.050">
    <Heading size="small">Why it matters</Heading>
    <Text>
      {summarySegments(view.summary.text, view.evidence).map((s, i) =>
        s.kind === 'text' ? (
          <React.Fragment key={i}>{s.text}</React.Fragment>
        ) : (
          <Link key={i} href={s.url} openNewTab>
            {` [${s.n}]`}
          </Link>
        ),
      )}
    </Text>
    <Text size="small">{summarySourceText(view.summary)}</Text>
  </Stack>
);

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
  const [confirmApply, setConfirmApply] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyProblem, setApplyProblem] = useState<string | null>(null);
  const empty = view.evidence.length === 0;

  const apply = async () => {
    if (!view.suggestedPriority) return;
    setApplying(true);
    setApplyProblem(null);
    try {
      const response = unwrap(
        await invoke<Result<ApplyPriorityResult>>('applyPriority', {
          changes: [
            {
              issueKey: view.issueKey,
              from: view.currentPriority,
              to: view.suggestedPriority,
            },
          ],
          confirmed: true,
        }),
      );
      if (!response.ok) {
        setApplyProblem(response.error.message);
      } else if (response.data.applied.includes(view.issueKey)) {
        setConfirmApply(false);
        onRefresh();
      } else {
        const code = response.data.failed[0]?.code;
        setApplyProblem(
          code === 'STALE_PREVIEW'
            ? 'Priority changed since you looked. Refresh, then review the new suggestion.'
            : code === 'FORBIDDEN' || code === 'NOT_FOUND'
              ? "You don't have access to change this issue."
              : 'Stakes could not apply the priority. Try again.',
        );
      }
    } catch {
      setApplyProblem('Stakes could not reach its backend. Try again.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
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
            <Header
              view={view}
              refreshing={refreshing}
              onApply={() => {
                setApplyProblem(null);
                setConfirmApply(true);
              }}
            />
            {empty ? (
              <NoEvidence issueKey={view.issueKey} />
            ) : (
              <>
                <WhyItMatters view={view} />
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
      <ModalTransition>
        {confirmApply && view.suggestedPriority !== null && (
          <Modal onClose={() => !applying && setConfirmApply(false)}>
            <ModalHeader>
              <ModalTitle>Apply suggested priority?</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Stack space="space.100">
                <Text>
                  <Strong>{`${view.issueKey}: ${view.currentPriority} → ${view.suggestedPriority}`}</Strong>
                </Text>
                <Text>
                  Stakes will change the priority and add an audit comment with the score, evidence
                  and your approval.
                </Text>
                {applyProblem && (
                  <SectionMessage appearance="error">
                    <Text>{applyProblem}</Text>
                  </SectionMessage>
                )}
              </Stack>
            </ModalBody>
            <ModalFooter>
              <Button
                appearance="subtle"
                onClick={() => setConfirmApply(false)}
                isDisabled={applying}
              >
                Cancel
              </Button>
              <Button appearance="primary" onClick={apply} isDisabled={applying}>
                {applying ? 'Applying…' : 'Apply priority'}
              </Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </>
  );
};

async function call<T>(name: string, payload: Record<string, unknown>): Promise<Result<T>> {
  try {
    return unwrap(await invoke<Result<T>>(name, payload));
  } catch {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Stakes could not reach its backend. Try again.' },
    };
  }
}

const visibilityOption = (v: ReplyVisibility) => ({ value: v, label: VISIBILITY_LABEL[v] });
const toneOption = (t: 'brief' | 'detailed') => ({
  value: t,
  label: t === 'brief' ? 'Brief' : 'Detailed',
});

// Nothing is posted until Send is confirmed; drafting only fills the text boxes.
const ShipNoticeTab = ({ issueKey, onFinished }: { issueKey: string; onFinished: () => void }) => {
  const [notice, setNotice] = useState<Result<ShipNoticeView | null> | null>(null);
  const [internal, setInternal] = useState('');
  const [replies, setReplies] = useState<ReplyDraft[]>([]);
  const [tone, setTone] = useState<'brief' | 'detailed'>('brief');
  const [drafting, setDrafting] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<SendShipNoticeResult | null>(null);

  const load = useCallback(async () => {
    setNotice(null);
    setProblem(null);
    const r = await call<ShipNoticeView | null>('getShipNotice', { issueKey });
    setNotice(r);
    if (r.ok && r.data) {
      setInternal(r.data.internalDraft.text);
      setReplies(
        r.data.requests.map((q) => ({ requestKey: q.key, text: '', visibility: 'public-draft' })),
      );
    }
  }, [issueKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const setReply = (key: string, change: Partial<ReplyDraft>) =>
    setReplies((all) => all.map((r) => (r.requestKey === key ? { ...r, ...change } : r)));

  const draft = async (requestKey: string) => {
    setDrafting(requestKey);
    setProblem(null);
    const r = await call<CustomerDraft>('draftCustomerUpdate', { issueKey, requestKey, tone });
    if (r.ok) setReply(requestKey, { text: r.data.text });
    else setProblem(r.error.message);
    setDrafting(null);
  };

  const send = async () => {
    setBusy(true);
    setProblem(null);
    const r = await call<SendShipNoticeResult>('sendShipNotice', {
      issueKey,
      internalNote: internal,
      customerReplies: replies.filter((x) => x.text.trim() !== ''),
      confirmed: true,
    });
    setBusy(false);
    setConfirming(false);
    if (r.ok) setSent(r.data);
    else setProblem(r.error.message);
  };

  const dismiss = async () => {
    setBusy(true);
    const r = await call<{ ok: true }>('dismissShipNotice', { issueKey });
    setBusy(false);
    if (r.ok) onFinished();
    else setProblem(r.error.message);
  };

  if (!notice) return <Spinner label="Loading the ship notice" />;
  if (!notice.ok) {
    return (
      <Stack space="space.100">
        <SectionMessage appearance="warning">
          <Text>{notice.error.message}</Text>
          <Text>Try again, or return to the Stakes tab and select Refresh.</Text>
        </SectionMessage>
        <Inline space="space.100">
          <Button onClick={() => void load()}>Try again</Button>
          <Button appearance="subtle" onClick={onFinished}>
            Back to Stakes
          </Button>
        </Inline>
      </Stack>
    );
  }
  const view = notice.data;
  if (!view) {
    return (
      <EmptyState
        header="No ship notice is waiting for this issue"
        description="It may already have been sent or dismissed. Return to Stakes to see the latest issue state."
      />
    );
  }

  if (sent) {
    const failed = sent.replies.some((r) => !r.ok) || !sent.propertyWritten;
    return (
      <Stack space="space.150">
        <SectionMessage appearance={failed ? 'warning' : 'success'} title="Ship notice sent">
          <Stack space="space.050">
            {resultLines(issueKey, sent).map((line) => (
              <Text key={line}>{line}</Text>
            ))}
          </Stack>
        </SectionMessage>
        <Inline>
          <Button onClick={onFinished}>Done</Button>
        </Inline>
      </Stack>
    );
  }

  return (
    <>
      <Stack space="space.200">
        <Text>
          {`${issueKey} ${view.trigger === 'release' && view.versionName ? `shipped in ${view.versionName}` : 'moved to Done'}. Review what Stakes will post, then send it.`}
        </Text>
        <Stack space="space.100">
          <Heading size="small">{`Recipients (${view.recipients.length})`}</Heading>
          {view.recipients.length === 0 && (
            <Text size="small">
              No owners or agents are identified. The Jira comment will still be posted; notify
              stakeholders manually or link customers and support requests before the next notice.
            </Text>
          )}
          {view.recipients.map((r) => (
            <Inline key={r.accountId} space="space.100" alignBlock="center">
              <User accountId={r.accountId} />
              <Text size="small">{recipientText(r)}</Text>
            </Inline>
          ))}
        </Stack>
        <Stack space="space.050">
          <Heading size="small">Internal note</Heading>
          <Text size="small">
            {`Posted as one comment on ${issueKey} that mentions the owners.${view.internalDraft.generated ? ' Drafted by AI from the evidence; edit freely.' : ''}`}
          </Text>
          <TextArea
            id="internal-note"
            value={internal}
            onChange={(e) => setInternal(String(e.target.value ?? ''))}
          />
        </Stack>
        {replies.length > 0 && (
          <Stack space="space.150">
            <Inline spread="space-between" alignBlock="center">
              <Heading size="small">Support requests</Heading>
              <Select
                id="tone"
                options={[toneOption('brief'), toneOption('detailed')]}
                value={toneOption(tone)}
                onChange={(o: { value: 'brief' | 'detailed' }) => setTone(o.value)}
              />
            </Inline>
            {replies.map((reply) => {
              const req = view.requests.find((q) => q.key === reply.requestKey)!;
              return (
                <Stack key={reply.requestKey} space="space.075">
                  <Inline space="space.100" alignBlock="center" spread="space-between">
                    <Link href={req.url} openNewTab>
                      {`${req.key} · ${req.summary}`}
                    </Link>
                    <Button
                      appearance="subtle"
                      onClick={() => draft(reply.requestKey)}
                      isDisabled={drafting !== null}
                    >
                      {drafting === reply.requestKey ? 'Drafting…' : 'Draft customer update'}
                    </Button>
                  </Inline>
                  <TextArea
                    id={`reply-${reply.requestKey}`}
                    value={reply.text}
                    placeholder="Leave empty to skip this request"
                    onChange={(e) =>
                      setReply(reply.requestKey, { text: String(e.target.value ?? '') })
                    }
                  />
                  <Select
                    id={`visibility-${reply.requestKey}`}
                    options={[visibilityOption('public-draft'), visibilityOption('internal')]}
                    value={visibilityOption(reply.visibility)}
                    onChange={(o: { value: ReplyVisibility }) =>
                      setReply(reply.requestKey, { visibility: o.value })
                    }
                  />
                </Stack>
              );
            })}
          </Stack>
        )}
        {view.hiddenRequests > 0 && (
          <Text size="small">{`${view.hiddenRequests} linked requests are hidden because you can't open them.`}</Text>
        )}
        {problem && (
          <SectionMessage appearance="error">
            <Text>{problem}</Text>
          </SectionMessage>
        )}
        <Inline space="space.100">
          <Button
            appearance="primary"
            onClick={() => setConfirming(true)}
            isDisabled={busy || internal.trim() === ''}
          >
            Send
          </Button>
          <Button appearance="subtle" onClick={dismiss} isDisabled={busy}>
            Dismiss
          </Button>
        </Inline>
      </Stack>
      <ModalTransition>
        {confirming && (
          <Modal onClose={() => !busy && setConfirming(false)}>
            <ModalHeader>
              <ModalTitle>Send the ship notice?</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Stack space="space.100">
                <Text>Stakes will post, as you:</Text>
                {confirmationLines(issueKey, ownerCount(view), replies).map((line) => (
                  <Text key={line}>{`• ${line}`}</Text>
                ))}
              </Stack>
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setConfirming(false)} isDisabled={busy}>
                Cancel
              </Button>
              <Button appearance="primary" onClick={send} isDisabled={busy}>
                {busy ? 'Sending…' : 'Send'}
              </Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </>
  );
};

const App = () => {
  const context = useProductContext();
  const issueKey = (context?.extension as { issue?: { key?: string } } | undefined)?.issue?.key;
  const [result, setResult] = useState<Result<PanelView> | null>(null);
  const [history, setHistory] = useState<ScoreHistory | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState(0);
  const [shipBanner, setShipBanner] = useState<string | null>(null);

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

  const pending = result?.ok === true && result.data.hasPendingShipNotice;
  useEffect(() => {
    if (!pending || !issueKey) return;
    void call<ShipNoticeView | null>('getShipNotice', { issueKey }).then((r) =>
      setShipBanner(r.ok && r.data ? bannerText(r.data) : null),
    );
  }, [pending, issueKey]);

  if (!issueKey) {
    return (
      <SectionMessage appearance="information" title="Open Stakes on a Jira issue">
        <Text>The issue panel needs an issue key. Open a Jira issue to see its Stakes Score.</Text>
      </SectionMessage>
    );
  }
  if (!result) return <Loading />;
  if (!result.ok) {
    const forbidden = result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND';
    return (
      <Stack space="space.100">
        <SectionMessage appearance={forbidden ? 'information' : 'warning'}>
          <Text>
            {forbidden
              ? "You don't have access to this issue. Open an issue you can view, or ask a Jira admin for access."
              : result.error.message}
          </Text>
          {!forbidden && <Text>Select Try again to reload the score and its evidence.</Text>}
        </SectionMessage>
        {!forbidden && <Button onClick={() => load(true)}>Try again</Button>}
      </Stack>
    );
  }
  const stakes = (
    <Stakes
      view={result.data}
      history={history}
      refreshing={refreshing}
      onRefresh={() => load(true)}
    />
  );
  if (!result.data.hasPendingShipNotice || !issueKey) return <Box>{stakes}</Box>;
  return (
    <Stack space="space.150">
      {tab === 0 && (
        <SectionMessage appearance="success">
          <Inline spread="space-between" alignBlock="center">
            <Text>{shipBanner ?? 'This fix shipped. People are waiting to hear about it.'}</Text>
            <Button onClick={() => setTab(1)}>Review</Button>
          </Inline>
        </SectionMessage>
      )}
      <Tabs id="stakes-panel" selected={tab} onChange={(i: number) => setTab(i)}>
        <TabList>
          <Tab>Stakes</Tab>
          <Tab>Ship notice</Tab>
        </TabList>
        <TabPanel>{stakes}</TabPanel>
        <TabPanel>
          <ShipNoticeTab
            issueKey={issueKey}
            onFinished={() => {
              setTab(0);
              load(false);
            }}
          />
        </TabPanel>
      </Tabs>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
