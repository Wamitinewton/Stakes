import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Button,
  ButtonGroup,
  Code,
  DynamicTable,
  Heading,
  Inline,
  Label,
  Lozenge,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  ProgressBar,
  Range,
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
  Textfield,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import {
  BAND_NAMES,
  SIGNAL_KEYS,
  type BandName,
  type Bands,
  type CsvPreview,
  type CsvRejection,
  type ImportResult,
  type PanelView,
  type SeedStatus,
  type Settings,
  type SettingsView,
  type SignalKey,
  type Weights,
} from '@stakes/contracts';
import { previewScore, setWeight, toPercents } from './weights.js';

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; details?: unknown } };

function unwrap<T extends object>(response: T | { body: T }): T {
  return 'body' in response ? response.body : response;
}

async function call<T>(name: string, payload?: Record<string, unknown>): Promise<Result<T>> {
  try {
    return unwrap(await invoke<Result<T>>(name, payload));
  } catch {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'Stakes could not reach its backend. Try again.' },
    };
  }
}

const SIGNAL_LABEL: Record<SignalKey, string> = {
  R: 'Revenue at risk',
  S: 'Support pressure',
  C: 'Customers',
  H: 'Conversation heat',
  G: 'Goal alignment',
  U: 'Urgency',
};

const BAND_LABEL: Record<BandName, string> = {
  highest: 'Highest',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  lowest: 'Lowest',
};

const option = (value: string, label = value) => ({ value, label });

// ---------------------------------------------------------------------------------
// Data tab
// ---------------------------------------------------------------------------------

