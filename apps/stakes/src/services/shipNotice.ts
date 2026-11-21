import {
  SHIP_NOTICE_PROPERTY_KEY,
  ShipNoticeProperty,
  isIssueKey,
  type CustomerDraft,
  type EvidenceItem,
  type IssueKey,
  type ReplyVisibility,
  type SendShipNoticeResult,
  type ShipNoticeView,
  type ShipRecipient,
  type ShipRecipientRole,
  type ShipRequest,
  type ShipTrigger,
  type Snapshot,
} from '@stakes/contracts';
import { addDays } from '../core/dates.js';
import { err, ok, type Result } from '../core/result.js';
import { distinctCustomers } from '../core/signals.js';
import type { JiraReader, LinkedRequest } from '../adapters/jira.js';
import type { JiraWriter } from '../adapters/jiraWriter.js';
import type { TextWriter } from '../adapters/llm.js';
import { promptCacheKey } from '../adapters/llmCache.js';
import type { ShipNotice, ShipNoticeStore, SnapshotStore } from '../adapters/storage.js';
import { getStakes, type GetStakesDeps } from './getStakes.js';

// A notice is held back if the same issue's notice was sent this recently: the owners
// already heard, and a Done-then-release sequence should not tell them twice.
export const RECENTLY_SENT_DAYS = 14;
// A release with more issues than this gets notices for the highest-stakes ones only,
// so the trigger stays inside the function time limit.
export const MAX_RELEASE_NOTICES = 25;
export const MAX_INTERNAL_NOTE = 2000;
export const MAX_REPLY = 5000;

// ---------------------------------------------------------------------------------
// Creating notices (triggers, as the app: no graph reads and no comments)
// ---------------------------------------------------------------------------------

export interface CreateNoticeDeps {
  jira: Pick<JiraReader, 'issue' | 'linkedRequests' | 'issuesInVersion'>;
  snapshots: Pick<SnapshotStore, 'latest'>;
  notices: Pick<ShipNoticeStore, 'get' | 'save' | 'forIssue'>;
  writer: Pick<TextWriter, 'write'>;
  clock: () => Date;
}

export function hasStakes(snapshot: Snapshot | null): snapshot is Snapshot {
  return snapshot !== null && (snapshot.score > 0 || snapshot.evidence.length > 0);
}

export function noticeId(issueKey: string, trigger: ShipTrigger, versionId: string | null) {
  return `${issueKey}:${trigger}:${versionId ?? 'none'}`;
}

// Owners come from the deals and customers in the last snapshot; agents from the
// requests linked right now. One entry per person, listing why they are on it.
export function recipientsFor(snapshot: Snapshot, requests: ShipRequest[]): ShipRecipient[] {
  const people = new Map<string, ShipRecipient>();
  const add = (
    accountId: string | null,
    role: ShipRecipientRole,
    customer: string | null,
    requestKey: string | null,
  ) => {
    if (!accountId) return;
    const r = people.get(accountId) ?? { accountId, roles: [], customers: [], requestKeys: [] };
    if (!r.roles.includes(role)) r.roles.push(role);
    if (customer && !r.customers.includes(customer)) r.customers.push(customer);
    if (requestKey && !r.requestKeys.includes(requestKey)) r.requestKeys.push(requestKey);
    people.set(accountId, r);
  };
  const names = customerNames(snapshot.evidence);
  for (const e of snapshot.evidence) {
    const f = e.facts;
    if (f.kind === 'deal' && !f.closed) {
      add(
        f.ownerAccountId,
        'deal-owner',
        f.customerId ? (names.get(f.customerId) ?? null) : null,
        null,
      );
    } else if (f.kind === 'customer') {
      add(f.ownerAccountId, 'customer-owner', f.name, null);
    }
  }
  for (const r of requests) add(r.assigneeAccountId, 'request-assignee', null, r.key);
  return [...people.values()];
}

function customerNames(evidence: EvidenceItem[]): Map<string, string> {
  return new Map(distinctCustomers(evidence).map((c) => [c.customerId, c.name]));
}

