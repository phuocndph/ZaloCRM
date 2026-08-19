import { describe, expect, it } from 'vitest';
import {
  compareEchoMessages,
  isSameMessageIdentity,
  replaceMessageByEchoId,
  resolveClientEchoId,
  upsertMessageByIdentity,
} from './chat-outbox';
import type { Message } from './use-chat';

function message(overrides: Partial<Message>): Message {
  return {
    id: 'message-1',
    content: 'hello',
    contentType: 'text',
    senderType: 'self',
    senderName: 'Sale',
    senderUid: null,
    sentAt: '2026-08-18T03:00:00.000Z',
    isDeleted: false,
    zaloMsgId: null,
    zaloMsgIdNum: null,
    albumKey: null,
    albumIndex: null,
    albumTotal: null,
    reply: null,
    reactions: [],
    reactionDetails: [],
    ...overrides,
  };
}

describe('chat outbox reconciliation', () => {
  it('keeps the same echo id for an explicit retry', () => {
    expect(resolveClientEchoId('echo-retry-1', () => 'echo-new')).toBe('echo-retry-1');
    expect(resolveClientEchoId(undefined, () => 'echo-new')).toBe('echo-new');
  });

  it('replaces a pending item by echo id even when working on a cached array', () => {
    const pending = message({ id: 'pending:echo-1', clientEchoId: 'echo-1', isPending: true });
    const older = message({ id: 'older', sentAt: '2026-08-18T02:00:00.000Z' });
    const confirmed = message({ id: 'confirmed', clientEchoId: 'echo-1', zaloMsgId: '9001' });

    const result = replaceMessageByEchoId([older, pending], 'echo-1', confirmed);

    expect(result?.map((item) => item.id)).toEqual(['older', 'confirmed']);
    expect(result?.some((item) => item.isPending)).toBe(false);
  });

  it('does not mutate the cached source array', () => {
    const pending = message({ id: 'pending:echo-2', echoId: 'echo-2', isPending: true });
    const source = [pending];
    const confirmed = message({ id: 'confirmed-2', echoId: 'echo-2' });

    const result = replaceMessageByEchoId(source, 'echo-2', confirmed);

    expect(source[0]).toBe(pending);
    expect(result?.[0]).toBe(confirmed);
  });

  it('collapses a self-listener row that arrived before the HTTP confirmation', () => {
    const pending = message({ id: 'pending:echo-race', clientEchoId: 'echo-race', isPending: true });
    const listener = message({ id: 'listener-row', zaloMsgId: '9002', zaloMsgIdNum: '9002' });
    const confirmed = message({
      id: 'listener-row',
      clientEchoId: 'echo-race',
      zaloMsgId: '9002',
      zaloMsgIdNum: '9002',
    });

    const result = replaceMessageByEchoId([pending, listener], 'echo-race', confirmed);

    expect(result).toHaveLength(1);
    expect(result?.[0]).toBe(confirmed);
  });

  it('upserts duplicate socket deliveries by Zalo message id', () => {
    const first = message({ id: 'db-row-old', zaloMsgId: '9003', zaloMsgIdNum: '9003' });
    const refreshed = message({ id: 'db-row-new', zaloMsgId: '9003', zaloMsgIdNum: '9003' });

    expect(isSameMessageIdentity(first, refreshed)).toBe(true);
    expect(upsertMessageByIdentity([first], refreshed)).toEqual([refreshed]);
  });

  it('orders by sent time even when the newer message has no Zalo id yet', () => {
    const olderConfirmed = message({
      id: 'older-confirmed',
      sentAt: '2026-08-18T02:59:59.000Z',
      zaloMsgId: '999999999999',
      zaloMsgIdNum: '999999999999',
    });
    const newerPending = message({
      id: 'newer-pending',
      sentAt: '2026-08-18T03:00:00.000Z',
      zaloMsgId: null,
      zaloMsgIdNum: null,
    });

    expect([newerPending, olderConfirmed].sort(compareEchoMessages).map((item) => item.id)).toEqual([
      'older-confirmed',
      'newer-pending',
    ]);
  });

  it('uses the internal id as a stable final tie-breaker', () => {
    const second = message({ id: 'b', zaloMsgId: null, zaloMsgIdNum: null });
    const first = message({ id: 'a', zaloMsgId: null, zaloMsgIdNum: null });

    expect([second, first].sort(compareEchoMessages).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('keeps an unconfirmed row last when timestamps are equal', () => {
    const pending = message({ id: 'pending', zaloMsgIdNum: null });
    const confirmed = message({ id: 'confirmed', zaloMsgIdNum: '101' });

    expect([pending, confirmed].sort(compareEchoMessages).map((item) => item.id)).toEqual([
      'confirmed',
      'pending',
    ]);
  });
});
