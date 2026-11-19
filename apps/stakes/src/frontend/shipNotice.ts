import type {
  ReplyVisibility,
  SendShipNoticeResult,
  ShipNoticeView,
  ShipRecipientRole,
} from '@stakes/contracts';

export function bannerText(view: Pick<ShipNoticeView, 'recipients'>): string {
  const n = view.recipients.length;
  return `This fix shipped. ${n} ${n === 1 ? 'person' : 'people'} should hear about it.`;
}

const ROLE_LABEL: Record<ShipRecipientRole, string> = {
  'deal-owner': 'Deal owner',
  'customer-owner': 'Account owner',
  'request-assignee': 'Support agent',
};

export function recipientText(r: ShipNoticeView['recipients'][number]): string {
  const roles = r.roles.map((role) => ROLE_LABEL[role]).join(', ');
  const about = [...r.customers, ...r.requestKeys].join(', ');
  return about ? `${roles} · ${about}` : roles;
}

export const VISIBILITY_LABEL: Record<ReplyVisibility, string> = {
  'public-draft': 'Suggested reply for the agent to send',
  internal: 'Internal note for agents',
};

export interface ReplyDraft {
  requestKey: string;
  text: string;
  visibility: ReplyVisibility;
}

// Exactly what Send will post and where, so the confirmation hides nothing.
export function confirmationLines(
  issueKey: string,
  ownerCount: number,
  replies: ReplyDraft[],
): string[] {
  const kept = replies.filter((r) => r.text.trim() !== '');
  return [
    `One comment on ${issueKey}${ownerCount > 0 ? ` mentioning ${ownerCount} ${ownerCount === 1 ? 'owner' : 'owners'}` : ''}.`,
    ...kept.map(
      (r) =>
        `${r.requestKey}: ${r.visibility === 'public-draft' ? 'an internal note holding a suggested reply (the customer does not see it until an agent sends it)' : 'an internal note'}.`,
    ),
    `The ${issueKey} ship notice property is set to sent, so the Stakes bridge can deliver it to Slack.`,
  ];
}

export function resultLines(issueKey: string, result: SendShipNoticeResult): string[] {
  return [
    `Comment posted on ${issueKey}.`,
    ...result.replies.map((r) =>
      r.ok
        ? `${r.requestKey}: note added.`
        : `${r.requestKey}: Jira refused the note. Add it by hand.`,
    ),
    ...(result.propertyWritten
      ? []
      : ['The ship notice property could not be set, so Slack delivery will not happen.']),
  ];
}

export function ownerCount(view: Pick<ShipNoticeView, 'recipients'>): number {
  return view.recipients.filter((r) => r.roles.some((x) => x !== 'request-assignee')).length;
}
