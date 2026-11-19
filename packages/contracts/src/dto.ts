// Shapes shared by the backend and the UI. The frontend bundles cannot import from
// `src/`, so anything a resolver returns is typed here once and used on both sides.
import type { IssueKey, ProjectKey } from './keys.js';
import type { z } from 'zod';
import type { TierSchema } from './properties.js';

export type Tier = z.infer<typeof TierSchema>;

export type SignalKey = 'R' | 'S' | 'C' | 'H' | 'G' | 'U';
export const SIGNAL_KEYS: readonly SignalKey[] = ['R', 'S', 'C', 'H', 'G', 'U'];

export type EvidenceType =
  'deal' | 'customer' | 'jsm_request' | 'escalation' | 'conversation' | 'goal';
export type EvidenceSource = 'teamwork-graph' | 'jira-rest' | 'mirror' | 'bridge';

export type GoalStatus = 'on-track' | 'at-risk' | 'off-track' | 'unknown';

// The attributes the score reads. The display fields on EvidenceItem are for people;
// these are for arithmetic, so the score never has to parse a formatted string.
export type EvidenceFacts =
  | {
      kind: 'deal';
      dealId: string;
      customerId: string | null;
      amountUsd: number;
      probability: number;
      stage: string;
      closeDate: string | null;
      closed: boolean;
      ownerAccountId: string | null;
    }
  | {
      kind: 'customer';
      customerId: string;
      name: string;
      tier: Tier;
      arrUsd: number;
      renewalDate: string | null;
      ownerAccountId: string | null;
    }
  | {
      kind: 'request';
      requestKey: string;
      priority: string;
      createdAt: string;
      slaBreachAt: string | null;
      escalated: boolean;
      assigneeAccountId: string | null;
    }
  | { kind: 'conversation'; at: string; channel: string | null }
  | { kind: 'goal'; status: GoalStatus };

export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  title: string;
  value: number | null;
  unit: 'USD' | 'count' | 'days' | null;
  detail: string;
  url: string;
  signal: SignalKey;
  source: EvidenceSource;
  fetchedAt: string;
  facts: EvidenceFacts;
}

export type Weights = Record<SignalKey, number>;
export type BandName = 'highest' | 'high' | 'medium' | 'low' | 'lowest';
export const BAND_NAMES: readonly BandName[] = ['highest', 'high', 'medium', 'low', 'lowest'];

export interface Bands {
  // Lowest score that falls in each band; everything below `low` is `lowest`.
  thresholds: { highest: number; high: number; medium: number; low: number };
  // Jira priority name each band suggests, or null until an admin maps a missing name.
  priorities: Record<BandName, string | null>;
}

export type Confidence = 'high' | 'medium' | 'low';
export type Badge = 'silent-fire' | 'phantom' | 'stakes-jump';

export interface Settings {
  weights: Weights;
  weightsVersion: number;
  bands: Bands;
  jumpThreshold: number;
  projectsInScope: ProjectKey[];
  llmEnabled: boolean;
  dailyLlmBudgetCredits: number;
  digestParentPageId: string | null;
}

export interface Snapshot {
  issueKey: string;
  projectKey: string;
  score: number;
  confidence: Confidence;
  raw: Record<SignalKey, number | null>;
  normalised: Record<SignalKey, number>;
  contributions: Record<SignalKey, number>;
  evidence: EvidenceItem[];
  currentPriority: string;
  suggestedPriority: string | null;
  badges: Badge[];
  weightsUsed: Weights;
  weightsVersion: number;
  dealsVersion: number;
  evidenceHash: string;
  summary: { text: string; generated: boolean; citedIds: string[] };
  degraded: EvidenceSource[];
  // Linked items Jira would not show the viewer; their evidence is missing from this run.
  hiddenItems: number;
  computedAt: string;
}

export interface PanelTile {
  signal: SignalKey;
  label: string;
  rawDisplay: string;
  detail: string;
  points: number;
  evidenceIds: string[];
}

export interface PanelCustomer {
  id: string;
  name: string;
  tier: Tier;
  dealValueUsd: number;
  date: string | null;
  ownerAccountId: string | null;
}

export interface ScoreHistory {
  points: Array<{ date: string; score: number }>;
  jump: boolean;
}

export interface PanelView {
  issueKey: string;
  score: number;
  confidence: Confidence;
  currentPriority: string;
  suggestedPriority: string | null;
  badges: Badge[];
  // sourceCount is the evidence the text was written from: the items a generated
  // summary cites, or every item for the template.
  summary: { text: string; generated: boolean; sourceCount: number; citedIds: string[] };
  tiles: PanelTile[];
  customers: PanelCustomer[];
  evidence: EvidenceItem[];
  degraded: EvidenceSource[];
  hiddenItems: number;
  computedAt: string;
  hasPendingShipNotice: boolean;
}

export interface BadgeView {
  text: string;
}

export interface PriorityChange {
  issueKey: IssueKey;
  from: string;
  to: string;
}

export interface ApplyPriorityResult {
  applied: IssueKey[];
  failed: Array<{
    issueKey: IssueKey;
    code: 'FORBIDDEN' | 'NOT_FOUND' | 'STALE_PREVIEW' | 'UPSTREAM_DEGRADED';
  }>;
}

export type CsvFile = 'customers' | 'deals';

export interface CsvRejection {
  file: CsvFile;
  row: number;
  reason: string;
}

