import Button from '@atlaskit/button';
import { token } from '@atlaskit/tokens';
import type { BacklogRow } from '@stakes/contracts';
import Dialog from './Dialog';

interface PriorityConfirmationProps {
  changes: BacklogRow[];
  skipped: BacklogRow[];
  applying: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function PriorityConfirmation({
  changes,
  skipped,
  applying,
  error,
  onCancel,
  onConfirm,
}: PriorityConfirmationProps) {
  return (
    <Dialog labelledBy="bulk-title" onClose={onCancel} closeDisabled={applying}>
      <h2 id="bulk-title" style={{ margin: 0, padding: '24px 24px 0', fontSize: 20 }}>
        Change the priority of {changes.length} {changes.length === 1 ? 'issue' : 'issues'}?
      </h2>
      <div style={{ display: 'grid', gap: 12, padding: '16px 24px' }}>
        <div style={{ overflowX: 'auto', border: `1px solid ${token('color.border')}` }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th scope="col" style={{ padding: 8, textAlign: 'left' }}>
                  Issue
                </th>
                <th scope="col" style={{ padding: 8, textAlign: 'left' }}>
                  Priority change
                </th>
                <th scope="col" style={{ padding: 8, textAlign: 'right' }}>
                  Score
                </th>
              </tr>
            </thead>
            <tbody>
              {changes.map((row) => (
                <tr key={row.issueKey} style={{ borderTop: `1px solid ${token('color.border')}` }}>
                  <td style={{ padding: 8 }}>
                    <strong>{row.issueKey}</strong>{' '}
                    <span style={{ color: token('color.text.subtle') }}>{row.summary}</span>
                  </td>
                  <td style={{ padding: 8, whiteSpace: 'nowrap' }}>
                    {row.currentPriority} → <strong>{row.suggestedPriority}</strong>
                  </td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{row.score ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {skipped.length > 0 && (
          <small style={{ color: token('color.text.subtle') }}>
            {skipped.map((row) => row.issueKey).join(', ')} already match their suggested priorities
            and stay as they are.
          </small>
        )}
        <small style={{ color: token('color.text.subtle') }}>
          Stakes adds an audit comment to each changed issue. If a priority changed since this page
          loaded, that issue is skipped.
        </small>
        {error && <p role="alert">{error}</p>}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '0 24px 24px',
        }}
      >
        <Button appearance="subtle" onClick={onCancel} isDisabled={applying}>
          Cancel
        </Button>
        <Button
          appearance="primary"
          onClick={onConfirm}
          isDisabled={applying || changes.length === 0}
        >
          {applying
            ? 'Applying…'
            : `Change ${changes.length} ${changes.length === 1 ? 'priority' : 'priorities'}`}
        </Button>
      </div>
    </Dialog>
  );
}
