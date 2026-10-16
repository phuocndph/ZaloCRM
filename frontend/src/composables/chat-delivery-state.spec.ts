import { describe, expect, it } from 'vitest';
import type { Message } from './use-chat';
import { attachmentOutcomes, messageDeliveryState } from './chat-delivery-state';

describe('canonical outgoing delivery state', () => {
  it('does not turn old accepted messages back into sending', () => {
    expect(messageDeliveryState({ sentAt: '2020-01-01T00:00:00Z', zaloMsgId: 'file-id', deliveryState: 'completed' })).toBe('accepted');
    expect(messageDeliveryState({ sentAt: '2020-01-01T00:00:00Z' })).toBe('accepted');
  });
  it('requires an actual receipt for delivered or seen', () => {
    expect(messageDeliveryState({ deliveryState: 'accepted' })).toBe('accepted');
    expect(messageDeliveryState({ deliveryState: 'completed', deliveredAt: 'now' })).toBe('delivered');
    expect(messageDeliveryState({ deliveredAt: 'now', seenAt: 'later' })).toBe('seen');
  });
  it('keeps uncertainty separate from sending and failed', () => {
    expect(messageDeliveryState({ deliveryState: 'uncertain' })).toBe('uncertain');
    expect(messageDeliveryState({ deliveryState: 'failed' })).toBe('failed');
    expect(messageDeliveryState({ deliveryState: 'prepared' })).toBe('queued');
    expect(messageDeliveryState({ deliveryState: 'submitting' })).toBe('sending');
  });
  it('does not let a stale pending flag override a remote message ID', () => {
    expect(messageDeliveryState({ zaloMsgId: 'id', isPending: true, pendingConfirmation: true })).toBe('accepted');
  });
});

describe('per-file response reconciliation shared by app and web', () => {
  it('does not treat HTTP 202 queued work as sent or retryable failure', () => {
    const result = attachmentOutcomes(['a'], { messages: [{ clientEchoId: 'a', deliveryState: 'prepared' } as Message] });
    expect([...result.pending]).toEqual([0]);
    expect(result.accepted.size).toBe(0);
    expect(result.failed.size).toBe(0);
  });
  it('distinguishes accepted, failed, uncertain and missing in a mixed batch', () => {
    const result = attachmentOutcomes(['a', 'b', 'c', 'd'], { messages: [
      { clientEchoId: 'a', zaloMsgId: 'remote', deliveryState: 'accepted' },
      { clientEchoId: 'b', deliveryState: 'failed' },
      { clientEchoId: 'c', deliveryState: 'uncertain' },
    ] as Message[] });
    expect([...result.accepted]).toEqual([0]);
    expect([...result.failed]).toEqual([1]);
    expect([...result.pending]).toEqual([2]);
    expect([...result.missing]).toEqual([3]);
  });
  it('uses stable per-file identities when results arrive out of order', () => {
    const result = attachmentOutcomes(['a', 'b'], { messages: [
      { clientEchoId: 'b', deliveryState: 'uncertain' }, { clientEchoId: 'a', zaloMsgId: 'id' },
    ] as Message[] });
    expect([...result.accepted]).toEqual([0]);
    expect([...result.pending]).toEqual([1]);
  });
});