const toShipRequest = (r: LinkedRequest): ShipRequest => ({
  key: r.key,
  summary: r.summary,
  assigneeAccountId: r.assigneeAccountId,
});

export type CreateOutcome = 'created' | 'updated' | 'no-stakes' | 'recently-sent' | 'closed';

export async function createNotice(
  deps: CreateNoticeDeps,
  input: {
    issueKey: IssueKey;
    trigger: ShipTrigger;
    version: { id: string; name: string } | null;
  },
): Promise<CreateOutcome> {
  const now = deps.clock();
  const snapshot = await deps.snapshots.latest(input.issueKey);
  if (!hasStakes(snapshot)) return 'no-stakes';

  const existing = await deps.notices.forIssue(input.issueKey);
  const recent = addDays(now, -RECENTLY_SENT_DAYS).toISOString();
  if (existing.some((n) => n.status === 'sent' && (n.sentAt ?? n.updatedAt) >= recent)) {
    return 'recently-sent';
  }
  const id = noticeId(input.issueKey, input.trigger, input.version?.id ?? null);
  const pending = existing.find((n) => n.status === 'pending');
  // The same event delivered twice, after the notice was sent or dismissed, must not
  // bring it back.
  if (!pending && existing.some((n) => n.id === id)) return 'closed';

  const [issue, linked] = await Promise.all([
    deps.jira.issue(input.issueKey),
    deps.jira.linkedRequests(input.issueKey).catch(() => ({ requests: [], hidden: 0 })),
  ]);
  const requests = linked.requests.map(toShipRequest);
  // A release adds its version to a pending Done notice rather than starting another.
  const version =
    input.version ??
    (pending?.versionId ? { id: pending.versionId, name: pending.versionName ?? '' } : null);
  const context = {
    issueKey: input.issueKey,
    issueSummary: issue?.summary ?? '',
    ...(version?.name ? { versionName: version.name } : {}),
  };
  const draft = await deps.writer.write({
    purpose: 'ship-internal',
    cacheKey: promptCacheKey('ship-internal', snapshot.evidence, context),
    evidence: snapshot.evidence,
    context,
  });

  const notice: ShipNotice = {
    id: pending?.id ?? id,
    issueKey: input.issueKey,
    trigger: input.version ? input.trigger : (pending?.trigger ?? input.trigger),
    versionId: version?.id ?? null,
    versionName: version?.name || null,
    recipients: recipientsFor(snapshot, requests),
    jsmRequests: requests,
    customers: [...customerNames(snapshot.evidence)].map(([cid, name]) => ({ id: cid, name })),
    internalDraft: draft.text,
    internalGenerated: draft.generated,
    citedIds: draft.citedIds,
    status: 'pending',
    createdAt: pending?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    sentBy: null,
    sentAt: null,
    dismissedBy: null,
  };
  await deps.notices.save(notice);
  console.log('ship notice saved', {
    issueKey: input.issueKey,
    trigger: notice.trigger,
    recipients: notice.recipients.length,
    requests: requests.length,
    generated: draft.generated,
  });
  return pending ? 'updated' : 'created';
}

interface ChangelogItem {
  field?: unknown;
  fieldId?: unknown;
}

export interface IssueUpdatedEvent {
  issue?: { key?: unknown };
  changelog?: { items?: ChangelogItem[] } | ChangelogItem[];
}

function statusChanged(event: IssueUpdatedEvent): boolean {
  const items = Array.isArray(event.changelog) ? event.changelog : (event.changelog?.items ?? []);
  return items.some(
    (i) => String(i.field ?? '').toLowerCase() === 'status' || i.fieldId === 'status',
  );
}

// A cached snapshot is already invalidated by the edit itself: the freshness check
// compares the issue's updated time with the snapshot's. It is kept, not deleted,
// because its evidence is what tells the notice who to notify.
export async function onIssueUpdated(
  deps: CreateNoticeDeps,
  event: IssueUpdatedEvent,
): Promise<CreateOutcome | 'ignored'> {
  const key = event.issue?.key;
  if (!isIssueKey(key) || !statusChanged(event)) return 'ignored';
  const issue = await deps.jira.issue(key);
  if (!issue || issue.statusCategory !== 'done') return 'ignored';
  return createNotice(deps, { issueKey: key, trigger: 'done', version: null });
}

