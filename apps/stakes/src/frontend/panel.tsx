import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, SectionMessage, Spinner, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';

type PanelHello =
  | { ok: true; data: { issueKey: string; message: string } }
  | { ok: false; error: { code: string; message: string } };

// invoke() only wraps the result in { body, metadata } when metadata was requested,
// which these views never do, but the type allows both shapes.
function unwrap<T extends object>(response: T | { body: T }): T {
  return 'body' in response ? response.body : response;
}

type LlmCheck =
  | { ok: true; data: { text: string; model: string; usage: { outputTokens: number | null } } }
  | { ok: false; error: { message: string } };

// Temporary check that the Forge LLM path works on the site; replaced by the
// "why it matters" summary.
const LlmCheckButton = () => {
  const [state, setState] = useState<'idle' | 'running' | LlmCheck>('idle');
  const run = () => {
    setState('running');
    invoke<LlmCheck>('llmCheck')
      .then((r) => setState(unwrap(r)))
      .catch(() => setState({ ok: false, error: { message: 'The LLM check could not run.' } }));
  };
  if (state === 'idle') return <Button onClick={run}>Run LLM check</Button>;
  if (state === 'running') return <Spinner label="Calling Forge LLM" />;
  if (!state.ok) return <Text>{state.error.message}</Text>;
  return (
    <Text>
      {state.data.model} replied "{state.data.text}" ({state.data.usage.outputTokens ?? '?'} output
      tokens)
    </Text>
  );
};

const App = () => {
  const [result, setResult] = useState<PanelHello | null>(null);

  useEffect(() => {
    invoke<PanelHello>('panelHello')
      .then((r) => setResult(unwrap(r)))
      .catch(() =>
        setResult({ ok: false, error: { code: 'INTERNAL', message: 'Stakes could not load.' } }),
      );
  }, []);

  if (!result) return <Spinner label="Loading Stakes" />;
  if (!result.ok) {
    return (
      <SectionMessage appearance="warning">
        <Text>{result.error.message}</Text>
      </SectionMessage>
    );
  }
  return (
    <Stack space="space.100">
      <Text>{result.data.message}</Text>
      <LlmCheckButton />
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
