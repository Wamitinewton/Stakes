import type { CsvPreview, CsvRejection, ImportResult } from '@stakes/contracts';
import {
  CUSTOMER_COLUMNS,
  DEAL_COLUMNS,
  isClosedStage,
  parseImport,
  toTable,
  type CsvCustomer,
  type CsvDeal,
} from '../core/csv';
import { err, ok, type Result } from '../core/result';
import type { Connector } from '../adapters/connector';
import type { JiraReader } from '../adapters/jira';
import type { ConnectionStore, MirrorStore } from '../adapters/storage';

export interface CsvInput {
  customersCsv?: string;
  dealsCsv?: string;
}

export const PREVIEW_ROWS = 10;

function previewTable(
  file: 'customers' | 'deals',
  text: string | undefined,
  columns: readonly string[],
) {
  if (text === undefined || text.trim() === '') return null;
  const t = toTable(file, text);
  if (!t.ok) return null;
  return {
    columns: [...columns],
    rows: t.table.rows.slice(0, PREVIEW_ROWS).map((r) => columns.map((c) => r.cells[c] ?? '')),
    total: t.table.rows.length,
  };
}

// The preview shows what an import would do without touching anything: the first rows
// as Stakes read them and every row that would be rejected.
export function previewCsv(input: CsvInput): CsvPreview {
  const parsed = parseImport(input);
  return {
    customers: previewTable('customers', input.customersCsv, CUSTOMER_COLUMNS),
    deals: previewTable('deals', input.dealsCsv, DEAL_COLUMNS),
    rejected: parsed.ok ? [] : parsed.rejected,
  };
}

export interface ImportDeps {
  jira: Pick<JiraReader, 'canView' | 'accountIdForEmail'>;
  mirror: Pick<
    MirrorStore,
    'customersByIds' | 'upsertCustomers' | 'upsertDeals' | 'bumpDealsVersion'
  >;
  connector: Pick<Connector, 'pushCustomers' | 'pushDeals'>;
  connections: Pick<ConnectionStore, 'get'>;
  siteUrl: string;
}

// Jira answers a handful of lookups at a time comfortably; more than that just queues.
async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]!);
      }
    }),
  );
  return out;
}

async function resolveEmails(jira: ImportDeps['jira'], emails: string[]) {
  const unique = [...new Set(emails)];
  const ids = await mapLimited(unique, 5, (e) => jira.accountIdForEmail(e));
  return new Map(unique.map((e, i) => [e, ids[i] ?? null]));
}

async function missingIssues(jira: ImportDeps['jira'], keys: string[]): Promise<Set<string>> {
  const unique = [...new Set(keys)];
  const visible = await mapLimited(unique, 5, (k) => jira.canView(k));
  return new Set(unique.filter((_, i) => !visible[i]));
}

export async function importCsv(deps: ImportDeps, input: CsvInput): Promise<Result<ImportResult>> {
  const parsed = parseImport(input);
  if (!parsed.ok)
    return err('INVALID_INPUT', 'Some rows have problems; nothing was imported', parsed.rejected);
  const { customers, deals } = parsed;

  // Checks that need Jira: issue keys must exist for the importing admin, owner emails
  // must belong to Jira users, and deals must point at a known customer.
  const rejected: CsvRejection[] = [];
  const [accounts, missing, existing] = await Promise.all([
    resolveEmails(
      deps.jira,
      [...customers, ...deals].map((r) => r.ownerEmail).filter((e): e is string => e !== null),
    ),
    missingIssues(
      deps.jira,
      deals.flatMap((d) => d.issueKeys),
    ),
    deps.mirror.customersByIds(
      deals.map((d) => d.customerId).filter((id) => !customers.some((c) => c.id === id)),
    ),
  ]);
  const knownCustomers = new Set([...customers.map((c) => c.id), ...existing.map((c) => c.id)]);

  const ownerProblem = (email: string | null) =>
    email !== null && !accounts.get(email) ? `${email} is not a Jira user on this site` : null;

  for (const c of customers) {
    const problem = ownerProblem(c.ownerEmail);
    if (problem) rejected.push({ file: 'customers', row: c.row, reason: `owner_email ${problem}` });
  }
  for (const d of deals) {
    const problems = [
      ownerProblem(d.ownerEmail) && `deal_owner_email ${ownerProblem(d.ownerEmail)}`,
      !knownCustomers.has(d.customerId) &&
        `customer_id ${d.customerId} is not in the customers file or already imported`,
      ...d.issueKeys
        .filter((k) => missing.has(k))
        .map((k) => `${k} does not exist or you cannot see it`),
    ].filter((p): p is string => Boolean(p));
    if (problems.length > 0)
      rejected.push({ file: 'deals', row: d.row, reason: problems.join('; ') });
  }
  if (rejected.length > 0) {
    return err('INVALID_INPUT', 'Some rows have problems; nothing was imported', rejected);
  }

  // Emails are only a lookup key: after this point only account ids are kept.
  const owner = (email: string | null) => (email ? (accounts.get(email) ?? null) : null);
  const mirrorCustomers = customers.map((c: CsvCustomer) => ({
    id: c.id,
    name: c.name,
    tier: c.tier,
    arrUsd: c.arrUsd,
    renewalDate: c.renewalDate,
    ownerAccountId: owner(c.ownerEmail),
    source: 'csv' as const,
  }));
  const mirrorDeals = deals.map((d: CsvDeal) => ({
    id: d.id,
    customerId: d.customerId,
    name: d.name,
    amountUsd: d.amountUsd,
    stage: d.stage,
    probability: d.probability,
    closeDate: d.closeDate,
    closed: isClosedStage(d.stage),
    ownerAccountId: owner(d.ownerEmail),
    issueKeys: d.issueKeys,
    source: 'csv' as const,
  }));
  await deps.mirror.upsertCustomers(mirrorCustomers);
  await deps.mirror.upsertDeals(mirrorDeals);

  let connectorRejected = 0;
  const connectionId = await deps.connections.get();
  if (connectionId) {
    const names = new Map([...existing, ...mirrorCustomers].map((c) => [c.id, c.name]));
    const issuesByCustomer = new Map<string, Set<string>>();
    for (const d of mirrorDeals) {
      const set = issuesByCustomer.get(d.customerId) ?? new Set<string>();
      d.issueKeys.forEach((k) => set.add(k));
      issuesByCustomer.set(d.customerId, set);
    }
    const [pushedCustomers, pushedDeals] = [
      await deps.connector.pushCustomers(
        mirrorCustomers.map((c) => ({ ...c, issueKeys: [...(issuesByCustomer.get(c.id) ?? [])] })),
        connectionId,
        deps.siteUrl,
      ),
      await deps.connector.pushDeals(
        mirrorDeals.map((d) => ({
          id: d.id,
          name: d.name,
          customerName: names.get(d.customerId) ?? d.customerId,
          amountUsd: d.amountUsd,
          stage: d.stage,
          closeDate: d.closeDate,
          isClosed: d.closed,
          issueKeys: d.issueKeys,
        })),
        connectionId,
        deps.siteUrl,
      ),
    ];
    connectorRejected = pushedCustomers.rejected.length + pushedDeals.rejected.length;
  }

  await deps.mirror.bumpDealsVersion();
  console.log('csv imported', {
    customers: customers.length,
    deals: deals.length,
    pushed: Boolean(connectionId),
    connectorRejected,
  });
  return ok({
    customers: customers.length,
    deals: deals.length,
    rejected: [],
    pushedToGraph: Boolean(connectionId),
    connectorRejected,
  });
}