export interface VersionReleasedEvent {
  version?: { id?: unknown; name?: unknown };
}

export async function onVersionReleased(
  deps: CreateNoticeDeps,
  event: VersionReleasedEvent,
): Promise<{ created: number; skipped: number }> {
  const id = String(event.version?.id ?? '');
  const name = typeof event.version?.name === 'string' ? event.version.name : '';
  if (!/^\d+$/.test(id)) return { created: 0, skipped: 0 };

  const keys = await deps.jira.issuesInVersion(id);
  const scored = (
    await Promise.all(keys.map(async (k) => ({ k, s: await deps.snapshots.latest(k) })))
  )
    .filter((x) => hasStakes(x.s))
    .sort((a, b) => b.s!.score - a.s!.score);
  const chosen = scored.slice(0, MAX_RELEASE_NOTICES);

  let created = 0;
  for (const { k } of chosen) {
    const outcome = await createNotice(deps, {
      issueKey: k,
      trigger: 'release',
      version: { id, name },
    }).catch(() => 'error' as const);
    if (outcome === 'created' || outcome === 'updated') created++;
  }
  const skipped = keys.length - created;
  console.log('release notices', { versionId: id, issues: keys.length, created, skipped });
  return { created, skipped };
}

// ---------------------------------------------------------------------------------
// Reviewing and sending (resolvers, as the user)
// ---------------------------------------------------------------------------------

export interface ShipNoticeDeps {
  jira: Pick<JiraReader, 'canView' | 'issue'>;
  writer: Pick<JiraWriter, 'addComment' | 'addRequestComment' | 'setProperty'>;
  notices: Pick<ShipNoticeStore, 'save' | 'forIssue' | 'pendingFor'>;
  stakes: GetStakesDeps;
  text: Pick<TextWriter, 'write'>;
  siteUrl: string;
  clock: () => Date;
}

// Requests the viewer cannot open are left out entirely, titles included.
async function visibleRequests(deps: Pick<ShipNoticeDeps, 'jira'>, notice: ShipNotice) {
  const seen = await Promise.all(
    notice.jsmRequests.map((r) => deps.jira.canView(r.key).catch(() => false)),
  );
  return notice.jsmRequests.filter((_, i) => seen[i]);
}

export async function getShipNotice(
  deps: Pick<ShipNoticeDeps, 'jira' | 'notices' | 'siteUrl'>,
  issueKey: IssueKey,
): Promise<ShipNoticeView | null> {
  const notice = await deps.notices.pendingFor(issueKey);
  if (!notice) return null;
  const requests = await visibleRequests(deps, notice);
  const visible = new Set(requests.map((r) => r.key));
  const hiddenRequests = notice.jsmRequests.length - requests.length;
  return {
    id: notice.id,
    issueKey: notice.issueKey,
    trigger: notice.trigger,
    versionName: notice.versionName,
    createdAt: notice.createdAt,
    recipients: notice.recipients
      .map((r) => ({ ...r, requestKeys: r.requestKeys.filter((k) => visible.has(k)) }))
      .filter(
        (r) => r.roles.some((role) => role !== 'request-assignee') || r.requestKeys.length > 0,
      )
      .map((r) => ({
        ...r,
        roles: r.requestKeys.length > 0 ? r.roles : r.roles.filter((x) => x !== 'request-assignee'),
      })),
    requests: requests.map((r) => ({ ...r, url: `${deps.siteUrl}/browse/${r.key}` })),
    hiddenRequests,
    customers: notice.customers,
    internalDraft:
      hiddenRequests > 0
        ? {
            text: 'Some linked requests are hidden from you. Ask someone with access to all linked requests to review and send this ship notice.',
            generated: false,
          }
        : { text: notice.internalDraft, generated: notice.internalGenerated },
  };
}

const TIER_FREE_DETAIL = '';

