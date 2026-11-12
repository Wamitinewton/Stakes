import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Heading, SectionMessage, Stack, Text } from '@forge/react';
import { invoke } from '@forge/bridge';

interface Status {
  hubspotConfigured: boolean;
  slackConfigured: boolean;
}

// invoke() only wraps the result in { body, metadata } when metadata was requested,
// which these views never do, but the type allows both shapes.
function unwrap<T extends object>(response: T | { body: T }): T {
  return 'body' in response ? response.body : response;
}

const App = () => {
  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    invoke<Status>('getStatus').then((r) => setStatus(unwrap(r)));
  }, []);

  return (
    <Stack space="space.200">
      <Heading as="h2">Stakes bridge</Heading>
      <SectionMessage appearance="information">
        <Text>
          This optional app sends data to HubSpot and Slack, so it is not eligible for Runs on
          Atlassian. The core Stakes app works without it.
        </Text>
      </SectionMessage>
      <Text>HubSpot: {status?.hubspotConfigured ? 'connected' : 'not connected'}</Text>
      <Text>Slack: {status?.slackConfigured ? 'connected' : 'not connected'}</Text>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
