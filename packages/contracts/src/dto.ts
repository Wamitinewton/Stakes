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

export interface PanelView {
  issueKey: string;
  score: number;
  confidence: Confidence;
  currentPriority: string;
  suggestedPriority: string | null;
  badges: Badge[];
  summary: { text: string; generated: boolean; sourceCount: number };
  tiles: PanelTile[];
  customers: PanelCustomer[];
  evidence: EvidenceItem[];
  degraded: EvidenceSource[];
  hiddenItems: number;
  computedAt: string;
  hasPendingShipNotice: boolean;
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

export interface SettingsView {
  settings: Settings;
  isAdmin: boolean;
  priorities: string[];
  projects: Array<{ key: string; name: string; type: string }>;
  connectorConnected: boolean;
  seed: SeedStatus;
}
