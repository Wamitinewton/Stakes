import { formatUsd, plural, type EvidenceItem } from '@stakes/contracts';
import { distinctCustomers, factsOf, openDeals } from '../core/signals';
import type { BuiltPrompt, PromptBook, TextPurpose, WriteRequest } from '../adapters/llm';
import type { ModelName } from '../adapters/llm.models';
import { PROMPT_TEXT } from './promptText';

// Output caps are sized from the word limits at roughly 1.4 tokens a word, plus room
// for evidence citations, so a reply is never cut off mid-sentence.
export const PURPOSES: Record<TextPurpose, { model: ModelName; words: number; maxTokens: number }> =
  {
    summary: { model: 'haiku', words: 80, maxTokens: 240 },
    'ship-internal': { model: 'haiku', words: 120, maxTokens: 340 },
    customer: { model: 'sonnet', words: 150, maxTokens: 400 },
    digest: { model: 'haiku', words: 100, maxTokens: 300 },
  };

export const MAX_ISSUE_SUMMARY = 200;
export const MAX_EXCERPT = 500;
export const MAX_EXCERPTS = 10;
export const MAX_PROMPT_EVIDENCE = 40;

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

// The model sees display fields only. Facts such as owner account ids stay out: the
// model has no use for them and fewer tokens cost less.
export function promptEvidence(evidence: EvidenceItem[]) {
  return evidence.slice(0, MAX_PROMPT_EVIDENCE).map(({ id, type, title, value, unit, detail }) => ({
    id,
    type,
    title,
    value,
    unit,
    // Message bodies are untrusted; they travel in the DATA block instead.
    detail: type === 'conversation' ? 'Message text is quoted in DATA' : detail,
  }));
}

// The untrusted text that goes in the DATA block: what people wrote in conversations.
export function conversationExcerpts(evidence: EvidenceItem[]): string[] {
  return evidence.filter((e) => e.type === 'conversation').map((e) => `${e.id}: ${e.detail}`);
}

// Excerpts are quoted between fixed markers. Any marker inside the text is removed so a
// ticket cannot close the block early and have its words read as instructions.
export function dataBlock(excerpts: string[] = []): string {
  return excerpts
    .slice(0, MAX_EXCERPTS)
    .map((e) => clip(e.replace(/<<<|>>>/g, '').trim(), MAX_EXCERPT))
    .filter((e) => e !== '')
    .join('\n---\n');
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(values[k] ?? ''));

// Context lines the task may refer to; the issue key and summary already have their own.
const CONTEXT_KEYS: Array<[string, string]> = [
  ['versionName', 'Version'],
  ['customerName', 'Customer'],
  ['requestKey', 'Support request'],
  ['tone', 'Tone'],
];

export function buildPrompt(req: WriteRequest): BuiltPrompt {
  const spec = PURPOSES[req.purpose];
  const task = fill(PROMPT_TEXT[req.purpose], {
    words: spec.words,
    tone: req.context.tone ?? 'brief',
  });
  const context = CONTEXT_KEYS.filter(([k]) => req.context[k])
    .map(([k, label]) => `${label}: ${req.context[k]}`)
    .join('\n');
  const issue = `${req.context.issueKey ?? ''} — ${clip(req.context.issueSummary ?? '', MAX_ISSUE_SUMMARY)}`;
  const user = [
    `TASK: ${task}`,
    `ISSUE: ${issue}`,
    ...(context ? [`CONTEXT:\n${context}`] : []),
    `EVIDENCE:\n${JSON.stringify(promptEvidence(req.evidence))}`,
    `DATA:\n<<<\n${dataBlock(req.data)}\n>>>`,
  ].join('\n');
  return {
    model: spec.model,
    system: PROMPT_TEXT.system,
    user,
    maxTokens: spec.maxTokens,
    stripCitations: req.purpose === 'customer',
  };
}

const list = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

// The fallbacks say only what the evidence says, built from the largest items, so a
// template is always safe to show even though no model checked it.

