import Lozenge from '@atlaskit/lozenge';
import { token } from '@atlaskit/tokens';
import { formatUsd, type BacklogRow, type Badge, type IssueKey } from '@stakes/contracts';
import type { BacklogSort, BacklogSortKey } from '../lib/filter';

const BADGE_LABEL: Record<Badge, string> = {
  'silent-fire': 'Silent fire',
  phantom: 'Phantom priority',
  'stakes-jump': 'Stakes jump',
};

const BADGE_APPEARANCE: Record<Badge, 'moved' | 'default' | 'inprogress'> = {
  'silent-fire': 'moved',
  phantom: 'default',
  'stakes-jump': 'inprogress',
};

const COLUMNS: Array<{ key: BacklogSortKey | 'priority'; label: string; numeric?: boolean }> = [
  { key: 'issueKey', label: 'Issue' },
  { key: 'score', label: 'Stakes Score' },
  { key: 'priority', label: 'Priority' },
  { key: 'revenueUsd', label: 'Revenue at risk', numeric: true },
  { key: 'customers', label: 'Customers', numeric: true },
  { key: 'tickets', label: 'Tickets', numeric: true },
];

interface BacklogTableProps {
  rows: BacklogRow[];
  ranks: Map<IssueKey, number>;
  selected: Set<IssueKey>;
  sort: BacklogSort;
  onSort: (sort: BacklogSort) => void;
  onToggle: (issueKey: IssueKey) => void;
  onToggleAll: () => void;
  onOpen: (issueKey: IssueKey) => void;
}

export default function BacklogTable({
  rows,
  ranks,
  selected,
  sort,
  onSort,
  onToggle,
  onToggleAll,
  onOpen,
}: BacklogTableProps) {
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.issueKey));
  const someSelected = rows.some((row) => selected.has(row.issueKey));

  const sortBy = (key: BacklogSortKey) => {
    onSort({
      key,
      direction:
        sort.key === key
          ? sort.direction === 'ascending'
            ? 'descending'
            : 'ascending'
          : key === 'issueKey'
            ? 'ascending'
            : 'descending',
    });
  };

  return (
    <div
      style={{
        overflowX: 'auto',
        border: `1px solid ${token('color.border')}`,
        borderRadius: 8,
        background: token('elevation.surface'),
      }}
    >
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1120 }}>
        <caption
          style={{
            position: 'absolute',
            width: 1,
            height: 1,
            overflow: 'hidden',
            clip: 'rect(0 0 0 0)',
          }}
        >
          Open issues ranked by Stakes Score
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ padding: 12, width: 72, textAlign: 'left' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  aria-label="Select all visible issues"
                  checked={allSelected}
                  ref={(input) => {
                    if (input) input.indeterminate = someSelected && !allSelected;
                  }}
                  onChange={onToggleAll}
                />
                #
              </span>
            </th>
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  column.key !== 'priority' && sort.key === column.key ? sort.direction : 'none'
                }
                style={{
                  padding: 12,
                  textAlign: column.numeric ? 'right' : 'left',
                  whiteSpace: 'nowrap',
                  color: token('color.text.subtle'),
                  fontSize: 12,
                }}
              >
                {column.key === 'priority' ? (
                  column.label
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (column.key !== 'priority') sortBy(column.key);
                    }}
                    style={{
                      border: 0,
                      padding: 0,
                      color: 'inherit',
                      background: 'transparent',
                      font: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    {column.label}
                    {sort.key === column.key && (
                      <span aria-hidden="true">{sort.direction === 'ascending' ? ' ↑' : ' ↓'}</span>
                    )}
                  </button>
                )}
              </th>
            ))}
            <th
              scope="col"
              style={{
                padding: 12,
                textAlign: 'left',
                color: token('color.text.subtle'),
                fontSize: 12,
              }}
            >
              Flag
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = selected.has(row.issueKey);
            return (
              <tr
                key={row.issueKey}
                style={{
                  background: isSelected ? token('color.background.selected') : undefined,
                  borderTop: `1px solid ${token('color.border')}`,
                }}
              >
                <td style={{ padding: 12 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.issueKey}`}
                      checked={isSelected}
                      onChange={() => onToggle(row.issueKey)}
                    />
                    <span>{ranks.get(row.issueKey)}</span>
                  </span>
                </td>
                <td style={{ padding: 12, maxWidth: 360 }}>
                  <a
                    href={row.issueUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: token('color.link'), fontFamily: token('font.family.code') }}
                  >
                    {row.issueKey}
                  </a>
                  <div>
                    <button
                      type="button"
                      aria-label={`Open Stakes details for ${row.issueKey}`}
                      onClick={() => onOpen(row.issueKey)}
                      style={{
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        border: 0,
                        padding: 0,
                        textAlign: 'left',
                        color: token('color.text'),
                        background: 'transparent',
                        font: 'inherit',
                        cursor: 'pointer',
                      }}
                    >
                      {row.summary}
                    </button>
                  </div>
                </td>
                <td style={{ padding: 12 }}>
                  {row.score === null ? (
                    'Not scored'
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong>{row.score}</strong>
                      <span
                        role="meter"
                        aria-label={`Stakes Score ${row.score} out of 100`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={row.score}
                        style={{
                          width: 80,
                          height: 4,
                          overflow: 'hidden',
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
                          }}
                        />
                      </span>
                    </div>
                  )}
                </td>
                <td style={{ padding: 12 }}>
                  {row.currentPriority}
                  {row.suggestedPriority && (
                    <div style={{ color: token('color.text.subtle'), fontSize: 12 }}>
                      Suggested: {row.suggestedPriority}
                    </div>
                  )}
                </td>
                <td style={{ padding: 12, textAlign: 'right' }}>{formatUsd(row.revenueUsd)}</td>
                <td style={{ padding: 12, textAlign: 'right' }}>{row.customers}</td>
                <td style={{ padding: 12, textAlign: 'right' }}>{row.tickets}</td>
                <td style={{ padding: 12 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    {row.badges.map((badge) => (
                      <Lozenge key={badge} appearance={BADGE_APPEARANCE[badge]} isBold>
                        {BADGE_LABEL[badge]}
                      </Lozenge>
                    ))}
                    {row.trend !== 'flat' && (
                      <span
                        role="img"
                        aria-label={`Score trend ${row.trend}`}
                        style={{ color: token('color.text.subtle') }}
                      >
                        {row.trend === 'up' ? '↑' : '↓'}
                      </span>
                    )}
                    {row.badges.length === 0 && row.trend === 'flat' && '—'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
