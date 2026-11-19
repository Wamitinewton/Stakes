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

  if (!issueKey) return <Text>Open a Jira issue to see its Stakes Score.</Text>;
  if (!result) return <Text>Loading Stakes Score…</Text>;
  if (!result.ok) {
    return (
      <Text>
        {result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND'
          ? 'Open an issue you can view, or ask a Jira admin for access.'
          : 'Stakes Score is unavailable. Open the issue panel and select Refresh to retry.'}
      </Text>
    );
  }
  return <Text>{result.data.text}</Text>;
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