export function evidenceTemplate(req: WriteRequest) {
  const deals = openDeals(req.evidence);
  const requests = factsOf(req.evidence, 'request');
  const customers = distinctCustomers(req.evidence);
  const parts = [
    deals.length > 0
      ? `${plural(deals.length, 'open deal')} worth ${formatUsd(deals.reduce((s, d) => s + d.amountUsd, 0))}`
      : null,
    customers.length > 0 ? plural(customers.length, 'customer') : null,
    requests.length > 0 ? plural(requests.length, 'open support request') : null,
  ].filter((p): p is string => p !== null);
  if (parts.length === 0) {
    return { text: 'Nothing linked to this issue carries stakes yet.', citedIds: [] };
  }
  return {
    text: `Linked to this issue: ${list(parts)}.`,
    citedIds: req.evidence.slice(0, 3).map((e) => e.id),
  };
}

export function shipInternalTemplate(req: WriteRequest) {
  const { issueKey = '', issueSummary = '', versionName } = req.context;
  const deals = openDeals(req.evidence).sort((a, b) => b.amountUsd - a.amountUsd);
  const names = new Map(distinctCustomers(req.evidence).map((c) => [c.customerId, c.name]));
  const requests = factsOf(req.evidence, 'request');
  const topDeals = deals.slice(0, 3);
  const dealCustomers = [
    ...new Set(topDeals.map((d) => (d.customerId ? names.get(d.customerId) : undefined))),
  ].filter((n): n is string => Boolean(n));
  const otherCustomers = [...names.values()].filter((n) => !dealCustomers.includes(n));

  const sentences = [
    `${issueKey} (${clip(issueSummary, MAX_ISSUE_SUMMARY)}) has shipped${versionName ? ` in ${versionName}` : ''}.`,
  ];
  if (deals.length > 0) {
    const total = deals.reduce((s, d) => s + d.amountUsd, 0);
    sentences.push(
      `It was holding up ${plural(deals.length, 'open deal')} worth ${formatUsd(total)}${
        dealCustomers.length > 0 ? `, for ${list(dealCustomers)}` : ''
      }.`,
    );
  } else if (otherCustomers.length > 0) {
    sentences.push(`${list(otherCustomers.slice(0, 3))} were waiting on it.`);
  }
  if (requests.length > 0) {
    sentences.push(
      `${plural(requests.length, 'open support request')} ${requests.length === 1 ? 'is' : 'are'} linked to it.`,
    );
  }
  sentences.push('Please let your customers know.');
  return {
    text: sentences.join(' '),
    citedIds: [
      ...topDeals.map((d) => `ev-deal-${d.dealId}`),
      ...req.evidence.filter((e) => e.facts.kind === 'request').map((e) => e.id),
    ].filter((id) => req.evidence.some((e) => e.id === id)),
  };
}

export function customerTemplate(req: WriteRequest) {
  const { issueKey = '', issueSummary = '', versionName, customerName, requestKey } = req.context;
  const greeting = customerName ? `Good news for the ${customerName} team` : 'Good news';
  const sentences = [
    `${greeting}: the fix for "${clip(issueSummary, MAX_ISSUE_SUMMARY)}" (${issueKey}) has shipped${
      versionName ? ` in release ${versionName}` : ''
    }.`,
  ];
  if (req.context.tone === 'detailed') {
    if (requestKey) {
      sentences.push(`It resolves the problem you reported in ${requestKey}.`);
    }
    sentences.push(
      'Everything should now work as expected. If anything still looks wrong, reply here and we will pick it up straight away.',
    );
  }
  sentences.push('Thank you for your patience while we worked on it.');
  return { text: sentences.join(' '), citedIds: [] };
}

export function digestTemplate(req: WriteRequest) {
  return {
    text: `This week Stakes tracked ${plural(req.evidence.length, 'evidence item')}.`,
    citedIds: [],
  };
}

export const promptBook: PromptBook = {
  build: buildPrompt,
  template(req) {
    switch (req.purpose) {
      case 'ship-internal':
        return shipInternalTemplate(req);
      case 'customer':
        return customerTemplate(req);
      case 'digest':
        return digestTemplate(req);
      default:
        return evidenceTemplate(req);
    }
  },
};
