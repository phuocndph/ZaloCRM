import { describe, expect, it } from 'vitest';
import {
  attachmentDeliveryAccepted,
  attachmentOutboxStatus,
  failedAttachmentIndices,
  resolveAttachmentEchoIds,
} from '../src/modules/chat/chat-attachment-routes.js';

describe('chat attachment outbox identity', () => {
  it('keeps a stable id per file when retrying only a failed subset', () => {
    const firstAttempt = resolveAttachmentEchoIds(['file-a', 'file-b', 'file-c'], 'batch-1', 3);
    expect(firstAttempt).toEqual(['file-a', 'file-b', 'file-c']);

    // File B is retried alone. Its identity must not become batch:index 0,
    // which could collide with file A from the completed first attempt.
    const retry = resolveAttachmentEchoIds(['file-b'], 'batch-2', 1);
    expect(retry).toEqual(['file-b']);
  });

  it('returns only unfinished indices after a partial send', () => {
    expect(failedAttachmentIndices(5, [0, 2, 4])).toEqual([1, 3]);
  });

  it('keeps the legacy batch:index fallback for older clients', () => {
    expect(resolveAttachmentEchoIds([], 'legacy-batch', 3)).toEqual([
      'legacy-batch:0',
      'legacy-batch:1',
      'legacy-batch:2',
    ]);
  });

  it('does not treat a pre-send placeholder as delivered', () => {
    const row = {
      zaloMsgId: null,
      metadata: { outboundAttachment: { status: 'submitting' } },
    };

    expect(attachmentOutboxStatus(row)).toBe('submitting');
    expect(attachmentDeliveryAccepted(row)).toBe(false);
  });

  it('deduplicates listener-confirmed and mirrored attachment rows', () => {
    expect(attachmentDeliveryAccepted({
      zaloMsgId: null,
      metadata: { outboundAttachment: { status: 'listener_confirmed' } },
    })).toBe(true);
    expect(attachmentDeliveryAccepted({
      zaloMsgId: null,
      metadata: { outboundAttachment: { status: 'mirrored' } },
    })).toBe(true);
    expect(attachmentDeliveryAccepted({ zaloMsgId: '9001', metadata: null })).toBe(true);
  });
});
