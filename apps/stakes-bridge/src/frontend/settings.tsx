import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Button,
  ButtonGroup,
  Heading,
  Label,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  Textfield,
} from '@forge/react';
import { invoke } from '@forge/bridge';

interface Status {
  hubspotConfigured: boolean;
  hubspotToken: string | null;
  slackConfigured: boolean;
  slackToken: string | null;
  slackChannel: string | null;
  lastSync: string | null;
  counts: { customers: number; deals: number; issues: number };
  lastErrorCode: string | null;
  runsOnAtlassian: false;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function unwrap<T extends object>(response: T | { body: T }): T {
  return 'body' in response ? response.body : response;
}

async function call<T>(name: string, payload?: Record<string, unknown>): Promise<Result<T>> {
  try {
    return unwrap(await invoke<Result<T>>(name, payload));
  } catch {
    return {
      ok: false,
      error: { code: 'INTERNAL', message: 'The bridge could not be reached. Try again.' },
    };
  }
}

const App = () => {
  const [result, setResult] = useState<Result<Status> | null>(null);
  const [hubspotToken, setHubspotToken] = useState('');
  const [slackToken, setSlackToken] = useState('');
  const [channel, setChannel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setResult(null);
    const r = await call<Status>('getStatus');
    setResult(r);
    if (r.ok && r.data.slackChannel) setChannel(r.data.slackChannel);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (
    name: 'saveHubspotToken' | 'saveSlackConfig' | 'syncNow',
    payload?: Record<string, unknown>,
  ) => {
    setBusy(true);
    setMessage(null);
    const r = await call<Status>(name, payload);
    setResult(r);
    if (name === 'saveHubspotToken') setHubspotToken('');
    if (name === 'saveSlackConfig') setSlackToken('');
    setMessage(r.ok ? (name === 'syncNow' ? 'Sync complete.' : 'Saved and tested.') : null);
    setBusy(false);
  };

  if (!result) return <Spinner label="Loading bridge settings" />;
  const status = result.ok ? result.data : null;

  return (
    <Stack space="space.200">
      <Heading as="h2">Stakes bridge</Heading>
      <SectionMessage appearance="information">
        <Text>
          This optional app sends data to HubSpot and Slack, so it is not Runs on Atlassian
          eligible. The core Stakes app is.
        </Text>
      </SectionMessage>
      {!result.ok && (
        <SectionMessage appearance="error">
          <Text>{result.error.message}</Text>
          <Text>Check the connection and settings, then try again.</Text>
          <Button onClick={() => void load()}>Reload status</Button>
        </SectionMessage>
      )}
      {message && (
        <SectionMessage appearance="success">
          <Text>{message}</Text>
        </SectionMessage>
      )}

      <Heading size="small">HubSpot</Heading>
      <Text>{status?.hubspotToken ?? 'Not configured'}</Text>
      <Label labelFor="hubspot-token">Private-app token</Label>
      <Textfield
        id="hubspot-token"
        type="password"
        value={hubspotToken}
        onChange={(e) => setHubspotToken(String(e.target.value ?? ''))}
        isDisabled={busy}
      />
      <ButtonGroup>
        <Button
          appearance="primary"
          onClick={() => void run('saveHubspotToken', { token: hubspotToken })}
          isDisabled={busy || !hubspotToken.trim()}
        >
          Test and save HubSpot token
        </Button>
        <Button onClick={() => void run('syncNow')} isDisabled={busy || !status?.hubspotConfigured}>
          Sync now
        </Button>
      </ButtonGroup>

      <Heading size="small">Slack</Heading>
      <Text>{status?.slackToken ?? 'Not configured'}</Text>
      <Label labelFor="slack-token">Bot token</Label>
      <Textfield
        id="slack-token"
        type="password"
        value={slackToken}
        onChange={(e) => setSlackToken(String(e.target.value ?? ''))}
        isDisabled={busy}
      />
      <Label labelFor="slack-channel">Default channel</Label>
      <Textfield
        id="slack-channel"
        value={channel}
        onChange={(e) => setChannel(String(e.target.value ?? ''))}
        isDisabled={busy}
      />
      <Button
        appearance="primary"
        onClick={() => void run('saveSlackConfig', { token: slackToken, channel })}
        isDisabled={busy || !slackToken.trim() || !channel.trim()}
      >
        Test and save Slack configuration
      </Button>

      <Heading size="small">Sync status</Heading>
      <Text>
        {status?.lastSync
          ? `Last sync: ${status.lastSync}`
          : 'No sync has completed. Save a HubSpot token and connect the CRM connector, then select Sync now.'}
      </Text>
      <Text>
        {`${status?.counts.customers ?? 0} customers · ${status?.counts.deals ?? 0} deals · ${status?.counts.issues ?? 0} issues`}
      </Text>
      {status?.lastErrorCode && (
        <SectionMessage appearance="warning">
          <Text>
            The last sync failed. Check the HubSpot token and CRM connector connection, then select
            Sync now.
          </Text>
        </SectionMessage>
      )}
      {busy && <Spinner label="Working" />}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
