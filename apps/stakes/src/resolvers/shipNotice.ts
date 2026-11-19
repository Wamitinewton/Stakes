import { z } from 'zod';
import {
  IssueKey,
  type CustomerDraft,
  type SendShipNoticeResult,
  type ShipNoticeView,
} from '@stakes/contracts';
import { err, ok, type Result } from '../core/result.js';
import {
  MAX_INTERNAL_NOTE,
  MAX_REPLY,
  dismissShipNotice,
  draftCustomer,
  getShipNotice,
  sendShipNotice,
  type ShipNoticeDeps,
} from '../services/shipNotice.js';
import { guarded, parseInput, readContext, type CallContext } from './context.js';

export type ShipNoticeDepsFactory = (ctx: CallContext) => { shipNotice: ShipNoticeDeps };

const key = z.string().trim().toUpperCase().pipe(IssueKey);
const IssueInput = z.object({ issueKey: key });
const DraftInput = z.object({
  issueKey: key,
  customerId: z.string().trim().min(1).max(100).optional(),
  requestKey: key.optional(),
  tone: z.enum(['brief', 'detailed']).default('brief'),
});
const SendInput = z.object({
  issueKey: key,
  internalNote: z.string().trim().min(1).max(MAX_INTERNAL_NOTE),
  customerReplies: z
    .array(
      z.object({
        requestKey: key,
        text: z.string().trim().min(1).max(MAX_REPLY),
        visibility: z.enum(['public-draft', 'internal']),
      }),
    )
    .max(50)
    .default([]),
  confirmed: z.boolean().optional(),
});

async function viewable(deps: ShipNoticeDeps, issueKey: string): Promise<Result<true>> {
  return (await deps.jira.canView(issueKey))
    ? ok(true)
    : err('FORBIDDEN', `You don't have access to ${issueKey}`);
}

export function getShipNoticeHandler(makeDeps: ShipNoticeDepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<ShipNoticeView | null>> =>
    guarded('getShipNotice', async () => {
      const parsed = parseInput(IssueInput, payload);
      if (!parsed.ok) return parsed;
      const deps = makeDeps(readContext(context)).shipNotice;
      const access = await viewable(deps, parsed.data.issueKey);
      if (!access.ok) return access;
      return ok(await getShipNotice(deps, parsed.data.issueKey));
    });
}

export function draftCustomerUpdateHandler(makeDeps: ShipNoticeDepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<CustomerDraft>> =>
    guarded('draftCustomerUpdate', async () => {
      const parsed = parseInput(DraftInput, payload);
      if (!parsed.ok) return parsed;
      const deps = makeDeps(readContext(context)).shipNotice;
      const access = await viewable(deps, parsed.data.issueKey);
      if (!access.ok) return access;
      return draftCustomer(deps, parsed.data);
    });
}

// Posting a comment and request notes is a write to Jira, so it needs the explicit
// confirmation the dialog sends, and it runs as the person who confirmed.
export function sendShipNoticeHandler(makeDeps: ShipNoticeDepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<SendShipNoticeResult>> =>
    guarded('sendShipNotice', async () => {
      const parsed = parseInput(SendInput, payload);
      if (!parsed.ok) return parsed;
      if (parsed.data.confirmed !== true) {
        return err('CONFIRMATION_REQUIRED', 'Confirm what Stakes will post first');
      }
      const ctx = readContext(context);
      const deps = makeDeps(ctx).shipNotice;
      const access = await viewable(deps, parsed.data.issueKey);
      if (!access.ok) return access;
      return sendShipNotice(deps, parsed.data, ctx.accountId);
    });
}

export function dismissShipNoticeHandler(makeDeps: ShipNoticeDepsFactory) {
  return (payload: unknown, context: unknown): Promise<Result<{ ok: true; dismissed: number }>> =>
    guarded('dismissShipNotice', async () => {
      const parsed = parseInput(IssueInput, payload);
      if (!parsed.ok) return parsed;
      const ctx = readContext(context);
      const deps = makeDeps(ctx).shipNotice;
      const access = await viewable(deps, parsed.data.issueKey);
      if (!access.ok) return access;
      return ok(await dismissShipNotice(deps, parsed.data.issueKey, ctx.accountId));
    });
}
