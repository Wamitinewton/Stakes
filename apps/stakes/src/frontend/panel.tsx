import React, { useEffect, useState } from 'react';
import ForgeReconciler, { SectionMessage, Spinner, Text } from '@forge/react';
import { invoke } from '@forge/bridge';

type PanelHello =
  | { ok: true; data: { issueKey: string; message: string } }
  | { ok: false; error: { code: string; message: string } };

// invoke() only wraps the result in { body, metadata } when metadata was requested,
// which these views never do, but the type allows both shapes.
function unwrap<T extends object>(response: T | { body: T }): T {
  return 'body' in response ? response.body : response;
}

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
  return <Text>{result.data.message}</Text>;
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
