import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  DynamicTable,
  Heading,
  Inline,
  Label,
  Link,
  Lozenge,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Text,
  Textfield,
  useConfig,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { formatUsd, type MacroMode, type MacroTable } from '@stakes/contracts';
import { BADGE_APPEARANCE, BADGE_LABEL } from './format.js';

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

interface MacroConfig {
  mode: MacroMode;
  projectKey: string;
  version: string;
  customer: string;
}

const modes = [
  { value: 'project', label: 'Project' },
  { value: 'version', label: 'Fix version' },
  { value: 'customer', label: 'Customer' },
];

const Config = () => (
  <>
    <Label labelFor="macro-mode">Mode</Label>
    <Select id="macro-mode" name="mode" options={modes} defaultValue={modes[0]} isRequired />
    <Label labelFor="macro-project">Project key (project and fix version modes)</Label>
    <Textfield id="macro-project" name="projectKey" placeholder="PAY" />
    <Label labelFor="macro-version">Fix version name or ID (fix version mode)</Label>
    <Textfield id="macro-version" name="version" placeholder="2026.12" />
    <Label labelFor="macro-customer">Customer search (customer mode)</Label>
    <Textfield id="macro-customer" name="customer" placeholder="Customer name or ID" />
  </>
);

function unwrap<T extends object>(response: T | { body: T }): T {
  return 'body' in response ? response.body : response;
}

const App = () => {
  const config = useConfig() as Partial<MacroConfig> | undefined;
  const mode = config?.mode;
  const projectKey = config?.projectKey?.trim().toUpperCase() ?? '';
  const key =
    mode === 'project'
      ? projectKey
      : mode === 'version'
        ? projectKey && config?.version?.trim()
          ? `${projectKey}:${config.version.trim()}`
          : ''
        : mode === 'customer'
          ? (config?.customer?.trim() ?? '')
          : '';
  const [result, setResult] = useState<Result<MacroTable> | null>(null);

  useEffect(() => {
    if (!mode || !key) return;
    let active = true;
    setResult(null);
    invoke<Result<MacroTable>>('macroTable', { mode, key })
      .then((response) => {
        if (active) setResult(unwrap(response));
      })
      .catch(() => {
        if (active) {
          setResult({
            ok: false,
            error: { code: 'INTERNAL', message: 'Stakes could not reach its backend. Try again.' },
          });
        }
      });
    return () => {
      active = false;
    };
  }, [mode, key]);

  if (!mode || !key) {
    return (
      <SectionMessage appearance="warning" title="Configure the Stakes macro">
        <Text>Select a mode and enter its project, fix version or customer search.</Text>
      </SectionMessage>
    );
  }
  if (!result) return <Spinner label="Loading the ten highest-stakes issues" />;
  if (!result.ok) {
    return (
      <SectionMessage appearance="warning">
        <Text>{result.error.message}</Text>
      </SectionMessage>
    );
  }

  const { rows, backlogUrl } = result.data;
  return (
    <Stack space="space.150">
      <Heading size="small">Highest-stakes issues</Heading>
      {rows.length === 0 ? (
        <Text>No open issues found.</Text>
      ) : (
        <DynamicTable
          head={{
            cells: [
              { key: 'issue', content: 'Issue' },
              { key: 'score', content: 'Score' },
              { key: 'priority', content: 'Priority' },
              { key: 'badge', content: 'Badge' },
              { key: 'revenue', content: 'Revenue at risk' },
            ],
          }}
          rows={rows.map((row) => ({
            key: row.issueKey,
            cells: [
              {
                key: 'issue',
                content: (
                  <Link href={row.issueUrl} openNewTab>{`${row.issueKey} · ${row.summary}`}</Link>
                ),
              },
              { key: 'score', content: row.score ?? '—' },
              { key: 'priority', content: row.priority || '—' },
              {
                key: 'badge',
                content:
                  row.badges.length > 0 ? (
                    <Inline space="space.050">
                      {row.badges.map((badge) => (
                        <Lozenge key={badge} appearance={BADGE_APPEARANCE[badge]}>
                          {BADGE_LABEL[badge]}
                        </Lozenge>
                      ))}
                    </Inline>
                  ) : (
                    '—'
                  ),
              },
              { key: 'revenue', content: row.revenueUsd > 0 ? formatUsd(row.revenueUsd) : '—' },
            ],
          }))}
        />
      )}
      {backlogUrl && (
        <Link href={backlogUrl} openNewTab>
          Open the Jira backlog
        </Link>
      )}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

ForgeReconciler.addConfig(<Config />);
