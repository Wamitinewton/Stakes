import { describe, expect, it, vi } from 'vitest';
import {
  dismissShipNoticeHandler,
  draftCustomerUpdateHandler,
  getShipNoticeHandler,
  sendShipNoticeHandler,
} from '../../src/resolvers/shipNotice.js';
import { makeShipNoticeStore } from '../../src/adapters/storage.js';
import type { ShipNoticeDeps } from '../../src/services/shipNotice.js';
import { fakeKvs } from '../fakes/kvs.js';
import { fakeStakesDeps, NOW, SITE } from '../fakes/deps.js';

vi.mock('@forge/kvs', () => ({ kvs: {}, Sort: { ASC: 'ASC', DESC: 'DESC' } }));
vi.spyOn(console, 'log').mockImplementation(() => {});

const ctx = { accountId: 'acc-1', cloudId: 'c', siteUrl: SITE };

function factory(canView = true) {
  const writer = {
    addComment: vi.fn(async () => '1'),
    addRequestComment: vi.fn(async () => '2'),
    setProperty: vi.fn(async () => {}),
  };
  const shipNotice: ShipNoticeDeps = {
    jira: { canView: vi.fn(async () => canView), issue: vi.fn() },
    writer,
    notices: makeShipNoticeStore(fakeKvs().kvs),
    stakes: fakeStakesDeps().deps,
    text: { write: vi.fn() },
    siteUrl: SITE,
    clock: () => NOW,
  };
  return { make: () => ({ shipNotice }), shipNotice, writer };
}

describe('ship notice resolvers', () => {
  it('returns null when no notice is pending', async () => {
    expect(await getShipNoticeHandler(factory().make)({ issueKey: 'pay-142' }, ctx)).toEqual({
      ok: true,
      data: null,
    });
  });

  it('refuses an issue the user cannot view', async () => {
    const f = factory(false);
    for (const h of [getShipNoticeHandler, draftCustomerUpdateHandler]) {
      expect(await h(f.make)({ issueKey: 'PAY-142' }, ctx)).toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN' },
      });
    }
    expect(
      await dismissShipNoticeHandler(f.make)({ issueKey: 'PAY-142', confirmed: true }, ctx),
    ).toMatchObject({
      ok: false,
      error: { code: 'FORBIDDEN' },
    });
  });

  it('does not dismiss a notice without confirmation', async () => {
    const f = factory();
    expect(await dismissShipNoticeHandler(f.make)({ issueKey: 'PAY-142' }, ctx)).toMatchObject({
      ok: false,
      error: { code: 'CONFIRMATION_REQUIRED' },
    });
    expect(f.shipNotice.jira.canView).not.toHaveBeenCalled();
  });

  it('posts nothing without confirmation', async () => {
    const f = factory();
    const r = await sendShipNoticeHandler(f.make)(
      { issueKey: 'PAY-142', internalNote: 'Shipped.', customerReplies: [] },
      ctx,
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'CONFIRMATION_REQUIRED' } });
    expect(f.writer.addComment).not.toHaveBeenCalled();
  });

  it('rejects an empty note and an unknown visibility', async () => {
    const send = sendShipNoticeHandler(factory().make);
    expect(
      await send({ issueKey: 'PAY-142', internalNote: ' ', confirmed: true }, ctx),
    ).toMatchObject({
      ok: false,
      error: { code: 'INVALID_INPUT' },
    });
    expect(
      await send(
        {
          issueKey: 'PAY-142',
          internalNote: 'x',
          customerReplies: [{ requestKey: 'HELP-1', text: 'x', visibility: 'public' }],
          confirmed: true,
        },
        ctx,
      ),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
  });

  it('reports a confirmed send with nothing pending as not found', async () => {
    const r = await sendShipNoticeHandler(factory().make)(
      { issueKey: 'PAY-142', internalNote: 'Shipped.', confirmed: true },
      ctx,
    );
    expect(r).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
  });
});