// What a customer draft may be written from: that customer's name or that request's
// own summary and age, never another customer, a deal value or the internal priority.
export function customerEvidence(
  snapshot: Snapshot,
  target: { customerId?: string; requestKey?: string },
  now: Date,
): { evidence: EvidenceItem[]; name: string | null; forbidden: string[] } | null {
  const names = customerNames(snapshot.evidence);
  if (target.customerId) {
    const item = snapshot.evidence.find(
      (e) => e.facts.kind === 'customer' && e.facts.customerId === target.customerId,
    );
    if (!item || item.facts.kind !== 'customer') return null;
    const name = item.facts.name;
    // The guard trusts numbers in facts as well as display fields, so the customer's
    // ARR and renewal date are removed from both.
    const facts = { ...item.facts, arrUsd: 0, renewalDate: null, ownerAccountId: null };
    return {
      evidence: [{ ...item, value: null, unit: null, detail: TIER_FREE_DETAIL, facts }],
      name,
      forbidden: [...names.values()].filter((n) => n !== name),
    };
  }
  if (target.requestKey) {
    const item = snapshot.evidence.find(
      (e) => e.facts.kind === 'request' && e.facts.requestKey === target.requestKey,
    );
    const forbidden = [...names.values()];
    if (!item || item.facts.kind !== 'request') return { evidence: [], name: null, forbidden };
    const age = Math.max(
      0,
      Math.floor((now.getTime() - new Date(item.facts.createdAt).getTime()) / 86_400_000),
    );
    return {
      evidence: [{ ...item, value: null, unit: null, detail: `open ${age} days` }],
      name: null,
      forbidden,
    };
  }
  return { evidence: [], name: null, forbidden: [...names.values()] };
}

export async function draftCustomer(
  deps: Pick<ShipNoticeDeps, 'stakes' | 'notices' | 'text' | 'clock'>,
  input: {
    issueKey: IssueKey;
    customerId?: string;
    requestKey?: string;
    tone: 'brief' | 'detailed';
  },
): Promise<Result<CustomerDraft>> {
  const stakes = await getStakes(deps.stakes, input.issueKey, { refresh: false });
  if (!stakes.ok) return stakes;
  const snapshot = stakes.data;
  const target = customerEvidence(snapshot, input, deps.clock());
  if (!target) return err('NOT_FOUND', 'That customer is not linked to this issue');

  const [issue, notice] = await Promise.all([
    deps.stakes.jira.issue(input.issueKey),
    deps.notices.pendingFor(input.issueKey),
  ]);
  const context = {
    issueKey: input.issueKey,
    issueSummary: issue?.summary ?? '',
    tone: input.tone,
    ...(target.name ? { customerName: target.name } : {}),
    ...(input.requestKey ? { requestKey: input.requestKey } : {}),
    ...(notice?.versionName ? { versionName: notice.versionName } : {}),
  };
  const written = await deps.text.write({
    purpose: 'customer',
    cacheKey: promptCacheKey('customer', snapshot.evidence, context),
    evidence: target.evidence,
    context,
    forbiddenNames: target.forbidden,
  });
  return ok({ text: written.text, citedIds: written.citedIds, generated: written.generated });
}

type Adf = { type: 'doc'; version: 1; content: unknown[] };

const paragraph = (content: unknown[]) => ({ type: 'paragraph', content });
const text = (t: string) => ({ type: 'text', text: t });
const mention = (id: string) => ({ type: 'mention', attrs: { id } });

export function internalComment(note: string, ownerIds: string[], actorAccountId: string): Adf {
  const paragraphs = note
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
    .map((p) => paragraph([text(p)]));
  const owners =
    ownerIds.length > 0
      ? [
          paragraph([
            text('For '),
            ...ownerIds.flatMap((id, i) => [...(i > 0 ? [text(' ')] : []), mention(id)]),
          ]),
        ]
      : [];
  return {
    type: 'doc',
    version: 1,
    content: [
      ...paragraphs,
      ...owners,
      paragraph([text('Ship notice sent by '), mention(actorAccountId), text(' via Stakes')]),
    ],
  };
}