const DemoData = ({ view, onChanged }: { view: SettingsView; onChanged: () => void }) => {
  const software = view.projects.filter((p) => p.type === 'software');
  const service = view.projects.filter((p) => p.type === 'service_desk');
  const [softwareKey, setSoftwareKey] = useState(
    view.seed.softwareProjectKey ??
      software.find((p) => p.key === 'PAY')?.key ??
      software[0]?.key ??
      '',
  );
  const [serviceKey, setServiceKey] = useState(
    view.seed.serviceProjectKey ??
      service.find((p) => p.key === 'HELP')?.key ??
      service[0]?.key ??
      '',
  );
  const [status, setStatus] = useState<SeedStatus>(view.seed);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Each call does a slice of the work and returns; keep calling until it is finished.
  const runUntil = async (
    name: 'seedDemo' | 'removeDemo',
    payload: Record<string, unknown>,
    done: (s: SeedStatus) => boolean,
  ) => {
    setBusy(true);
    setProblem(null);
    for (let i = 0; i < 200; i++) {
      const r = await call<SeedStatus>(name, payload);
      if (!r.ok) {
        setProblem(r.error.message);
        break;
      }
      setStatus(r.data);
      if (done(r.data)) break;
    }
    setBusy(false);
    onChanged();
  };

  const load = () =>
    runUntil(
      'seedDemo',
      { softwareProjectKey: softwareKey, serviceProjectKey: serviceKey, confirmed: true },
      (s) => s.state !== 'loading',
    );
  const remove = () => {
    setConfirmRemove(false);
    void runUntil('removeDemo', { confirmed: true }, (s) => s.state !== 'removing');
  };

  const loaded = status.state === 'loaded';
  const inProgress = busy || status.state === 'loading' || status.state === 'removing';
  const mapped = Object.entries(status.keyMap);

  return (
    <Stack space="space.150">
      <Inline space="space.100" alignBlock="center">
        <Heading size="small">Demo data</Heading>
        <Lozenge
          appearance={loaded ? 'success' : status.state === 'failed' ? 'removed' : 'default'}
        >
          {loaded
            ? 'Loaded'
            : status.state === 'failed'
              ? 'Stopped'
              : inProgress
                ? 'Working'
                : 'Not loaded'}
        </Lozenge>
      </Inline>
      <Text>
        Fills two projects with the fictional Orbit Pay company: 25 issues, 15 support requests, 8
        customers, 12 deals, the 2026.12 version, two sprints and 30 days of score history.
        Everything it creates is labelled stakes-demo.
      </Text>
      {!loaded && (
        <Inline space="space.200" shouldWrap>
          <Stack space="space.050">
            <Label labelFor="software">Software project</Label>
            <Select
              id="software"
              options={software.map((p) => option(p.key, `${p.key} · ${p.name}`))}
              value={softwareKey ? option(softwareKey, softwareKey) : undefined}
              onChange={(o: { value: string }) => setSoftwareKey(o.value)}
              isDisabled={!view.isAdmin || inProgress}
            />
          </Stack>
          <Stack space="space.050">
            <Label labelFor="service">Service project</Label>
            <Select
              id="service"
              options={service.map((p) => option(p.key, `${p.key} · ${p.name}`))}
              value={serviceKey ? option(serviceKey, serviceKey) : undefined}
              onChange={(o: { value: string }) => setServiceKey(o.value)}
              isDisabled={!view.isAdmin || inProgress}
            />
          </Stack>
        </Inline>
      )}
      {inProgress && (
        <Stack space="space.050">
          <ProgressBar
            value={status.total > 0 ? status.done / status.total : 0}
            ariaLabel="Demo data progress"
          />
          <Text size="small">{status.step ?? 'Working…'}</Text>
        </Stack>
      )}
      {problem && (
        <SectionMessage appearance="error">
          <Text>{problem}</Text>
          <Text>Press the button again to resume from where it stopped.</Text>
        </SectionMessage>
      )}
      {loaded && mapped.length > 0 && (
        <SectionMessage appearance="information">
          <Text>
            {`${status.softwareProjectKey} already had issues, so the demo issues have new keys. ${mapped
              .slice(0, 4)
              .map(([story, real]) => `${story} is ${real}`)
              .join(', ')}${mapped.length > 4 ? ', …' : ''}.`}
          </Text>
        </SectionMessage>
      )}
      {loaded && (
        <Text size="small">
          Link the goal "Reduce enterprise churn" to PAY-142 to complete the story: Atlassian goals
          can only be created by a person.
        </Text>
      )}
      <ButtonGroup>
        {!loaded && (
          <Button
            appearance="primary"
            onClick={load}
            isDisabled={!view.isAdmin || busy || !softwareKey || !serviceKey}
          >
            {status.state === 'failed' || status.state === 'loading'
              ? 'Resume loading demo data'
              : 'Load demo data'}
          </Button>
        )}
        {(loaded || status.state === 'removing' || status.state === 'failed') && (
          <Button
            appearance="danger"
            onClick={() => setConfirmRemove(true)}
            isDisabled={!view.isAdmin || busy}
          >
            Remove demo data
          </Button>
        )}
      </ButtonGroup>
      <ModalTransition>
        {confirmRemove && (
          <Modal onClose={() => setConfirmRemove(false)}>
            <ModalHeader>
              <ModalTitle appearance="danger">Remove the Orbit Pay demo data?</ModalTitle>
            </ModalHeader>
            <ModalBody>
              <Stack space="space.100">
                <Text>This permanently deletes:</Text>
                <Text>• the demo issues and support requests labelled stakes-demo</Text>
                <Text>
                  • the 8 demo customers and 12 deals in Stakes storage and the Teamwork Graph
                </Text>
                <Text>• version 2026.12, the two demo sprints and the demo score history</Text>
                <Text>Data you imported yourself stays. You can load the demo again later.</Text>
              </Stack>
            </ModalBody>
            <ModalFooter>
              <Button appearance="subtle" onClick={() => setConfirmRemove(false)}>
                Cancel
              </Button>
              <Button appearance="danger" onClick={remove}>
                Remove demo data
              </Button>
            </ModalFooter>
          </Modal>
        )}
      </ModalTransition>
    </Stack>
  );
};

const Rejections = ({ rejected }: { rejected: CsvRejection[] }) => (
  <SectionMessage
    appearance="error"
    title={`${rejected.length} row${rejected.length === 1 ? '' : 's'} need fixing. Nothing was imported.`}
  >
    <Stack space="space.050">
      {rejected.slice(0, 50).map((r) => (
        <Text
          key={`${r.file}-${r.row}-${r.reason}`}
        >{`${r.file}, ${r.row === 0 ? 'file' : `row ${r.row}`}: ${r.reason}`}</Text>
      ))}
      {rejected.length > 50 && <Text>{`…and ${rejected.length - 50} more`}</Text>}
    </Stack>
  </SectionMessage>
);

const PreviewTable = ({
  title,
  table,
}: {
  title: string;
  table: NonNullable<CsvPreview['customers']>;
}) => (
  <Stack space="space.050">
    <Text>
      <Strong>{`${title}: first ${table.rows.length} of ${table.total} rows`}</Strong>
    </Text>
    <DynamicTable
      head={{ cells: table.columns.map((c) => ({ key: c, content: c })) }}
      rows={table.rows.map((row, i) => ({
        key: String(i),
        cells: row.map((cell, j) => ({ key: `${i}-${j}`, content: cell })),
      }))}
    />
  </Stack>
);