export interface CsvPreview {
  customers: { columns: string[]; rows: string[][]; total: number } | null;
  deals: { columns: string[]; rows: string[][]; total: number } | null;
  rejected: CsvRejection[];
}

export interface ImportResult {
  customers: number;
  deals: number;
  rejected: CsvRejection[];
  // False when the connector is not connected yet: the mirror still scores the import.
  pushedToGraph: boolean;
  connectorRejected: number;
}

export type SeedState = 'not-loaded' | 'loading' | 'loaded' | 'removing' | 'failed';

export interface SeedStatus {
  state: SeedState;
  step: string | null;
  done: number;
  total: number;
  counts: {
    issues: number;
    requests: number;
    customers: number;
    deals: number;
    messages: number;
    history: number;
  };
  softwareProjectKey: string | null;
  serviceProjectKey: string | null;
  // Story key → key created on this site, when the project's numbering did not allow
  // the story keys themselves.
  keyMap: Record<string, string>;
  message: string | null;
  updatedAt: string | null;
}

export interface LlmUsageView {
  enabled: boolean;
  budget: number;
  day: string;
  // Credits are estimated from the token counts the Forge LLM SDK reports.
  today: { credits: number; calls: number; inputTokens: number; outputTokens: number };
  rejections: number;
}

export interface SettingsView {
  settings: Settings;
  isAdmin: boolean;
  priorities: string[];
  projects: Array<{ key: string; name: string; type: string }>;
  connectorConnected: boolean;
  seed: SeedStatus;
}

export interface BacklogRow {
  issueKey: IssueKey;
  issueUrl: string;
  summary: string;
  status: string;
  assignee: string | null;
  score: number | null;
  currentPriority: string;
  suggestedPriority: string | null;
  revenueUsd: number;
  customers: number;
  customerNames: string[];
  tickets: number;
  badges: Badge[];
  trend: 'up' | 'down' | 'flat';
  storyPoints: number | null;
  fixVersions: string[];
  components: string[];
}

export interface BacklogSummary {
  total: number;
  scored: number;
  silentFires: number;
  phantoms: number;
  revenueUsd: number;
}

export interface BacklogList {
  rows: BacklogRow[];
  staleKeys: IssueKey[];
  summary: BacklogSummary;
}

export interface BacklogBatch {
  rows: BacklogRow[];
}

export interface ReleaseVersion {
  id: string;
  name: string;
}

export interface ReleaseDeal {
  id: string;
  customerId: string | null;
  amountUsd: number;
}

export interface ReleaseCustomer {
  id: string;
  name: string;
}

export interface ReleaseIssue {
  issueKey: IssueKey;
  summary: string;
  score: number | null;
  url: string;
  dealIds: string[];
  customerIds: string[];
}

export interface ReleaseView {
  versions: ReleaseVersion[];
  version: ReleaseVersion | null;
  issues: ReleaseIssue[];
  deals: ReleaseDeal[];
  customers: ReleaseCustomer[];
}

export interface CustomerSummary {
  id: string;
  name: string;
  tier: Tier;
}

export interface CustomerSearch {
  customers: CustomerSummary[];
}

export interface CustomerIssue {
  key: IssueKey;
  summary: string;
  status: string;
  assigneeAccountId?: string | null;
  fixVersions: string[];
  score: number | null;
  url: string;
}

export interface CustomerView {
  id: string;
  name: string;
  tier: Tier;
  arrUsd: number;
  renewalDate: string | null;
  ownerAccountId: string | null;
  dealValueAtRiskUsd: number;
  issues: CustomerIssue[];
}

export type MacroMode = 'project' | 'version' | 'customer';

export interface MacroRow {
  issueKey: IssueKey;
  issueUrl: string;
  summary: string;
  score: number | null;
  priority: string;
  badges: Badge[];
  revenueUsd: number;
}

export interface MacroTable {
  rows: MacroRow[];
  backlogUrl: string | null;
}

export type ShipTrigger = 'done' | 'release';
export type ShipNoticeStatus = 'pending' | 'sent' | 'dismissed';
export type ShipRecipientRole = 'deal-owner' | 'customer-owner' | 'request-assignee';

export interface ShipRecipient {
  accountId: string;
  roles: ShipRecipientRole[];
  // Customer names and request keys this person is the owner or assignee for.
  customers: string[];
  requestKeys: string[];
}

export interface ShipRequest {
  key: IssueKey;
  summary: string;
  assigneeAccountId: string | null;
}

export interface ShipNoticeView {
  id: string;
  issueKey: IssueKey;
  trigger: ShipTrigger;
  versionName: string | null;
  createdAt: string;
  recipients: ShipRecipient[];
  requests: Array<ShipRequest & { url: string }>;
  // Linked requests the viewer cannot open; Stakes does not show or reply to them.
  hiddenRequests: number;
  customers: Array<{ id: string; name: string }>;
  internalDraft: { text: string; generated: boolean };
}

export type ReplyVisibility = 'public-draft' | 'internal';

export interface CustomerDraft {
  text: string;
  citedIds: string[];
  generated: boolean;
}

export interface SendShipNoticeResult {
  commentId: string;
  replies: Array<{ requestKey: IssueKey; ok: boolean }>;
  // False when the comment and replies went out but the issue property could not be
  // written, so the bridge will not deliver this notice to Slack.
  propertyWritten: boolean;
}
