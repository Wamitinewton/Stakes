import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import Button from '@atlaskit/button';
import DynamicTable from '@atlaskit/dynamic-table';
import { token } from '@atlaskit/tokens';
import type { CustomerSearch, CustomerSummary, CustomerView } from '@stakes/contracts';
import { call } from './lib/resolver';
import { formatRenewalDate, formatTier, rankCustomerIssues } from './lib/customers';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        flex: '1 1 160px',
        padding: 16,
        background: token('color.background.neutral.subtle'),
        borderRadius: 4,
      }}
    >
      <div style={{ color: token('color.text.subtle'), fontSize: 12 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function Exposure({ customer }: { customer: CustomerView }) {
  const issues = rankCustomerIssues(customer.issues);
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div>
        <h2 style={{ marginBottom: 4 }}>{customer.name}</h2>
        <div style={{ color: token('color.text.subtle') }}>
          {formatTier(customer.tier)} · {customer.id} · Owner:{' '}
          {customer.ownerAccountId ?? 'Unassigned'}
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <Stat label="Open deal value at risk" value={money.format(customer.dealValueAtRiskUsd)} />
        <Stat label="ARR" value={money.format(customer.arrUsd)} />
        <Stat label="Renewal" value={formatRenewalDate(customer.renewalDate)} />
        <Stat label="Open issues" value={issues.length} />
      </div>
      <section aria-labelledby="customer-open-issues">
        <h3 id="customer-open-issues">Open issues they wait on</h3>
        {issues.length === 0 ? (
          <p>No open issues are linked to this customer.</p>
        ) : (
          <DynamicTable
            caption={`Open issues linked to ${customer.name}`}
            head={{
              cells: [
                { key: 'issue', content: 'Issue' },
                { key: 'summary', content: 'Summary' },
                { key: 'status', content: 'Status' },
                { key: 'version', content: 'Fix version' },
                { key: 'score', content: 'Stakes Score' },
              ],
            }}
            rows={issues.map((issue) => ({
              key: issue.key,
              cells: [
                {
                  key: 'issue',
                  content: (
                    <a href={issue.url} target="_blank" rel="noreferrer">
                      {issue.key}
                    </a>
                  ),
                },
                { key: 'summary', content: issue.summary },
                { key: 'status', content: issue.status },
                {
                  key: 'version',
                  content: issue.fixVersions.length > 0 ? issue.fixVersions.join(', ') : '—',
                },
                { key: 'score', content: issue.score ?? 'Not scored' },
              ],
            }))}
            rowsPerPage={25}
          />
        )}
      </section>
    </div>
  );
}

export default function Customers() {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<CustomerSummary[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [customer, setCustomer] = useState<CustomerView | null>(null);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectCustomer = useCallback(async (customerId: string) => {
    setSelectedId(customerId);
    setLoading(true);
    setError(null);
    try {
      setCustomer(await call<CustomerView>('getCustomerExposure', { customerId }));
    } catch (cause) {
      setCustomer(null);
      setError(cause instanceof Error ? cause.message : 'Unable to load customer exposure');
    } finally {
      setLoading(false);
    }
  }, []);

  async function search(event: FormEvent) {
    event.preventDefault();
    setSearching(true);
    setSearched(true);
    setError(null);
    setCustomer(null);
    setSelectedId('');
    try {
      const result = await call<CustomerSearch>('searchCustomers', { query: query.trim() });
      setMatches(result.customers);
      if (result.customers.length === 1) await selectCustomer(result.customers[0]!.id);
    } catch (cause) {
      setMatches([]);
      setError(cause instanceof Error ? cause.message : 'Unable to search customers');
    } finally {
      setSearching(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 16, paddingTop: 16 }}>
      <form onSubmit={(event) => void search(event)} style={{ display: 'grid', gap: 8 }}>
        <label htmlFor="customer-search">Customer name or ID</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            id="customer-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="e.g. Kilima or CUST-007"
            required
            style={{
              maxWidth: 320,
              minHeight: 32,
              padding: '0 8px',
              color: token('color.text'),
              background: token('color.background.input'),
              border: `1px solid ${token('color.border')}`,
              borderRadius: 4,
            }}
          />
          <Button appearance="primary" type="submit" isDisabled={searching || !query.trim()}>
            {searching ? 'Searching…' : 'Search'}
          </Button>
        </div>
      </form>

      {matches.length > 0 && (
        <div style={{ display: 'grid', gap: 4, maxWidth: 420 }}>
          <label htmlFor="customer-picker">Customer</label>
          <select
            id="customer-picker"
            value={selectedId}
            onChange={(event) => void selectCustomer(event.target.value)}
            style={{ minHeight: 32 }}
          >
            {matches.length > 1 && <option value="">Select a customer</option>}
            {matches.map((match) => (
              <option key={match.id} value={match.id}>
                {match.name} ({match.id})
              </option>
            ))}
          </select>
        </div>
      )}
      {searched && !searching && matches.length === 0 && !error && (
        <p>No customers match that name prefix or exact ID.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {loading && <p role="status">Loading customer exposure…</p>}
      {customer && !loading && <Exposure customer={customer} />}
    </div>
  );
}