// Jira Service Management's API cannot save a reply as a draft, so a "public draft" is
// posted as an internal note holding the suggested reply. The assigned agent reviews it
// and sends it to the customer themselves; Stakes never posts anything a customer sees.
export function requestNote(reply: string, visibility: ReplyVisibility, issueKey: string): string {
  return visibility === 'public-draft'
    ? `Suggested reply to the customer, drafted by Stakes because ${issueKey} has shipped. It has not been sent; review it and send it from this request.\n\n${reply}`
    : reply;
}

export interface SendInput {
  issueKey: IssueKey;
  internalNote: string;
  customerReplies: Array<{ requestKey: IssueKey; text: string; visibility: ReplyVisibility }>;
}

export async function sendShipNotice(
  deps: Pick<ShipNoticeDeps, 'jira' | 'writer' | 'notices' | 'clock'>,
  input: SendInput,
  actorAccountId: string,
): Promise<Result<SendShipNoticeResult>> {
  const notices = await deps.notices.forIssue(input.issueKey);
  const pending = notices.filter((n) => n.status === 'pending');
  if (pending.length === 0) {
    return err('NOT_FOUND', 'No ship notice is waiting for this issue. It may already be sent.');
  }
  const notice = pending[0]!;
  const known = new Set(notice.jsmRequests.map((r) => r.key));
  const stray = input.customerReplies.find((r) => !known.has(r.requestKey));
  if (stray) return err('INVALID_INPUT', `${stray.requestKey} is not linked to this notice`);

  const ownerIds = notice.recipients
    .filter((r) => r.roles.some((role) => role !== 'request-assignee'))
    .map((r) => r.accountId);

  let commentId: string;
  try {
    commentId = await deps.writer.addComment(
      input.issueKey,
      internalComment(input.internalNote, ownerIds, actorAccountId),
    );
  } catch {
    console.warn('ship notice comment failed', { issueKey: input.issueKey });
    return err('UPSTREAM_DEGRADED', 'Jira refused the comment, so nothing was sent. Try again.');
  }

  // One request failing must not stop the others; each result is reported.
  const replies: SendShipNoticeResult['replies'] = [];
  for (const reply of input.customerReplies) {
    try {
      await deps.writer.addRequestComment(
        reply.requestKey,
        requestNote(reply.text, reply.visibility, input.issueKey),
        { public: false },
      );
      replies.push({ requestKey: reply.requestKey, ok: true });
    } catch {
      replies.push({ requestKey: reply.requestKey, ok: false });
    }
  }

  const sentAt = deps.clock().toISOString();
  let propertyWritten = true;
  try {
    const property = ShipNoticeProperty.parse({
      status: 'sent',
      internalNote: input.internalNote.slice(0, MAX_INTERNAL_NOTE),
      ownerAccountIds: ownerIds,
      sentAt,
    });
    await deps.writer.setProperty(input.issueKey, SHIP_NOTICE_PROPERTY_KEY, property);
  } catch {
    propertyWritten = false;
  }

  // The comment is out, so the notice is marked sent even if the property failed:
  // marking it pending again would invite a second, duplicate comment.
  for (const n of pending) {
    await deps.notices.save({
      ...n,
      status: 'sent',
      internalDraft: input.internalNote,
      sentBy: actorAccountId,
      sentAt,
      updatedAt: sentAt,
    });
  }
  console.log('ship notice sent', {
    issueKey: input.issueKey,
    owners: ownerIds.length,
    replies: replies.length,
    failed: replies.filter((r) => !r.ok).length,
    propertyWritten,
  });
  return ok({ commentId, replies, propertyWritten });
}

export async function dismissShipNotice(
  deps: Pick<ShipNoticeDeps, 'notices' | 'clock'>,
  issueKey: IssueKey,
  actorAccountId: string,
): Promise<{ ok: true; dismissed: number }> {
  const pending = (await deps.notices.forIssue(issueKey)).filter((n) => n.status === 'pending');
  const at = deps.clock().toISOString();
  for (const n of pending) {
    await deps.notices.save({
      ...n,
      status: 'dismissed',
      dismissedBy: actorAccountId,
      updatedAt: at,
    });
  }
  console.log('ship notice dismissed', { issueKey, dismissed: pending.length });
  return { ok: true, dismissed: pending.length };
}