const CsvImport = ({ view, onChanged }: { view: SettingsView; onChanged: () => void }) => {
  const [customersCsv, setCustomersCsv] = useState('');
  const [dealsCsv, setDealsCsv] = useState('');
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [rejected, setRejected] = useState<CsvRejection[]>([]);
  const [imported, setImported] = useState<ImportResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const input = () => ({
    ...(customersCsv.trim() ? { customersCsv } : {}),
    ...(dealsCsv.trim() ? { dealsCsv } : {}),
  });

  const check = async () => {
    setBusy(true);
    setImported(null);
    setProblem(null);
    const r = await call<CsvPreview>('previewCsv', input());
    if (r.ok) {
      setPreview(r.data);
      setRejected(r.data.rejected);
    } else setProblem(r.error.message);
    setBusy(false);
  };

  const importNow = async () => {
    setBusy(true);
    setProblem(null);
    const r = await call<ImportResult>('importCsv', { ...input(), confirmed: true });
    if (r.ok) {
      setImported(r.data);
      setPreview(null);
      setRejected([]);
      onChanged();
    } else if (Array.isArray(r.error.details)) setRejected(r.error.details as CsvRejection[]);
    else setProblem(r.error.message);
    setBusy(false);
  };

  return (
    <Stack space="space.150">
      <Heading size="small">Import from CSV</Heading>
      <Text>
        Paste customers, deals or both. Stakes checks every row before importing, and imports
        nothing if any row has a problem. Owner emails are turned into Atlassian account IDs and
        then discarded.
      </Text>
      <Label labelFor="customers-csv">
        Customers (customer_id, customer_name, tier, arr_usd, renewal_date, owner_email)
      </Label>
      <TextArea
        id="customers-csv"
        value={customersCsv}
        onChange={(e) => setCustomersCsv(String(e.target.value ?? ''))}
        isDisabled={!view.isAdmin}
      />
      <Label labelFor="deals-csv">
        Deals (deal_id, deal_name, customer_id, amount_usd, stage, probability, close_date,
        deal_owner_email, blocked_by_issues)
      </Label>
      <TextArea
        id="deals-csv"
        value={dealsCsv}
        onChange={(e) => setDealsCsv(String(e.target.value ?? ''))}
        isDisabled={!view.isAdmin}
      />
      <ButtonGroup>
        <Button
          onClick={check}
          isDisabled={!view.isAdmin || busy || (!customersCsv.trim() && !dealsCsv.trim())}
        >
          Check rows
        </Button>
        <Button
          appearance="primary"
          onClick={importNow}
          isDisabled={!view.isAdmin || busy || preview === null || rejected.length > 0}
        >
          Import
        </Button>
      </ButtonGroup>
      {busy && <Spinner label="Checking rows" />}
      {problem && (
        <SectionMessage appearance="error">
          <Text>{problem}</Text>
        </SectionMessage>
      )}
      {rejected.length > 0 && <Rejections rejected={rejected} />}
      {preview?.customers && <PreviewTable title="Customers" table={preview.customers} />}
      {preview?.deals && <PreviewTable title="Deals" table={preview.deals} />}
      {preview && rejected.length === 0 && <Text>Every row passed. Import when ready.</Text>}
      {imported && (
        <SectionMessage appearance="success">
          <Text>
            {`Imported ${imported.customers} customers and ${imported.deals} deals. ${
              imported.pushedToGraph
                ? `Pushed to the Teamwork Graph (${imported.connectorRejected} rejected).`
                : 'The Stakes connector is not connected, so they are scored from Stakes storage only.'
            } Affected scores recompute the next time they are opened.`}
          </Text>
        </SectionMessage>
      )}
    </Stack>
  );
};

// Checks used to settle how Stakes reads CRM data: one pushes a fictional customer and
// deal linked to an issue and reports whether the graph returns them; the other proves
// the Forge LLM path with a fixed prompt.
const Diagnostics = ({ view }: { view: SettingsView }) => {
  const [issueKey, setIssueKey] = useState('');
  const [output, setOutput] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (name: 'connectorSpike' | 'llmCheck') => {
    setBusy(true);
    const r = await call<unknown>(name, name === 'connectorSpike' ? { issueKey } : {});
    setOutput(r.ok ? JSON.stringify(r.data, null, 2) : r.error.message);
    setBusy(false);
  };
  if (!view.isAdmin) return null;
  return (
    <Stack space="space.100">
      <Heading size="small">Diagnostics</Heading>
      <Label labelFor="spike-issue">Issue key for the connector check</Label>
      <Textfield
        id="spike-issue"
        value={issueKey}
        onChange={(e) => setIssueKey(String(e.target.value ?? ''))}
      />
      <ButtonGroup>
        <Button onClick={() => run('connectorSpike')} isDisabled={busy || !issueKey.trim()}>
          Run connector check
        </Button>
        <Button onClick={() => run('llmCheck')} isDisabled={busy}>
          Run LLM check
        </Button>
      </ButtonGroup>
      {busy && <Spinner label="Running check" />}
      {output && <Code>{output}</Code>}
    </Stack>
  );
};

