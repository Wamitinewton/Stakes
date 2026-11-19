import { useCallback, useEffect, useState } from 'react';
import Button from '@atlaskit/button';
import { token } from '@atlaskit/tokens';
import {
  formatUsd,
  type ApplySprintPlanResult,
  type ProjectKey,
  type SprintOptions,
  type SprintPlan as SprintPlanView,
} from '@stakes/contracts';
import Dialog from './components/Dialog';
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

export default function SprintPlan({ projectKey }: { projectKey: ProjectKey }) {
  const [options, setOptions] = useState<SprintOptions | null>(null);
  const [boardId, setBoardId] = useState<number | null>(null);
  const [sprintId, setSprintId] = useState<number | null>(null);
  const [plan, setPlan] = useState<SprintPlanView | null>(null);
  const [capacity, setCapacity] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<ApplySprintPlanResult | null>(null);

  const board = options?.boards.find((item) => item.id === boardId) ?? null;
  const sprint = board?.futureSprints.find((item) => item.id === sprintId) ?? null;

  const loadPlan = useCallback(
    async (board: number, sprint: number, requestedCapacity?: number) => {
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        const next = await call<SprintPlanView>('planSprint', {
          boardId: board,
          sprintId: sprint,
          ...(requestedCapacity === undefined ? {} : { capacity: requestedCapacity }),
        });
        setPlan(next);
        setCapacity(next.capacity === null ? '' : String(next.capacity));
      } catch (cause) {
        setPlan(null);
        setError(cause instanceof Error ? cause.message : 'Unable to plan this sprint');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void call<SprintOptions>('sprintOptions', { projectKey })
      .then(async (next) => {
        setOptions(next);
        const firstBoard = next.boards[0] ?? null;
        const firstSprint = firstBoard?.futureSprints[0] ?? null;
        setBoardId(firstBoard?.id ?? null);
        setSprintId(firstSprint?.id ?? null);
        if (firstBoard && firstSprint) await loadPlan(firstBoard.id, firstSprint.id);
        else setLoading(false);
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'Unable to load future sprints');
        setLoading(false);
      });
  }, [loadPlan, projectKey]);

  const numericCapacity = capacity.trim() === '' ? null : Number(capacity);
  const validCapacity =
    numericCapacity !== null && Number.isFinite(numericCapacity) && numericCapacity >= 0;
  const moving = plan?.issues.filter((issue) => !issue.pinned) ?? [];

  const apply = async () => {
    if (!plan || moving.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      const applied = await call<ApplySprintPlanResult>('applySprintPlan', {
        sprintId: plan.sprintId,
        issueKeys: moving.map((issue) => issue.issueKey),
        confirmed: true,
      });
      setResult(applied);
      setConfirming(false);
      await loadPlan(plan.boardId, plan.sprintId, numericCapacity ?? undefined);
      setResult(applied);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to apply the sprint plan');
      setConfirming(false);
    } finally {
      setApplying(false);
    }
  };

  return (
    <section style={{ display: 'grid', gap: 16, paddingTop: 16 }} aria-label="Sprint planning">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12 }}>
        <label style={{ display: 'grid', gap: 4 }}>
          Board
          <select
            aria-label="Sprint board"
            value={boardId ?? ''}
            disabled={loading || !options}
            onChange={(event) => {
              const nextBoard = options?.boards.find(
                (item) => item.id === Number(event.target.value),
              );
              const nextSprint = nextBoard?.futureSprints[0] ?? null;
              setBoardId(nextBoard?.id ?? null);
              setSprintId(nextSprint?.id ?? null);
              setPlan(null);
              setResult(null);
              if (nextBoard && nextSprint) void loadPlan(nextBoard.id, nextSprint.id);
            }}
            style={inputStyle}
          >
            {options?.boards.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          Future sprint
          <select
            aria-label="Future sprint"
            value={sprintId ?? ''}
            disabled={loading || !board || board.futureSprints.length === 0}
            onChange={(event) => {
              const next = Number(event.target.value);
              setSprintId(next);
              if (boardId) void loadPlan(boardId, next);
            }}
            style={inputStyle}
          >
            {board?.futureSprints.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4 }}>
          Capacity (story points)
          <input
            aria-label="Sprint capacity"
            type="number"
            min="0"
            step="0.5"
            value={capacity}
            onChange={(event) => setCapacity(event.target.value)}
            style={{ ...inputStyle, width: 150 }}
          />
        </label>
        <Button
          isDisabled={loading || !boardId || !sprintId || !validCapacity}
          onClick={() =>
            boardId &&
            sprintId &&
            validCapacity &&
            void loadPlan(boardId, sprintId, numericCapacity)
          }
        >
          Update plan
        </Button>
      </div>

      {loading && <p role="status">Planning sprint scope…</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && options?.boards.length === 0 && (
        <p>No Jira Software boards are available for {projectKey}.</p>
      )}
      {!loading && !error && board && board.futureSprints.length === 0 && (
        <p>Create a future sprint on {board.name} before planning its scope.</p>
      )}
      {plan?.defaultCapacity === null && (
        <p>No closed sprints have completed points yet. Enter a capacity to build this plan.</p>
      )}
      {result && (
        <p role="status">
          Moved {result.applied.length} {result.applied.length === 1 ? 'issue' : 'issues'} to{' '}
          {sprint?.name ?? 'the sprint'}. {result.failed.length} failed.
        </p>
      )}

      {plan && (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
              border: `1px solid ${token('color.border')}`,
              borderRadius: 8,
            }}
          >
            <div style={{ padding: 16 }}>
              <strong>{plan.pointsUsed}</strong> / {plan.capacity ?? '—'} points used
            </div>
            <div style={{ padding: 16 }}>
              <strong>{plan.scoreCovered}</strong> score covered
            </div>
            <div style={{ padding: 16 }}>
              <strong>{formatUsd(plan.revenueUsd)}</strong> revenue covered
            </div>
          </div>
          {plan.needsEstimate.length > 0 && (
            <p role="status">
              Needs an estimate: {plan.needsEstimate.join(', ')}. These issues are not included in
              the proposed scope.
            </p>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  {['Issue', 'Score', 'Revenue', 'Points', 'Scope'].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      style={{
                        padding: 8,
                        textAlign: 'left',
                        borderBottom: `1px solid ${token('color.border')}`,
                      }}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plan.issues.map((issue) => (
                  <tr
                    key={issue.issueKey}
                    style={{ borderBottom: `1px solid ${token('color.border')}` }}
                  >
                    <td style={{ padding: 8 }}>
                      <strong>{issue.issueKey}</strong> {issue.summary}
                    </td>
                    <td style={{ padding: 8 }}>{issue.score}</td>
                    <td style={{ padding: 8 }}>{formatUsd(issue.revenueUsd)}</td>
                    <td style={{ padding: 8 }}>{issue.points ?? '—'}</td>
                    <td style={{ padding: 8 }}>
                      {issue.pinned ? 'Already in sprint' : 'Proposed'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {plan.issues.length === 0 && <p>No estimated issues fit this capacity.</p>}
          </div>
          <div>
            <Button
              appearance="primary"
              isDisabled={loading || moving.length === 0 || !validCapacity}
              onClick={() => setConfirming(true)}
            >
              Apply sprint plan
            </Button>
          </div>
        </>
      )}

      {confirming && plan && (
        <Dialog
          labelledBy="sprint-confirm-title"
          onClose={() => setConfirming(false)}
          closeDisabled={applying}
        >
          <h2 id="sprint-confirm-title" style={{ margin: 0, padding: '24px 24px 0', fontSize: 20 }}>
            Move {moving.length} {moving.length === 1 ? 'issue' : 'issues'} to {plan.sprintName}?
          </h2>
          <div style={{ display: 'grid', gap: 12, padding: '16px 24px' }}>
            <ul>
              {moving.map((issue) => (
                <li key={issue.issueKey}>
                  <strong>{issue.issueKey}</strong> {issue.summary} — {issue.points} points
                </li>
              ))}
            </ul>
            <small style={{ color: token('color.text.subtle') }}>
              Stakes moves these issues as you and records one audit row per move. Issues already in
              the sprint stay unchanged.
            </small>
            {error && <p role="alert">{error}</p>}
          </div>
          <div
            style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '0 24px 24px' }}
          >
            <Button appearance="subtle" onClick={() => setConfirming(false)} isDisabled={applying}>
              Cancel
            </Button>
            <Button appearance="primary" onClick={() => void apply()} isDisabled={applying}>
              {applying
                ? 'Moving…'
                : `Move ${moving.length} ${moving.length === 1 ? 'issue' : 'issues'}`}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
