import { describe, expect, it } from 'vitest';
import {
  bannerText,
  confirmationLines,
  ownerCount,
  recipientText,
  resultLines,
} from '../../src/frontend/shipNotice';

const recipients = [
  {
    accountId: 'a',
    roles: ['deal-owner' as const, 'customer-owner' as const],
    customers: ['Kilima Freight'],
    requestKeys: [],
  },
  { accountId: 'b', roles: ['request-assignee' as const], customers: [], requestKeys: ['HELP-1'] },
];

describe('ship notice text', () => {
  it('counts people in the banner', () => {
    expect(bannerText({ recipients })).toBe('This fix shipped. 2 people should hear about it.');
    expect(bannerText({ recipients: [recipients[0]!] })).toBe(
      'This fix shipped. 1 person should hear about it.',
    );
  });

  it('says why each person is listed', () => {
    expect(recipientText(recipients[0]!)).toBe('Deal owner, Account owner · Kilima Freight');
    expect(recipientText({ ...recipients[1]!, requestKeys: [] })).toBe('Support agent');
  });

  it('lists exactly what Send posts, skipping empty replies', () => {
    expect(
      confirmationLines('PAY-142', ownerCount({ recipients }), [
        { requestKey: 'HELP-1', text: 'Fixed', visibility: 'public-draft' },
        { requestKey: 'HELP-2', text: ' ', visibility: 'internal' },
        { requestKey: 'HELP-3', text: 'FYI', visibility: 'internal' },
      ]),
    ).toEqual([
      'One comment on PAY-142 mentioning 1 owner.',
      'HELP-1: an internal note holding a suggested reply (the customer does not see it until an agent sends it).',
      'HELP-3: an internal note.',
      'The PAY-142 ship notice property is set to sent, so the Stakes bridge can deliver it to Slack.',
    ]);
  });

  it('reports each failure after sending', () => {
    expect(
      resultLines('PAY-142', {
        commentId: '1',
        replies: [
          { requestKey: 'HELP-1', ok: true },
          { requestKey: 'HELP-2', ok: false },
        ],
        propertyWritten: false,
      }),
    ).toEqual([
      'Comment posted on PAY-142.',
      'HELP-1: note added.',
      'HELP-2: Jira refused the note. Add it by hand.',
      'The ship notice property could not be set, so Slack delivery will not happen.',
    ]);
  });
});