const DataTab = ({ view, onChanged }: { view: SettingsView; onChanged: () => void }) => (
  <Stack space="space.400">
    <Stack space="space.100">
      <Heading size="small">Connections</Heading>
      <Inline space="space.100" alignBlock="center">
        <Text>
          <Strong>Stakes CRM connector</Strong>
        </Text>
        <Lozenge appearance={view.connectorConnected ? 'success' : 'default'}>
          {view.connectorConnected ? 'Connected' : 'Not connected'}
        </Lozenge>
      </Inline>
      <Text size="small">
        {view.connectorConnected
          ? 'Customers and deals are pushed into the Teamwork Graph as well as Stakes storage.'
          : 'Connect it in Atlassian administration to push customers and deals into the Teamwork Graph. Imports still work without it.'}
      </Text>
    </Stack>
    <DemoData view={view} onChanged={onChanged} />
    <CsvImport view={view} onChanged={onChanged} />
    <Diagnostics view={view} />
  </Stack>
);

// ---------------------------------------------------------------------------------
// Scoring tab
// ---------------------------------------------------------------------------------

// The panel's tile points are 100 × wₖ × nₖ / Σw, so the normalised signals of an example
// issue can be recovered from them to preview a new set of weights live.
function normalisedFrom(view: PanelView, weights: Weights): Record<SignalKey, number> {
  const total = SIGNAL_KEYS.reduce((s, k) => s + weights[k], 0);
  return Object.fromEntries(
    SIGNAL_KEYS.map((k) => {
      const t = view.tiles.find((x) => x.signal === k);
      return [k, t && weights[k] > 0 ? (t.points * total) / (100 * weights[k]) : 0];
    }),
  ) as Record<SignalKey, number>;
}

