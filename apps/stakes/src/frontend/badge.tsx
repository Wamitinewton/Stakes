import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, useProductContext } from '@forge/react';
import { invoke } from '@forge/bridge';
import { type BadgeView } from '@stakes/contracts';

type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

function unwrap<T extends object>(response: T | { body: T }): T {
  return 'body' in response ? response.body : response;
}

const App = () => {
  const context = useProductContext();
  const issueKey = (context?.extension as { issue?: { key?: string } } | undefined)?.issue?.key;
  const [result, setResult] = useState<Result<BadgeView> | null>(null);

  useEffect(() => {
    if (!issueKey) return;
    invoke<Result<BadgeView>>('getBadge', { issueKey })
      .then((response) => setResult(unwrap(response)))
      .catch(() =>
        setResult({
          ok: false,
          error: { code: 'INTERNAL', message: 'Stakes could not load. Try again.' },
        }),
      );
  }, [issueKey]);

  if (!result) return <Text>Loading…</Text>;
  return <Text>{result.ok ? result.data.text : result.error.message}</Text>;
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
