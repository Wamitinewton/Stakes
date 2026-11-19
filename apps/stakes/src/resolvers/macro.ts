import { z } from 'zod';
import { ProjectKey, type MacroTable } from '@stakes/contracts';
import { err, ok, type Result } from '../core/result.js';
import { macroTable, type MacroDeps, type MacroQuery } from '../services/macro.js';
import { guarded, parseInput, readContext, type CallContext } from './context.js';

export type MacroDepsFactory = (ctx: CallContext) => { macro: MacroDeps };

const MacroInput = z.object({
  mode: z.enum(['project', 'version', 'customer']),
  key: z.string().trim().min(1).max(200),
});

function query(input: z.infer<typeof MacroInput>): Result<MacroQuery> {
  if (input.mode === 'customer') return ok({ mode: 'customer', query: input.key });

  const projectKey = input.mode === 'project' ? input.key.toUpperCase() : input.key.split(':')[0]!;
  const parsedProject = ProjectKey.safeParse(projectKey);
  if (!parsedProject.success) {
    return err('INVALID_INPUT', 'Enter a valid Jira project key, for example PAY');
  }
  if (input.mode === 'project') {
    return ok({ mode: 'project', projectKey: parsedProject.data });
  }

  const separator = input.key.indexOf(':');
  const version = separator === -1 ? '' : input.key.slice(separator + 1).trim();
  if (!version) {
    return err('INVALID_INPUT', 'Enter both a project key and fix version');
  }
  return ok({ mode: 'version', projectKey: parsedProject.data, version });
}

export function macroTableHandler(makeDeps: MacroDepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<MacroTable>> =>
    guarded('macroTable', async () => {
      const parsed = parseInput(MacroInput, payload);
      if (!parsed.ok) return parsed;
      const macroQuery = query(parsed.data);
      if (!macroQuery.ok) return macroQuery;
      const table = await macroTable(makeDeps(readContext(context)).macro, macroQuery.data);
      if (table) return ok(table);
      return parsed.data.mode === 'customer'
        ? err('NOT_FOUND', 'Enter a unique customer name or ID')
        : err('NOT_FOUND', 'Select an unreleased version in this project');
    });
}
