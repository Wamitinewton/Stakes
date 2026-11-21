import { useEffect, useState } from 'react';
import Button from '@atlaskit/button';
import Lozenge from '@atlaskit/lozenge';
import ProgressBar from '@atlaskit/progress-bar';
import { token } from '@atlaskit/tokens';
import {
  formatDate,
  formatUsd,
  type EvidenceItem,
  type IssueKey,
  type PanelView,
} from '@stakes/contracts';
import Dialog from './Dialog';
import { call } from '../lib/resolver';

const CONFIDENCE = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' };
const BADGE_LABEL = {
  'silent-fire': 'Silent fire',
  phantom: 'Phantom priority',
  'stakes-jump': 'Stakes jump',
} as const;

function evidenceValue(item: EvidenceItem): string {
  if (item.value === null) return '';
  if (item.unit === 'USD') return formatUsd(item.value);
  if (item.type === 'customer') return `${item.value} pts`;
  return `${item.value}${item.unit ? ` ${item.unit}` : ''}`;
}

interface RowDrawerProps {
  issueKey: IssueKey;
  summary: string;
  onClose: () => void;
  onApply: (issueKey: IssueKey) => void;
}

export default function RowDrawer({ issueKey, summary, onClose, onApply }: RowDrawerProps) {
  const [panel, setPanel] = useState<PanelView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setPanel(null);
    setError(null);
    call<PanelView>('getStakes', { issueKey })
      .then((result) => {
        if (active) setPanel(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Unable to load Stakes');
      });
    return () => {
      active = false;
    };
  }, [issueKey, attempt]);

  return (
    <Dialog labelledBy="drawer-title" onClose={onClose} drawer>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          padding: '20px 24px 12px',
          borderBottom: `1px solid ${token('color.border')}`,
        }}
      >
        <div>
          <div style={{ fontFamily: token('font.family.code') }}>{issueKey}</div>
          <h2 id="drawer-title" style={{ margin: '4px 0 0', fontSize: 20 }}>
            {summary}
          </h2>
        </div>
        <Button appearance="subtle" onClick={onClose} aria-label="Close Stakes details">
          Close
        </Button>
      </div>
      <div style={{ display: 'grid', gap: 20, padding: '20px 24px' }}>
        {error && (
          <div role="alert">
            <p>{error}</p>
            <p>Check your issue access and connection, then try again.</p>
            <Button onClick={() => setAttempt((current) => current + 1)}>Try again</Button>
          </div>
        )}
        {!panel && !error && <p role="status">Loading Stakes details…</p>}
        {panel && (
          <>
            <section style={{ display: 'grid', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: 24 }}>{panel.score} / 100</strong>
                <Lozenge appearance={panel.confidence === 'high' ? 'success' : 'default'}>
                  {CONFIDENCE[panel.confidence]}
                </Lozenge>
                {panel.badges.map((badge) => (
                  <Lozenge key={badge} isBold>
                    {BADGE_LABEL[badge]}
                  </Lozenge>
                ))}
              </div>
              <ProgressBar
                value={panel.score / 100}
                ariaLabel={`Stakes Score ${panel.score} out of 100`}
              />
              <span>
                {panel.suggestedPriority
                  ? `Suggested: ${panel.suggestedPriority} (now ${panel.currentPriority})`
                  : `Priority: ${panel.currentPriority}`}
              </span>
              {panel.suggestedPriority &&
                panel.suggestedPriority.toLowerCase() !== panel.currentPriority.toLowerCase() && (
                  <div>
                    <Button appearance="primary" onClick={() => onApply(issueKey)}>
                      Apply suggested priority
                    </Button>
                  </div>
                )}
            </section>

            {panel.confidence === 'low' && panel.evidence.length > 0 && (
              <p role="status">
                This score is based on limited evidence. Link more customers, deals, requests or
                goals, then close and reopen these details.
              </p>
            )}
            {panel.degraded.length > 0 && (
              <p role="status">
                Some evidence sources are unavailable; this score may be incomplete. Close and
                reopen these details to retry.
              </p>
            )}
            {panel.hiddenItems > 0 && (
              <p role="status">Some linked items are not visible to you and are not counted.</p>
            )}

            <section>
              <h3>Why it matters</h3>
              <p>{panel.summary.text}</p>
              <small style={{ color: token('color.text.subtle') }}>
                Summary from {panel.summary.sourceCount} evidence items
              </small>
            </section>

            <section>
              <h3>Signals</h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 8,
                }}
              >
                {panel.tiles.map((tile) => (
                  <div
                    key={tile.signal}
                    style={{
                      display: 'grid',
                      gap: 4,
                      padding: 12,
                      border: `1px solid ${token('color.border')}`,
                      borderRadius: 4,
                    }}
                  >
                    <span style={{ color: token('color.text.subtle') }}>{tile.label}</span>
                    <strong>{tile.rawDisplay}</strong>
                    <span>{tile.detail}</span>
                    <strong>+{Math.round(tile.points)} pts</strong>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3>Customers</h3>
              {panel.customers.length === 0 ? (
                <p>No linked customers.</p>
              ) : (
                <ul style={{ display: 'grid', gap: 8, margin: 0, paddingLeft: 20 }}>
                  {panel.customers.map((customer) => (
                    <li key={customer.id}>
                      <strong>{customer.name}</strong> · {customer.tier}
                      <div>
                        {customer.dealValueUsd > 0
                          ? `${formatUsd(customer.dealValueUsd)} in deals`
                          : 'No open deal value'}
                        {customer.date ? ` · ${formatDate(customer.date)}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h3>Evidence ({panel.evidence.length})</h3>
              {panel.evidence.length === 0 ? (
                <p>
                  No customers, deals or tickets are linked yet. Link evidence in Jira or ask a Jira
                  admin to import it in Stakes settings, then close and reopen these details.
                </p>
              ) : (
                <ul style={{ display: 'grid', gap: 12, margin: 0, paddingLeft: 20 }}>
                  {panel.evidence.map((item) => (
                    <li key={item.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: token('color.link') }}
                        >
                          {item.title}
                        </a>
                        <span>{evidenceValue(item)}</span>
                      </div>
                      <small style={{ color: token('color.text.subtle') }}>{item.detail}</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <small style={{ color: token('color.text.subtle') }}>
              Updated {formatDate(panel.computedAt)}
            </small>
          </>
        )}
      </div>
    </Dialog>
  );
}
