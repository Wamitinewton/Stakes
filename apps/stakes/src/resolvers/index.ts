import Resolver from '@forge/resolver';
import { isIssueKey } from '@stakes/contracts';
import { err, ok, type Result } from '../core/result.js';

export interface PanelHello {
  issueKey: string;
  message: string;
}

// Reads the issue key from the Forge invocation context rather than the payload, so a
// caller cannot ask about an issue other than the one the panel is rendered on.
export function panelHello(context: unknown): Result<PanelHello> {
  const issueKey = (context as { extension?: { issue?: { key?: unknown } } } | undefined)?.extension
    ?.issue?.key;
  if (!isIssueKey(issueKey)) return err('INVALID_INPUT', 'The panel has no issue context');
  return ok({ issueKey, message: `Stakes is installed and can see ${issueKey}.` });
}

const resolver = new Resolver();

resolver.define('panelHello', ({ context }) => panelHello(context));

export const handler = resolver.getDefinitions();
