// Customers and deals from a CSV or the demo have no CRM page to link to, so they link
// to the address Stakes gives the same object in the Teamwork Graph. The connector and
// the evidence drawer use these together, so both always point at the same place.
export function customerUrl(siteUrl: string, id: string): string {
  return `${siteUrl}/jira/apps/stakes/customer/${encodeURIComponent(id)}`;
}

export function dealUrl(siteUrl: string, id: string): string {
  return `${siteUrl}/jira/apps/stakes/deal/${encodeURIComponent(id)}`;
}