const ScoringTab = ({ view, onSaved }: { view: SettingsView; onSaved: (s: Settings) => void }) => {
  const [weights, setWeights] = useState<Weights>(view.settings.weights);
  const [bands, setBands] = useState<Bands>(view.settings.bands);
  const [projects, setProjects] = useState<string[]>(view.settings.projectsInScope);
  const [example, setExample] = useState<PanelView | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const exampleKey =
    view.seed.state === 'loaded' ? (view.seed.keyMap['PAY-142'] ?? 'PAY-142') : null;

  useEffect(() => {
    if (!exampleKey) return;
    void call<PanelView>('getStakes', { issueKey: exampleKey }).then(
      (r) => r.ok && setExample(r.data),
    );
  }, [exampleKey]);

  const percents = toPercents(weights);
  const norm = example ? normalisedFrom(example, view.settings.weights) : null;
  const known = new Set(view.priorities.map((p) => p.toLowerCase()));
  const missing = BAND_NAMES.filter((b) => {
    const name = bands.priorities[b];
    return name === null || (view.priorities.length > 0 && !known.has(name.toLowerCase()));
  });

  const save = async () => {
    setSaving(true);
    const r = await call<Settings>('saveSettings', { weights, bands, projectsInScope: projects });
    if (r.ok) {
      setMessage({
        ok: true,
        text: 'Saved. Cached scores recompute the next time each issue is opened.',
      });
      onSaved(r.data);
    } else setMessage({ ok: false, text: r.error.message });
    setSaving(false);
  };

  return (
    <Stack space="space.400">
      <Stack space="space.150">
        <Inline spread="space-between" alignBlock="center">
          <Heading size="small">Signal weights</Heading>
          <Button
            appearance="subtle"
            onClick={() => setWeights({ R: 0.35, S: 0.2, C: 0.15, H: 0.1, G: 0.1, U: 0.1 })}
            isDisabled={!view.isAdmin}
          >
            Reset to defaults
          </Button>
        </Inline>
        <Text>
          Drag to set how much each signal counts. Stakes rescales the others so the weights always
          add up to 100%.
        </Text>
        {SIGNAL_KEYS.map((k) => (
          <Stack key={k} space="space.050">
            <Inline spread="space-between">
              <Label labelFor={`w-${k}`}>{SIGNAL_LABEL[k]}</Label>
              <Text>
                <Strong>{`${percents[k]}%`}</Strong>
              </Text>
            </Inline>
            <Range
              id={`w-${k}`}
              min={0}
              max={100}
              step={1}
              value={percents[k]}
              isDisabled={!view.isAdmin}
              onChange={(v: number) => setWeights(setWeight(weights, k, v / 100))}
            />
          </Stack>
        ))}
        {norm && example && (
          <Text>{`${example.issueKey} would score ${previewScore(norm, weights)} (now ${example.score}).`}</Text>
        )}
      </Stack>

      <Stack space="space.150">
        <Heading size="small">Priority bands</Heading>
        <Text>
          A score at or above each threshold suggests that priority. Names map to this site's
          priority scheme.
        </Text>
        {BAND_NAMES.map((b) => (
          <Inline key={b} space="space.200" alignBlock="end" shouldWrap>
            <Stack space="space.050">
              <Label labelFor={`t-${b}`}>{`${BAND_LABEL[b]} from`}</Label>
              {b === 'lowest' ? (
                <Text>0</Text>
              ) : (
                <Textfield
                  id={`t-${b}`}
                  type="number"
                  value={String(bands.thresholds[b])}
                  isDisabled={!view.isAdmin}
                  onChange={(e) =>
                    setBands({
                      ...bands,
                      thresholds: { ...bands.thresholds, [b]: Number(e.target.value) },
                    })
                  }
                />
              )}
            </Stack>
            <Stack space="space.050">
              <Label labelFor={`p-${b}`}>Jira priority</Label>
              <Select
                id={`p-${b}`}
                options={view.priorities.map((p) => option(p))}
                value={bands.priorities[b] ? option(bands.priorities[b]!) : undefined}
                isDisabled={!view.isAdmin}
                onChange={(o: { value: string }) =>
                  setBands({ ...bands, priorities: { ...bands.priorities, [b]: o.value } })
                }
              />
            </Stack>
          </Inline>
        ))}
        {missing.length > 0 && (
          <SectionMessage appearance="warning">
            <Text>{`Map a Jira priority for: ${missing.map((b) => BAND_LABEL[b]).join(', ')}. Issues in those bands get no suggestion until you do.`}</Text>
          </SectionMessage>
        )}
        <Text size="small">
          {`Silent fire: score ${bands.thresholds.high} or more with priority ${bands.priorities.low ?? 'Low'} or ${bands.priorities.lowest ?? 'Lowest'}. Phantom priority: ${bands.priorities.high ?? 'High'} or ${bands.priorities.highest ?? 'Highest'}, score under ${bands.thresholds.low} and no evidence.`}
        </Text>
      </Stack>

      <Stack space="space.150">
        <Heading size="small">Projects in scope</Heading>
        <Select
          isMulti
          options={view.projects
            .filter((p) => p.type === 'software')
            .map((p) => option(p.key, `${p.key} · ${p.name}`))}
          value={projects.map((p) => option(p))}
          isDisabled={!view.isAdmin}
          onChange={(o: Array<{ value: string }> | null) =>
            setProjects((o ?? []).map((x) => x.value))
          }
        />
        <Text size="small">
          Service projects are read as a source of support requests and are not scored.
        </Text>
      </Stack>

      {message && (
        <SectionMessage appearance={message.ok ? 'success' : 'error'}>
          <Text>{message.text}</Text>
        </SectionMessage>
      )}
      <Inline>
        <Button appearance="primary" onClick={save} isDisabled={!view.isAdmin || saving}>
          Save scoring settings
        </Button>
      </Inline>
    </Stack>
  );
};

// ---------------------------------------------------------------------------------

const App = () => {
  const [view, setView] = useState<Result<SettingsView> | null>(null);
  const reload = () => void call<SettingsView>('getSettings').then(setView);
  useEffect(reload, []);

  if (!view) return <Spinner label="Loading Stakes settings" />;
  if (!view.ok) {
    return (
      <SectionMessage appearance="error">
        <Text>{view.error.message}</Text>
      </SectionMessage>
    );
  }
  const v = view.data;
  return (
    <Stack space="space.300">
      <Heading size="large">Stakes settings</Heading>
      {!v.isAdmin && (
        <SectionMessage
          appearance="information"
          title="Only Jira admins can change these settings."
        >
          <Text>You can see them, but saving, importing and demo data are turned off.</Text>
        </SectionMessage>
      )}
      <Tabs id="stakes-settings">
        <TabList>
          <Tab>Data</Tab>
          <Tab>Scoring</Tab>
        </TabList>
        <TabPanel>
          <DataTab view={v} onChanged={reload} />
        </TabPanel>
        <TabPanel>
          <ScoringTab
            view={v}
            onSaved={(settings) => setView({ ok: true, data: { ...v, settings } })}
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
